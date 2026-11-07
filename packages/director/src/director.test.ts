import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreativeBrief,
  Edl,
  ProductBrief,
  Script,
  Storyboard,
  Timeline,
  Voiceover,
  jobPaths,
  type ShotSegment,
} from "@agentcast/shared";
import { FIXTURE_JOB_DIR, readArtifact } from "@agentcast/shared/node";
import type { AgentTask } from "@agentcast/llm";
import { baselineEdl } from "@agentcast/video";
import { checkWorkspace, errorsOf } from "./check.ts";
import { runDirector } from "./director.ts";
import { CHECK_COMMAND, prepareWorkspace } from "./workspace.ts";

const read = <S extends Parameters<typeof readArtifact>[1]>(rel: string, schema: S) =>
  readArtifact(join(FIXTURE_JOB_DIR, rel), schema);

let dir: string;
let baseline: Edl;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-director-"));
  const timeline = await read(jobPaths.timeline("desktop"), Timeline);
  const storyboard = await read(jobPaths.storyboard, Storyboard);
  const scripts = [await read(jobPaths.script("en"), Script), await read(jobPaths.script("hi"), Script)];
  const voices = [await read(jobPaths.voice("en"), Voiceover), await read(jobPaths.voice("hi"), Voiceover)];
  const creative = await read(jobPaths.creativeBrief, CreativeBrief);
  baseline = baselineEdl({
    timeline,
    storyboard,
    scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])),
    voices,
    personality: creative.personality,
  });
  await prepareWorkspace({
    dir,
    creative,
    product: await read(jobPaths.productBrief, ProductBrief),
    storyboard,
    scripts,
    timeline,
    voices,
    baseline,
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const edit = async (change: (edl: Edl) => void) => {
  const edl = JSON.parse(await readFile(join(dir, "edl.json"), "utf8")) as Edl;
  change(edl);
  await writeFile(join(dir, "edl.json"), JSON.stringify(edl));
};
const firstShot = (edl: Edl) => edl.segments.find((s) => s.kind === "shot") as ShotSegment;

/** A stand-in coding agent: each turn runs the next scripted change on the workspace. */
function fakeAgent(turns: ((task: AgentTask) => Promise<void> | void)[]) {
  const tasks: AgentTask[] = [];
  return {
    tasks,
    llm: {
      agent: vi.fn(async (task: AgentTask) => {
        tasks.push(task);
        await turns[tasks.length - 1]?.(task);
        return { sessionId: "session-1", text: `turn ${tasks.length}` };
      }),
    },
  };
}

describe("the workspace", () => {
  it("starts from a baseline that passes the check, with the brief and the data", async () => {
    const result = await checkWorkspace(dir);
    expect(errorsOf(result)).toEqual([]);
    const brief = await readFile(join(dir, "DIRECTOR.md"), "utf8");
    expect(brief).toContain(CHECK_COMMAND);
    expect(brief).toContain("untrusted data");
    expect(brief).toContain("en: string; hi: string");
  });

  it("lets the director run the check itself, failing while there are errors", async () => {
    const run = (cmd: string) => promisify(execFile)("sh", ["-c", cmd], { cwd: dir }).then((r) => r.stdout);
    expect(await run(CHECK_COMMAND)).toContain("passes the check");
    await edit(
      (edl) => (edl.style.motion.personality = edl.style.motion.personality === "premium" ? "playful" : "premium"),
    );
    await expect(run(CHECK_COMMAND)).rejects.toMatchObject({ stdout: expect.stringContaining("personality") });
  }, 30_000);
});

describe("the check", () => {
  it("catches what the director must not do", async () => {
    await edit((edl) => {
      const shot = firstShot(edl);
      shot.ramps = [{ from: shot.in, to: shot.in + 0.5, speed: 2 }];
      shot.camera = [
        { t: shot.out + 1, target: "full", zoom: 1, ease: "smooth" },
        { t: shot.in, target: [5000, 0, 10, 10], zoom: 2, ease: "spring" },
      ];
      shot.title = { text: { en: "Only English" }, seconds: 2 };
      shot.callouts = [{ t: shot.in + 0.5, text: { en: "Here", hi: "यहाँ" }, anchor: [10, 10, 20, 20] }];
      edl.segments = edl.segments.slice(1);
    });
    const messages = errorsOf(await checkWorkspace(dir))
      .map((i) => i.message)
      .join("\n");
    expect(messages).toMatch(/keep the baseline's segments in order/);
    // The first shot was dropped; check the edits on what's now first.
    await edit((edl) => (edl.segments = baseline.segments));
    await edit((edl) => {
      const shot = firstShot(edl);
      shot.ramps = [{ from: shot.in, to: shot.in + 0.6, speed: 2 }];
      shot.camera = [
        { t: shot.in + 0.1, target: [5000, 0, 10, 10], zoom: 2, ease: "spring" },
        { t: shot.out + 1, target: "full", zoom: 1, ease: "smooth" },
      ];
      shot.title = { text: { en: "Only English" }, seconds: 2 };
      shot.callouts = [{ t: shot.in + 0.5, text: { en: "Here", hi: "यहाँ" }, anchor: [10, 10, 20, 20] }];
    });
    const errors = errorsOf(await checkWorkspace(dir))
      .map((i) => i.message)
      .join("\n");
    expect(errors).toMatch(/a ramp speeds through the title/);
    expect(errors).toMatch(/isn't inside the 1440×900 recording/);
    expect(errors).toMatch(/outside the shot/);
    expect(errors).toMatch(/no text for hi/);
    expect(errors).toMatch(/overlaps the title/);
  });

  it("puts back the style fields the director doesn't own, with a warning, instead of failing", async () => {
    await edit((edl) => {
      (edl.style as Partial<Edl["style"]>).music = undefined;
      edl.style.palette = { ...edl.style.palette, accent: "#ff0000" };
    });
    const result = await checkWorkspace(dir);
    expect(errorsOf(result)).toEqual([]);
    expect(result.issues.filter((i) => i.severity === "warn").map((i) => i.at)).toEqual(
      expect.arrayContaining(["style.palette", "style.music"]),
    );
    const saved = JSON.parse(await readFile(join(dir, "edl.json"), "utf8")) as Edl;
    expect(saved.style.music).toEqual(baseline.style.music);
    expect(saved.style.palette).toEqual(baseline.style.palette);
  });

  it("reports broken JSON and schema errors instead of throwing", async () => {
    await writeFile(join(dir, "edl.json"), "{ not json");
    expect(errorsOf(await checkWorkspace(dir))[0]!.message).toMatch(/valid JSON/);
    await writeFile(join(dir, "edl.json"), JSON.stringify({ ...baseline, fps: 60 }));
    expect(errorsOf(await checkWorkspace(dir))[0]!.at).toBe("fps");
  });
});

describe("runDirector", () => {
  it("keeps a passing edit, reviews stills once, and returns the session for revisions", async () => {
    const { llm, tasks } = fakeAgent([() => edit((edl) => (edl.style.motion.hold = 1.5)), () => {}]);
    const renderStills = vi.fn(async () => [join(dir, "stills", "01-intro.jpg")]);
    const run = await runDirector({ llm, dir, renderStills });
    expect(run.fellBack).toBe(false);
    expect(run.edl.style.motion.hold).toBe(1.5);
    expect(run.reviewedStills).toBe(true);
    expect(run.sessionId).toBe("session-1");
    expect(tasks[0]!.prompt).toContain("DIRECTOR.md");
    expect(tasks[0]!.allowCommands).toEqual([CHECK_COMMAND]);
    expect(tasks[1]!.images).toEqual([join(dir, "stills", "01-intro.jpg")]);
    expect(tasks[1]!.resume).toBe("session-1");
  });

  it("sends the worker's errors back, then puts the edit it started from back if they stay", async () => {
    const broken = () => edit((edl) => (firstShot(edl).out = firstShot(edl).out + 50));
    const { llm, tasks } = fakeAgent([broken, broken, broken]);
    const run = await runDirector({ llm, dir });
    expect(tasks).toHaveLength(3);
    expect(tasks[1]!.prompt).toMatch(/found these problems[\s\S]*inside its beat's footage/);
    expect(run.fellBack).toBe(true);
    expect(run.repairRounds).toBe(2);
    expect(JSON.parse(await readFile(join(dir, "edl.json"), "utf8"))).toEqual(baseline);
  });

  it("is fixed by a repair round", async () => {
    const shot = firstShot(baseline);
    const { llm } = fakeAgent([
      () => edit((edl) => (firstShot(edl).out = shot.out + 50)),
      () => edit((edl) => (firstShot(edl).out = shot.out - 0.2)),
    ]);
    const run = await runDirector({ llm, dir });
    expect(run).toMatchObject({ fellBack: false, repairRounds: 1 });
    expect(firstShot(run.edl).out).toBeCloseTo(shot.out - 0.2);
  });

  it("resumes the session with the person's words for a revision", async () => {
    const { llm, tasks } = fakeAgent([() => edit((edl) => (edl.style.frame = "none"))]);
    const run = await runDirector({ llm, dir, resume: "session-0", revise: "Make it full screen" });
    expect(tasks[0]!.resume).toBe("session-0");
    expect(tasks[0]!.prompt).toContain('"Make it full screen"');
    expect(run.edl.style.frame).toBe("none");
  });
});

describe("runDirector when the agent fails", () => {
  it("puts the edit it started from back and passes the error on", async () => {
    const llm = {
      agent: vi.fn(async () => {
        await edit((edl) => (firstShot(edl).out = 999));
        throw new Error("llm.limit: usage limit reached");
      }),
    };
    await expect(runDirector({ llm, dir })).rejects.toThrow(/usage limit/);
    expect(JSON.parse(await readFile(join(dir, "edl.json"), "utf8"))).toEqual(baseline);
  });
});
