import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { customScenes } from "./composition.ts";
import { restoreScene, runDirector, scopeIssues } from "./director.ts";
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

  it("repairs invalid changes from the still review before accepting them", async () => {
    const original = firstShot(baseline).out;
    const { llm, tasks } = fakeAgent([
      () => edit((edl) => (edl.style.motion.hold = 1.5)),
      () => edit((edl) => (firstShot(edl).out = 999)),
      () => edit((edl) => (firstShot(edl).out = original)),
    ]);
    const run = await runDirector({ llm, dir, renderStills: async () => [join(dir, "frame.jpg")] });
    expect(tasks).toHaveLength(3);
    expect(tasks[2]!.prompt).toContain("still-review changes");
    expect(run).toMatchObject({ fellBack: false, reviewedStills: true, repairRounds: 1 });
    expect(run.edl.style.motion.hold).toBe(1.5);
    expect(errorsOf(await checkWorkspace(dir))).toEqual([]);
  });

  it("retains the checked first pass when still-review repairs remain invalid", async () => {
    const broken = () => edit((edl) => (firstShot(edl).out = 999));
    const { llm } = fakeAgent([
      () => edit((edl) => (edl.style.motion.hold = 1.5)), broken, broken, broken,
    ]);
    const run = await runDirector({ llm, dir, renderStills: async () => [join(dir, "frame.jpg")] });
    expect(run).toMatchObject({ fellBack: false, repairRounds: 2 });
    expect(run.edl.style.motion.hold).toBe(1.5);
    expect(firstShot(run.edl).out).toBe(firstShot(baseline).out);
    expect(run.warnings.join()).toContain("retained the last checked director edit");
    expect(errorsOf(await checkWorkspace(dir))).toEqual([]);
  });

  it("keeps the valid director edit if its still-review turn hits a usage limit", async () => {
    const { llm } = fakeAgent([
      () => edit((edl) => (edl.style.motion.hold = 1.5)),
      async () => { await edit((edl) => (firstShot(edl).out = 999)); throw new Error("llm.limit: usage limit reached"); },
    ]);
    const run = await runDirector({ llm, dir, renderStills: async () => [join(dir, "frame.jpg")] });
    expect(run.fellBack).toBe(false);
    expect(run.edl.style.motion.hold).toBe(1.5);
    expect(firstShot(run.edl).out).toBe(firstShot(baseline).out);
    expect(run.warnings.join()).toContain("usage limit");
    expect(errorsOf(await checkWorkspace(dir))).toEqual([]);
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

describe("a revision of one part", () => {
  it("lets that part change and nothing else", () => {
    const [a, b] = baseline.segments.filter((s) => s.kind === "shot") as ShotSegment[];
    const changed = (edit: (edl: Edl) => void) => {
      const edl = structuredClone(baseline);
      edit(edl);
      return edl;
    };
    expect(scopeIssues(baseline, changed((e) => ((e.segments.find((s) => s.id === a!.id) as ShotSegment).out -= 0.2)), a!.id)).toEqual([]);
    expect(scopeIssues(baseline, changed((e) => ((e.segments.find((s) => s.id === b!.id) as ShotSegment).out -= 0.2)), a!.id).map((i) => i.at)).toEqual(["segments"]);
    expect(scopeIssues(baseline, changed((e) => (e.style.frame = "none")), a!.id).map((i) => i.at)).toEqual(["style"]);
    expect(scopeIssues(baseline, changed((e) => (e.intro.seconds += 1)), "intro")).toEqual([]);
  });

  it("names the part in the prompt, and sends a change elsewhere back to be undone", async () => {
    const [a, b] = baseline.segments.filter((s) => s.kind === "shot") as ShotSegment[];
    const { llm, tasks } = fakeAgent([
      () => edit((edl) => ((edl.segments.find((s) => s.id === b!.id) as ShotSegment).out = b!.out - 0.2)),
      () => edit((edl) => (edl.segments = edl.segments.map((s) => (s.id === b!.id ? b! : s)))),
    ]);
    const run = await runDirector({ llm, dir, resume: "session-0", revise: "Shorter", scene: a!.id });
    expect(tasks[0]!.prompt).toContain(`\`${a!.id}\``);
    expect(tasks[1]!.prompt).toMatch(/only .* may change/);
    expect(run).toMatchObject({ fellBack: false, repairRounds: 1 });
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

describe("runDirector's scene files", () => {
  const scene = (id: string, body = "") =>
    `<template><div id="root" data-composition-id="${id}" data-width="960" data-height="540">${body}</div><script>(function () { var S = AC.scene("${id}", window.__hyperframes.getVariables()); S.done(); })();</script></template>`;
  const hash = (text: string) => createHash("sha1").update(text).digest("hex");
  const scenes = join("composition", "compositions");
  const compiled = join("composition", "compiled.json");
  /** A compiled workspace with two of the compiler's own scene files. */
  const compose = async () => {
    await mkdir(join(dir, scenes), { recursive: true });
    await writeFile(join(dir, scenes, "a.html"), scene("a"));
    await writeFile(join(dir, scenes, "b.html"), scene("b"));
    await writeFile(join(dir, compiled), JSON.stringify({ a: hash(scene("a")), b: hash(scene("b")) }));
  };

  it("puts the compiler's list back with the files when a turn fails, so its files don't read as the director's", async () => {
    await compose();
    const llm = {
      agent: vi.fn(async () => {
        // The director's check recompiles a changed edit, then the turn times out.
        await writeFile(join(dir, scenes, "a.html"), scene("a", "newer"));
        await writeFile(join(dir, scenes, "c.html"), scene("c"));
        await rm(join(dir, scenes, "b.html"));
        await writeFile(join(dir, compiled), JSON.stringify({ a: hash(scene("a", "newer")), c: hash(scene("c")) }));
        throw new Error("llm.timeout");
      }),
    };
    await expect(runDirector({ llm, dir })).rejects.toThrow(/timeout/);
    expect([...(await customScenes(dir)).keys()]).toEqual([]);
    expect(await readFile(join(dir, scenes, "a.html"), "utf8")).toBe(scene("a"));
    await expect(readFile(join(dir, scenes, "c.html"))).rejects.toThrow();
  });

  it("returns a scene that broke the contract to the compiler, not to the director", async () => {
    await compose();
    const before = { files: new Map([["a.html", scene("a")]]), compiled: await readFile(join(dir, compiled), "utf8") };
    // A recompile keeps the director's file, so it leaves the compiler's list.
    await writeFile(join(dir, scenes, "a.html"), scene("a", "broken"));
    await writeFile(join(dir, compiled), JSON.stringify({ b: hash(scene("b")) }));
    await restoreScene(dir, "a", before);
    expect([...(await customScenes(dir)).keys()]).toEqual([]);
  });
});
