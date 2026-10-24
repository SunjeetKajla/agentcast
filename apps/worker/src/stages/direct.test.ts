import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Edl, JobConfig, jobPaths, type GateDecision } from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import type { DirectorOptions, DirectorRun } from "@agentcast/director";
import type { StageContext } from "../context";
import { makeDirect } from "./direct";

let dir: string;
let decision: GateDecision<"gate-preview"> | undefined;
let ctx: StageContext;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-direct-"));
  await cp(FIXTURE_JOB_DIR, dir, { recursive: true });
  await rm(join(dir, "render"), { recursive: true, force: true });
  vi.stubEnv("AGENTCAST_STAGE_MODE", "real");
  vi.stubEnv("AGENTCAST_DIRECTOR", "");
  decision = undefined;
  const io: Pick<StageContext, "read" | "write" | "path"> = {
    read: (rel, schema) => readArtifact(join(dir, rel), schema),
    write: (rel, schema, data) => writeArtifact(join(dir, rel), schema, data),
    path: (rel) => join(dir, rel),
  };
  ctx = {
    ...io,
    dir,
    stage: "direct",
    config: JobConfig.parse({
      url: "https://demoboard.vercel.app/",
      variants: {
        aspects: ["16x9"],
        langs: ["en", "hi"],
        formFactors: ["desktop"],
      },
    }),
    signal: new AbortController().signal,
    decision: async () => decision,
    llm: {},
    llmProgress: vi.fn(),
    emit: vi.fn(),
    log: vi.fn(),
    progress: vi.fn(),
    artifact: vi.fn(),
  } as unknown as StageContext;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const logs = () =>
  (ctx.log as ReturnType<typeof vi.fn>).mock.calls
    .map(([m]) => m as string)
    .join("\n");

/** A stand-in director: changes edl.json in the workspace the way the real one would. */
function fakeDirector(
  change: (edl: Edl) => void,
  result: Partial<DirectorRun> = {},
) {
  return vi.fn(async (o: DirectorOptions): Promise<DirectorRun> => {
    const file = join(o.dir, "edl.json");
    const edl = Edl.parse(JSON.parse(await readFile(file, "utf8")));
    change(edl);
    await writeFile(file, JSON.stringify(edl));
    return {
      edl,
      sessionId: "s-1",
      fellBack: false,
      repairRounds: 0,
      reviewedStills: true,
      summary: "Tuned the hold.",
      warnings: [],
      ...result,
    };
  });
}

describe("direct stage", () => {
  it("prepares the workspace from the baseline, runs the director and writes its edit", async () => {
    const runDirector = fakeDirector((edl) => (edl.style.motion.hold = 1.7));
    await makeDirect({ runDirector, renderStills: async () => [] })(ctx);
    expect(await readFile(join(dir, "render/DIRECTOR.md"), "utf8")).toContain(
      "en: string; hi: string",
    );
    const baseline = Edl.parse(
      JSON.parse(await readFile(join(dir, "render/edl.baseline.json"), "utf8")),
    );
    const edl = await ctx.read(jobPaths.edl, Edl);
    expect(edl.style.motion.hold).toBe(1.7);
    expect(baseline.style.motion.hold).not.toBe(1.7);
    expect(runDirector.mock.calls[0]![0]).not.toHaveProperty("resume");
    expect(logs()).toMatch(/the director's edit, stills reviewed/);
    expect(
      JSON.parse(await readFile(join(dir, "render/director.json"), "utf8")),
    ).toEqual({ sessionId: "s-1", applied: [] });
  });

  it("resumes the director's session for a revision, once, without starting over", async () => {
    await makeDirect({
      runDirector: fakeDirector((edl) => (edl.style.motion.hold = 1.7)),
      renderStills: async () => [],
    })(ctx);
    decision = { action: "revise", revise: "No window frame" };
    const revise = fakeDirector((edl) => (edl.style.frame = "none"));
    await makeDirect({ runDirector: revise })(ctx);
    expect(revise.mock.calls[0]![0]).toMatchObject({
      resume: "s-1",
      revise: "No window frame",
    });
    const edl = await ctx.read(jobPaths.edl, Edl);
    expect(edl.style).toMatchObject({ frame: "none", motion: { hold: 1.7 } });
    // Run again (a worker restart): the revision isn't made twice and the edit is kept.
    const again = fakeDirector(() => {});
    await makeDirect({ runDirector: again })(ctx);
    expect(again).not.toHaveBeenCalled();
    expect((await ctx.read(jobPaths.edl, Edl)).style.frame).toBe("none");
  });

  it("keeps the baseline when the director fails, and when it's turned off", async () => {
    const failing = vi.fn(async () => {
      throw new Error("Claude Code isn't logged in");
    });
    await makeDirect({ runDirector: failing })(ctx);
    const baseline = JSON.parse(
      await readFile(join(dir, "render/edl.baseline.json"), "utf8"),
    );
    expect(await ctx.read(jobPaths.edl, Edl)).toEqual(baseline);
    expect(logs()).toMatch(
      /didn't finish \(Claude Code isn't logged in\); using the baseline edit/,
    );

    vi.stubEnv("AGENTCAST_DIRECTOR", "off");
    const unused = fakeDirector(() => {});
    await makeDirect({ runDirector: unused })(ctx);
    expect(unused).not.toHaveBeenCalled();
    expect(await ctx.read(jobPaths.edl, Edl)).toEqual(baseline);
  });

  it("cuts a silent edit when there's no voiceover", async () => {
    ctx = {
      ...ctx,
      config: { ...ctx.config, voiceover: false },
    } as StageContext;
    vi.stubEnv("AGENTCAST_DIRECTOR", "off");
    await makeDirect()(ctx);
    const edl = await ctx.read(jobPaths.edl, Edl);
    expect(edl.style.captionStyle).not.toBe("karaoke");
    expect(await readFile(join(dir, "render/DIRECTOR.md"), "utf8")).toContain(
      "There is no voiceover",
    );
  });
});
