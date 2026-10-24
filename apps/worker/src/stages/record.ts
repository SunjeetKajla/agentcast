import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { FlowsFile, Timeline, jobPaths } from "@agentcast/shared";
import { fixtureStages } from "@agentcast/explore";
import {
  FlowRecordingError,
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
      .filter((flow) => flow.selected)
      .sort((a, b) => a.rank - b.rank);
    if (!approved.length) throw new Error("No approved flows to record.");
    const storageState = await sessionFor(ctx);
    if (ctx.config.auth.mode !== "public" && !storageState)
      throw new Error(
        "The signed-in session is missing. Sign in before recording.",
      );

    // recordFlow refuses to overwrite, so a retried or resumed stage starts from a clean folder.
    const takes = ctx.path("record/desktop/takes");
    await rm(takes, { recursive: true, force: true });
    await mkdir(takes, { recursive: true });
    const recorded: { flowId: string; take: FlowRecording }[] = [];
    try {
      for (const [i, flow] of approved.entries()) {
        ctx.progress(i / approved.length, `Recording "${flow.title}"`);
        const options: FlowOptions = {
          outputPath: join(takes, `take-${i + 1}.mp4`),
          timelinePath: join(takes, `take-${i + 1}.json`),
          replayPlanPath: ctx.path(jobPaths.replayPlan),
          recordingId: `${ctx.jobId}-${i + 1}`,
          browser: { formFactor: "desktop", storageState },
          signal: ctx.signal,
          onTake: (take) => {
            if (take.status === "failed")
              ctx.log(
                `"${flow.title}" take ${take.attempt} failed: ${take.reason ?? "unknown"}`,
                "warn",
              );
          },
        };
        try {
          recorded.push({ flowId: flow.id, take: await film(flow, options) });
        } catch (error) {
          if (!(error instanceof FlowRecordingError)) throw error;
          ctx.log(`Skipped "${flow.title}": ${error.message}`, "warn");
        }
      }
      if (!recorded.length)
        throw new Error(
          "None of the approved flows could be recorded. See the activity log for each take.",
        );

      ctx.progress(0.95, "Joining the takes");
      const output = ctx.path(jobPaths.recording("desktop"));
      const staged = join(takes, "joined.mp4");
      if (recorded.length === 1) await rename(recorded[0]!.take.path, staged);
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
          { signal: ctx.signal },
        );
      }
      await rename(staged, output);
      ctx.artifact(jobPaths.recording("desktop"));
      await ctx.write(
        jobPaths.timeline("desktop"),
        Timeline,
        joinTimelines(ctx.jobId, recorded),
      );
      // recordFlow saved the locators and checks it learned straight to the replay plan.
      ctx.artifact(jobPaths.replayPlan);
      ctx.progress(
        1,
        `Recorded ${recorded.length} of ${approved.length} flow(s)`,
      );
    } finally {
      await rm(takes, { recursive: true, force: true });
    }
  };
}
export const record = makeRecord();

/** One timeline for the joined recording: each take's times move by the length of the takes before it. */
export function joinTimelines(
  recordingId: string,
  recorded: { flowId: string; take: FlowRecording }[],
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
    schemaVersion: 1,
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
