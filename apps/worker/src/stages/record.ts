import { createHash } from "node:crypto";
import { z } from "zod";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { FlowsFile, ProductOutputs, Timeline, jobPaths } from "@agentcast/shared";
import { fixtureStages } from "@agentcast/explore";
import {
  recordFlow,
  type FlowOptions,
  type FlowRecording,
} from "@agentcast/recorder";
import type { StageFn } from "./types.ts";
import { sessionFor } from "./auth.ts";
import { stub } from "./stub.ts";

// record: film each approved flow in local Chromium (PRD §9.3). Owner: Neeraj. Desktop only for now.
// Each flow is its own Live take (up to three tries); the takes are joined into one recording.mp4 and
// one timeline.json, with every flow's in/out marked so the script and the edit can find it.

const exec = promisify(execFile);
const RecordedTake = z.object({
  schemaVersion: z.literal(1),
  key: z.string(),
  timeline: Timeline,
});
const takeKey = (flow: unknown, session: unknown, dpr = SHARP) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        dpr === SHARP ? { flow, session } : { flow, session, dpr },
      ),
    )
    .digest("hex");

// Pixel ratios. Every flow is filmed at 2× (crisp when the edit zooms in). A site that paints too slowly
// for Chrome to screencast 2× frames smoothly (sarvam.ai: 22–26 fps at 2×, 33–44 fps at 4/3 on an
// RTX 3050) is filmed again at 4/3: 1920 px wide, still above the 1080p output. One ratio per job, so
// the takes can be joined without re-encoding.
const SHARP = 2;
const LIGHT = 4 / 3;
const stalled = (reason: string | undefined) =>
  /stall checks/.test(reason ?? "");

export function makeRecord(
  deps: { recordFlow?: typeof recordFlow; ffmpeg?: string } = {},
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
    try {
      let dpr = SHARP;
      for (let pass = 1; ; pass++) {
        let retry = false;
        recorded.length = 0;
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
            // At the lighter ratio there is nothing smoother to try: keep a watchable last take.
            acceptUneven: dpr === LIGHT,
            // Client-rendered apps can take ~25 s to show their first element (Linear's demo).
            // The first lookup happens before filming starts, so the wait isn't in the video.
            locate: { timeoutMs: 30_000 },
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
          const key = takeKey(flow, storageState, dpr);
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
              ctx.log(`Reusing the completed recording of "${flow.title}".`);
            } else {
              for (const path of [
                options.outputPath,
                options.timelinePath!,
                ctx.path(checkpoint),
              ])
                await rm(path, { force: true });
              const take = await film(flow, options);
              ctx.signal.throwIfAborted();
              await ctx.write(checkpoint, RecordedTake, {
                schemaVersion: 1,
                key,
                timeline: take.timeline,
              });
              recorded.push({ flowId: flow.id, take });
            }
          } catch (error) {
            ctx.signal.throwIfAborted();
            const reason =
              error instanceof Error
                ? error.message.split("\n")[0]
                : "Recording failed";
            if (dpr === SHARP && stalled(reason)) {
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
      await keepOutputs(ctx, joined);
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
    const list = await readFile(ctx.path(`record/output/${flow.flowId}.json`), "utf8").then(
      (text) => JSON.parse(text) as { file: string; type: string; t: number }[],
      () => [],
    );
    for (const out of list) {
      const file = `record/output/${out.file}`;
      outputs.push({ file, kind: "audio", type: out.type, flowId: flow.flowId, t: Math.round((flow.in + out.t) * 1000) / 1000 });
      ctx.artifact(file);
    }
  }
  await ctx.write(jobPaths.outputs, ProductOutputs, { schemaVersion: 1, outputs });
  if (outputs.length) ctx.log(`Kept ${outputs.length} output(s) the product made while it was recorded.`);
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
