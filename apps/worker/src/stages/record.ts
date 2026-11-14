import { createHash } from "node:crypto";
import { z } from "zod";
import { execFile } from "node:child_process";
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CaptureReport, CapturePlan, CaptureOverrides, EvidenceFile, FlowsFile, ProductOutputs, ReplayPlan, StoredOutputIndex, Timeline, jobPaths } from "@agentcast/shared";
import { fixtureStages } from "@agentcast/explore";
import {
  recordFlow,
  chooseCapture,
  type FlowOptions,
  type FlowRecording,
} from "@agentcast/recorder";
import { evidenceOf } from "@agentcast/story";
import { audioShape } from "@agentcast/video";
import { readOptional } from "../material.ts";
import { artifactHash, recover } from "../recovery.ts";
import type { StageFn } from "./types.ts";
import { sessionFor } from "./auth.ts";
import { stub } from "./stub.ts";

// record: film each approved flow in local Chromium (PRD §9.3). Owner: Neeraj. Desktop only for now.
// Each flow is its own Live take (up to three tries); the takes are joined into one recording.mp4 and
// one timeline.json, with every flow's in/out marked so the script and the edit can find it.
// recordMode "studio" films every flow on the page's own clock instead (PRD §9.3.3): an even 30 fps
// however slowly the site paints. In Live, a flow that can't be filmed smoothly also falls back to Studio.

const exec = promisify(execFile);
const RecordedTake = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  key: z.string(),
  timeline: Timeline,
  capture: CaptureReport.shape.flows.element.optional(),
});
const takeKey = (flow: unknown, session: unknown, dpr = SHARP, strategy = "live") =>
  createHash("sha256")
    .update(
      JSON.stringify(
        { version: 2, flow, session, dpr, strategy },
      ),
    )
    .digest("hex");

// Probe the source before capture. Keep one pixel ratio per job so takes join without re-encoding.
// A failed motion take changes strategy; it never becomes acceptable merely because retries ran out.
const SHARP = 2;
const LIGHT = 4 / 3;
const STUDIO_REASON = "Filmed frame by frame on the page's own clock: an even 30 fps, real actions, real results.";
const stalled = (reason: string | undefined) =>
  /stall checks/.test(reason ?? "");

