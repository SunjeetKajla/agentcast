import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FlowsFile,
  JobConfig,
  Timeline,
  jobPaths,
  type Flow,
} from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import {
  FlowRecordingError,
  type FlowOptions,
  type FlowRecording,
} from "@agentcast/recorder";
import type { StageContext } from "../context";
import { makeRecord } from "./record";

const exec = promisify(execFile);
let dir: string;
let ctx: StageContext;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-record-stage-"));
  vi.stubEnv("AGENTCAST_STAGE_MODE", "real");
  const io: Pick<StageContext, "read" | "write" | "path"> = {
    read: (file, schema) => readArtifact(join(dir, file), schema),
    write: (file, schema, data) => writeArtifact(join(dir, file), schema, data),
    path: (file) => join(dir, file),
  };
  ctx = {
    ...io,
    jobId: "job_test",
    dir,
    config: JobConfig.parse({
      url: "https://demoboard.vercel.app/",
      variants: { aspects: ["16x9"], langs: ["en"], formFactors: ["desktop"] },
    }),
    signal: new AbortController().signal,
    artifact: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
  } as unknown as StageContext;
  await mkdir(dirname(ctx.path(jobPaths.flows)), { recursive: true });
  await copyFile(
    join(FIXTURE_JOB_DIR, jobPaths.flows),
    ctx.path(jobPaths.flows),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

/** Both fixture flows approved, export first. */
async function approveBoth() {
  const file = await ctx.read(jobPaths.flows, FlowsFile);
  file.flows = file.flows
    .map((flow) => ({
      ...flow,
      selected: true,
      rank: flow.id === "flow-export" ? 1 : 2,
    }))
    .reverse();
  await ctx.write(jobPaths.flows, FlowsFile, file);
}

/** A stand-in for recordFlow: the fixture recording and timeline, relabelled for the flow. */
function fakeFilm(fail: string[] = []) {
  return vi.fn(async (flow: Flow, options: FlowOptions) => {
    if (fail.includes(flow.id))
      throw new FlowRecordingError([
        { attempt: 1, status: "failed", stepId: "s1", reason: "no match" },
      ]);
    await copyFile(
      join(FIXTURE_JOB_DIR, jobPaths.recording("desktop")),
      options.outputPath,
    );
    const fixture = await readArtifact(
      join(FIXTURE_JOB_DIR, jobPaths.timeline("desktop")),
      Timeline,
    );
    const timeline = {
      ...fixture,
      flows: [{ flowId: flow.id, in: 0, out: fixture.duration }],
      events: fixture.events.map((e) => ({ ...e, flowId: flow.id })),
      dead: [[1, 2]] as [number, number][],
    };
    return { path: options.outputPath, timeline } as FlowRecording;
  });
}

async function seconds(file: string) {
  const { stdout } = await exec("ffprobe", [
    ...["-v", "error", "-show_entries", "format=duration"],
    ...["-of", "csv=p=0", file],
  ]);
  return Number(stdout);
}

describe("record stage", () => {
  it("films approved flows in rank order and joins them into one recording and timeline", async () => {
    await approveBoth();
    const film = fakeFilm();
    await makeRecord({ recordFlow: film })(ctx);

    expect(film.mock.calls.map(([flow]) => flow.id)).toEqual([
      "flow-export",
      "flow-template",
    ]);
    expect(film.mock.calls[0]![1].replayPlanPath).toBe(
      ctx.path(jobPaths.replayPlan),
    );
    const timeline = await ctx.read(jobPaths.timeline("desktop"), Timeline);
    expect(timeline.duration).toBe(12);
    expect(timeline.flows).toEqual([
      { flowId: "flow-export", in: 0, out: 6 },
      { flowId: "flow-template", in: 6, out: 12 },
    ]);
    expect(timeline.dead).toEqual([
      [1, 2],
      [7, 8],
    ]);
    const second = timeline.events.filter((e) => e.flowId === "flow-template");
    expect(second[0]!.t).toBeGreaterThanOrEqual(6);
    const cursor = second.find((e) => e.cursor)?.cursor;
    if (cursor) expect(cursor.t0).toBeGreaterThanOrEqual(6);

    const video = ctx.path(jobPaths.recording("desktop"));
    expect(await seconds(video)).toBeCloseTo(12, 0);
    expect(ctx.artifact).toHaveBeenCalledWith(jobPaths.recording("desktop"));
    expect(ctx.artifact).toHaveBeenCalledWith(jobPaths.replayPlan);
    expect(await readdir(dirname(video))).not.toContain("takes");
  });

  it("skips a flow whose takes all fail and keeps the rest", async () => {
    await approveBoth();
    await makeRecord({ recordFlow: fakeFilm(["flow-export"]) })(ctx);
    const timeline = await ctx.read(jobPaths.timeline("desktop"), Timeline);
    expect(timeline.flows).toEqual([
      { flowId: "flow-template", in: 0, out: 6 },
    ]);
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining("Skipped"),
      "warn",
    );
  });

  it("fails when no approved flow can be recorded", async () => {
    await expect(
      makeRecord({ recordFlow: fakeFilm(["flow-template"]) })(ctx),
    ).rejects.toThrow(/None of the approved flows/);
  });

  it("fails when nothing was approved", async () => {
    const file = await ctx.read(jobPaths.flows, FlowsFile);
    file.flows = file.flows.map((flow) => ({ ...flow, selected: false }));
    await ctx.write(jobPaths.flows, FlowsFile, file);
    await expect(makeRecord({ recordFlow: fakeFilm() })(ctx)).rejects.toThrow(
      /No approved flows/,
    );
  });
});