export function makeRecord(
  deps: { recordFlow?: typeof recordFlow; ffmpeg?: string; probe?: typeof chooseCapture } = {},
): StageFn {
  const film = deps.recordFlow ?? recordFlow;
  return async (ctx) => {
    if (ctx.config.variants.formFactors.includes("mobile"))
      ctx.log("Mobile recording isn't supported yet; desktop only", "warn");
    if (fixtureStages()) {
      await stub(ctx, [
        jobPaths.recording("desktop"),
        jobPaths.timeline("desktop"),
        jobPaths.replayPlan,
      ]);
      return;
    }
    const { flows } = await ctx.read(jobPaths.flows, FlowsFile);
    const approved = flows
      .filter((flow) => flow.selected && flow.rehearsal?.ok !== false)
      .sort((a, b) => a.rank - b.rank);
    if (!approved.length) throw new Error("No approved flows to record.");
    const storageState = await sessionFor(ctx);
    if (ctx.config.auth.mode !== "public" && !storageState)
      throw new Error(
        "The signed-in session is missing. Sign in before recording.",
      );

    // Keep complete takes across retries; only an individual unmatched/partial take is replaced.
    const takes = ctx.path("record/desktop/takes");
    await mkdir(takes, { recursive: true });
    const recorded: {
      flowId: string;
      take: Pick<FlowRecording, "path" | "timeline">;
    }[] = [];
    const overrides = await readOptional(ctx, jobPaths.captureOverrides, CaptureOverrides);
    const studio = ctx.config.recordMode === "studio";
    const planHash = artifactHash({ version: 1, flows: approved, session: storageState, ...(studio ? { mode: "studio" } : {}) });
    const savedPlan = await readOptional(ctx, jobPaths.capturePlan, CapturePlan);
    const selected = savedPlan?.inputHash === planHash ? savedPlan : studio
      ? { dpr: SHARP, strategy: "studio" as const, reason: "Studio recording: each flow is filmed frame by frame on the page's own clock, at full sharpness." }
      : deps.probe || !deps.recordFlow
      ? await (deps.probe ?? chooseCapture)(approved[0]!.startUrl, { formFactor: "desktop", storageState }, ctx.signal)
      : { dpr: SHARP, strategy: "live" as const, reason: "Injected recorder" };
    await ctx.write(jobPaths.capturePlan, CapturePlan, { ...selected, schemaVersion: 2, inputHash: planHash });
    ctx.log(selected.reason);
    const captures: CaptureReport["flows"] = [];
    try {
      let dpr = selected.dpr;
      for (let pass = 1; ; pass++) {
        let retry = false;
        recorded.length = 0;
        captures.length = 0;
        for (const [i, flow] of approved.entries()) {
          ctx.progress(i / approved.length, `Recording "${flow.title}"`);
          const options: FlowOptions = {
            outputPath: join(takes, `take-${i + 1}.mp4`),
            timelinePath: join(takes, `take-${i + 1}.json`),
            replayPlanPath: ctx.path(jobPaths.replayPlan),
            recordingId: `${ctx.jobId}-${i + 1}`,
            browser: {
              formFactor: "desktop",
              storageState,
              deviceScaleFactor: dpr,
            },
            // Failed lighter motion switches to verified settled states.
            captureMode: overrides?.states.includes(flow.id) ? "states" : selected.strategy,
            acceptUneven: false,
            maxTakes: 1,
            // Client-rendered apps can take ~25 s to show their first element (Linear's demo).
            // The first lookup happens before filming starts, so the wait isn't in the video.
            locate: { timeoutMs: 30_000, heal: true, llm: ctx.llm, onLlmEvent: ctx.llmProgress },
            // Audio the product makes while it's recorded, for the film to play (PRD §9.7.8).
            outputs: { dir: ctx.path("record/output") },
            signal: ctx.signal,
            onTake: (take) => {
              if (take.status === "ok" && take.reason)
                ctx.log(
                  `"${flow.title}" take ${take.attempt} ${take.reason}.`,
                  "warn",
                );
              if (take.status === "failed")
                ctx.log(
                  `"${flow.title}" take ${take.attempt} failed: ${take.reason ?? "unknown"}`,
                  "warn",
                );
            },
          };
          const checkpoint = `record/desktop/takes/take-${i + 1}.checkpoint.json`;
          const key = takeKey(flow, storageState, dpr, options.captureMode);
          let saved: z.infer<typeof RecordedTake> | undefined;
          try {
            const candidate = await ctx.read(checkpoint, RecordedTake);
            if (
              candidate.key === key &&
              candidate.timeline.flows.length === 1 &&
              candidate.timeline.flows[0]?.flowId === flow.id &&
              (await stat(options.outputPath)).size > 0
            )
              saved = candidate;
          } catch {
            ctx.signal.throwIfAborted();
          }
          try {
            if (saved) {
              recorded.push({
                flowId: flow.id,
                take: { path: options.outputPath, timeline: saved.timeline },
              });
              if (saved.capture) captures.push(saved.capture);
              ctx.log(`Reusing the completed recording of "${flow.title}".`);
            } else {
              for (const path of [
                options.outputPath,
                options.timelinePath!,
                ctx.path(checkpoint),
              ])
                await rm(path, { force: true });
              let take: FlowRecording | undefined;
              let strategy: "live" | "studio" | "states" = options.captureMode ?? "live";
              try { take = await film(flow, options); }
              catch (error) {
                ctx.signal.throwIfAborted();
                if (!stalled((error as Error).message)) throw error;
                if (dpr === SHARP) throw error;
                // Live can't keep up with this site: film it on the page's clock instead of cutting stills.
                strategy = "studio";
                const done = await recover(ctx, { kind: "capture", flowId: flow.id, reason: `Filming "${flow.title}" in Studio; it can't be filmed smoothly live on this machine.` }, { flow, key }, async () => {
                  for (const path of [options.outputPath, options.timelinePath!]) await rm(path, { force: true });
                  take = await film(flow, { ...options, captureMode: "studio", browser: { ...options.browser, deviceScaleFactor: SHARP }, maxTakes: 1 });
                  const capture = { flowId: flow.id, strategy, dpr: SHARP, passed: true, reason: STUDIO_REASON };
                  await ctx.write(checkpoint, RecordedTake, { schemaVersion: 2, key, timeline: take.timeline, capture });
                  return "Filmed in Studio";
                }, approved.length);
                if (!done) throw new Error("Capture recovery exhausted");
                if (!take) {
                  const saved = await ctx.read(checkpoint, RecordedTake);
                  take = { path: options.outputPath, timeline: saved.timeline } as FlowRecording;
                }
              }
              if (!take) throw new Error("No usable capture");
              if (take.stall?.status === "failed") throw new Error("A failed smoothness check cannot be promoted to usable footage");
              const capture: CaptureReport["flows"][number] = { flowId: flow.id, strategy, dpr: strategy === "studio" ? SHARP : dpr, passed: true, reason: strategy === "states" ? "Deliberate cuts between verified states" : strategy === "studio" ? STUDIO_REASON : "Live motion passed capture checks", ...(take.stall ? { p95GapMs: take.stall.p95GapMs, maxGapMs: take.stall.maxGapMs } : {}) };
              captures.push(capture);
              ctx.signal.throwIfAborted();
              await ctx.write(checkpoint, RecordedTake, {
                schemaVersion: 2,
                key,
                timeline: take.timeline,
                capture,
              });
              recorded.push({ flowId: flow.id, take });
            }
          } catch (error) {
            ctx.signal.throwIfAborted();
            const reason =
              error instanceof Error
                ? error.message.split("\n")[0]
                : "Recording failed";
            if (dpr === SHARP && !studio && stalled(reason)) {
              ctx.log(
                `"${flow.title}" can't be filmed smoothly at full sharpness: ${reason}`,
                "warn",
              );
              retry = true;
              break;
            }
            ctx.log(
              `Skipped "${flow.title}": ${reason}. Keeping completed takes.`,
              "warn",
            );
          }
        }
        if (!retry || pass > 1) break;
        dpr = LIGHT;
        await ctx.write(jobPaths.capturePlan, CapturePlan, { schemaVersion: 2, inputHash: planHash, dpr, strategy: selected.strategy, reason: "Live capture failed at full resolution; try the lighter ratio once before Studio." });
        ctx.log(
          "This site paints too slowly to film at 2× pixels on this machine. Filming every flow again at 1920 px wide (still above the 1080p output).",
          "warn",
        );
      }
      if (!recorded.length)
        throw new Error(
          "None of the approved flows could be recorded. See the activity log for each take.",
        );

      ctx.progress(0.95, "Joining the takes");
      const output = ctx.path(jobPaths.recording("desktop"));
      const staged = join(takes, "joined.mp4");
      if (recorded.length === 1) await copyFile(recorded[0]!.take.path, staged);
      else {
        const list = join(takes, "takes.txt");
        await writeFile(
          list,
          recorded
            .map(({ take }) => `file '${take.path.replace(/'/g, "'\\''")}'`)
            .join("\n"),
        );
        await exec(
          deps.ffmpeg ?? "ffmpeg",
          [
            ...["-hide_banner", "-loglevel", "error", "-y"],
            ...["-f", "concat", "-safe", "0", "-i", list],
            ...["-c", "copy", "-movflags", "+faststart", staged],
          ],
          { signal: ctx.signal, timeout: 120000, killSignal: "SIGKILL" },
        );
      }
      await rename(staged, output);
      ctx.artifact(jobPaths.recording("desktop"));
      const joined = joinTimelines(ctx.jobId, recorded);
      await ctx.write(jobPaths.timeline("desktop"), Timeline, joined);
      const outputs = await keepOutputs(ctx, joined);
      await ctx.write(jobPaths.captureReport, CaptureReport, { schemaVersion: 2, flows: captures.filter((c) => joined.flows.some((f) => f.flowId === c.flowId)) });
      const verified: EvidenceFile["outputs"] = [];
      for (const out of outputs.outputs) {
        const shape = await audioShape(ctx.path(out.file), ctx.signal).catch(() => undefined);
        ctx.signal.throwIfAborted();
        if (shape) verified.push({ file: out.file, flowId: out.flowId, ...(out.stepId ? { stepId: out.stepId } : {}), t: out.t, seconds: shape.seconds, audible: shape.audible });
      }
      const replay = await readOptional(ctx, jobPaths.replayPlan, ReplayPlan);
      await ctx.write(jobPaths.evidence, EvidenceFile, evidenceOf({ replay, inputHash: artifactHash({ joined, outputs, captures }), flows: approved, timeline: joined, captures: { schemaVersion: 1, flows: captures }, outputs: verified }));
      // recordFlow saved the locators and checks it learned straight to the replay plan.
      ctx.artifact(jobPaths.replayPlan);
      ctx.progress(
        1,
        `Recorded ${recorded.length} of ${approved.length} flow(s)`,
      );
    } finally {
      await rm(join(takes, "joined.mp4"), { force: true });
    }
  };
}
export const record = makeRecord();

/**
 * The product's outputs across the recorded flows, on the joined recording's clock: record/outputs.json. Each
 * flow's watcher listed its own (its take's seconds), so they move by where the flow sits in the recording.
 */
async function keepOutputs(ctx: Parameters<StageFn>[0], timeline: Timeline) {
  const outputs: ProductOutputs["outputs"] = [];
  for (const flow of timeline.flows) {
    const list = (await readOptional(ctx, `record/output/${flow.flowId}.json`, StoredOutputIndex))?.outputs ?? [];
    for (const out of list) {
      const file = `record/output/${out.file}`;
      outputs.push({ file, kind: "audio", type: out.type, flowId: flow.flowId, ...(out.stepId ? { stepId: out.stepId } : {}), t: Math.round((flow.in + out.t) * 1000) / 1000 });
      ctx.artifact(file);
    }
  }
  await ctx.write(jobPaths.outputs, ProductOutputs, { schemaVersion: 2, outputs });
  if (outputs.length) ctx.log(`Kept ${outputs.length} output(s) the product made while it was recorded.`);
  return { schemaVersion: 2 as const, outputs };
}

/** One timeline for the joined recording: each take's times move by the length of the takes before it. */
export function joinTimelines(
  recordingId: string,
  recorded: {
    flowId: string;
    take: Pick<FlowRecording, "path" | "timeline">;
  }[],
): Timeline {
  let offset = 0;
  const flows: Timeline["flows"] = [],
    events: Timeline["events"] = [],
    dead: Timeline["dead"] = [];
  for (const { flowId, take } of recorded) {
    const { timeline } = take;
    const at = (t: number) => t + offset;
    flows.push({ flowId, in: offset, out: at(timeline.duration) });
    for (const event of timeline.events)
      events.push({
        ...event,
        t: at(event.t),
        ...(event.layout
          ? {
              layout: {
                ...event.layout,
                ...(event.layout.at === undefined
                  ? {}
                  : { at: at(event.layout.at) }),
              },
            }
          : {}),
        ...(event.cursor
          ? {
              cursor: {
                ...event.cursor,
                t0: at(event.cursor.t0),
                t1: at(event.cursor.t1),
              },
            }
          : {}),
      });
    for (const [from, to] of timeline.dead) dead.push([at(from), at(to)]);
    offset = at(timeline.duration);
  }
  return {
    schemaVersion: 2,
    recordingId,
    formFactor: "desktop",
    viewport: recorded[0]!.take.timeline.viewport,
    fps: 30,
    duration: offset,
    flows,
    events,
    dead,
  };
}
