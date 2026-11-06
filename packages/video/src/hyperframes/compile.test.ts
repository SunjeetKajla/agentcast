import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Edl, Timeline, jobPaths, type Aspect } from "@agentcast/shared";
import { FIXTURE_JOB_DIR, readArtifact } from "@agentcast/shared/node";
import type { VideoInput } from "../plan.ts";
import { accentOf, canvasOf, compileComposition } from "./compile.ts";

let root: string;
let edl: Edl;
let timeline: Timeline;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "agentcast-compile-"));
  await cp(FIXTURE_JOB_DIR, root, { recursive: true });
  edl = await readArtifact(join(root, jobPaths.edl), Edl);
  timeline = await readArtifact(join(root, jobPaths.timeline("desktop")), Timeline);
});
afterAll(() => rm(root, { recursive: true, force: true }));

const input = (aspect: Aspect = "16x9", height = 540, over: Partial<VideoInput> = {}): VideoInput => ({
  edl,
  aspect,
  lang: "en",
  footage: { src: jobPaths.recording("desktop"), timeline },
  narration: [],
  captions: [{ text: "A line under a shot", start: 0.2, end: 1.2 }],
  copy: { title: "Make demos in minutes", cta: "Try it free" },
  brand: { name: "Fixture", site: "fixture.example" },
  height,
  ...over,
});

describe("compileComposition", () => {
  it("places every part as a scene host on the plan's timeline, over the ground", async () => {
    const out = join(root, "c1");
    const { duration, scenes } = await compileComposition({ input: input(), root, out });
    const html = await readFile(join(out, "index.html"), "utf8");
    expect(scenes[0]!.id).toBe("intro");
    expect(scenes.at(-1)!.id).toBe("outro");
    expect(scenes).toHaveLength(edl.segments.length + 2);
    for (const s of scenes) {
      expect(html).toContain(`data-composition-src="compositions/${s.id}.html"`);
      const file = await readFile(join(out, "compositions", `${s.id}.html`), "utf8");
      expect(file).toMatch(/^<template>/);
      expect(file).toContain(`data-composition-id="${s.id}"`);
    }
    expect(html).toContain('data-composition-id="ground"');
    expect(html).toContain(`data-duration="${Math.round(duration * 1000) / 1000}"`);
    expect(html).toContain('<script src="assets/gsap.min.js"></script>');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(scenes.every((s) => !s.custom)).toBe(true);
  });

  it("keeps a scene file the director changed, at this variant's size, and makes the rest afresh", async () => {
    const out = join(root, "c2");
    await compileComposition({ input: input(), root, out });
    const shot = edl.segments.find((s) => s.kind === "shot")!.id;
    const path = join(out, "compositions", `${shot}.html`);
    const mine = (await readFile(path, "utf8")).replace("<template>", "<template><!-- mine -->");
    await writeFile(path, mine);
    const again = await compileComposition({ input: input("16x9", 1080), root, out, scenes: join(out, "compositions") });
    expect(again.scenes.find((s) => s.id === shot)!.custom).toBe(true);
    expect(again.scenes.filter((s) => s.custom)).toHaveLength(1);
    const kept = await readFile(path, "utf8");
    expect(kept).toContain("<!-- mine -->");
    expect(kept).toContain('data-width="1920"');
    expect(kept).not.toContain('data-width="960"');
  });

  it("uses a portrait canvas for 9:16 and keeps trailer captions off headline scenes", async () => {
    const out = join(root, "c3");
    const trailer = { ...edl, style: { ...edl.style, edit: "trailer" as const } };
    const { scenes } = await compileComposition({
      input: input("9x16", 1080, { edl: trailer, captions: [{ text: "Over the title", start: 0.1, end: 0.9 }] }),
      root,
      out,
    });
    const html = await readFile(join(out, "index.html"), "utf8");
    expect(html).toContain('data-width="1080" data-height="1920"');
    expect(scenes.some((s) => s.id === "captions")).toBe(false);
    expect(html).not.toContain('data-composition-id="captions"');
  });
});

describe("helpers", () => {
  it("accents a headline's last strong word", () => {
    expect(accentOf("Every component, one command")).toBe("command");
    expect(accentOf("Works with your stack")).toBe("stack");
    expect(accentOf("Own it")).toBe("it");
  });

  it("sizes the canvas per variant", () => {
    expect(canvasOf("16x9", 540)).toEqual({ w: 960, h: 540, u: 0.5 });
    expect(canvasOf("16x9", 1080)).toEqual({ w: 1920, h: 1080, u: 1 });
    expect(canvasOf("9x16", 1080)).toEqual({ w: 1080, h: 1920, u: 1 });
  });
});

describe("a music-led edit", () => {
  const ledInput = () => {
    const edl2: Edl = {
      ...edl,
      schemaVersion: 7,
      style: { ...edl.style, timing: "music", sfx: "none", music: { mood: "none", bpm: 120, duckDb: -6 } },
      intro: { component: "Opener", props: { line: { en: "Plan and navigate from idea to launch" } }, seconds: 4 },
      outro: { component: "EndCard", props: { line: { en: "Get started" } }, seconds: 4 },
      segments: [
        { kind: "primitive", id: "first", primitive: { type: "label", text: { en: "Plan it" }, ground: "invert", open: "iris" }, seconds: 1, transitionIn: "cut" },
        { kind: "primitive", id: "second", primitive: { type: "proof", flowId: "f", in: 0, out: 2, frame: [100, 100, 800, 500], tilt: "soft", hops: [[120, 120, 700, 50]] }, seconds: 3, transitionIn: "cut" },
        { kind: "primitive", id: "third", primitive: { type: "build", flowId: "f", at: 1, items: [[0, 0, 200, 400], [200, 0, 200, 400], [400, 0, 200, 400]], reveal: "rise", lift: [200, 0, 200, 100] }, seconds: 3, transitionIn: "cut" },
        { kind: "primitive", id: "fourth", primitive: { type: "swap", lead: { en: "See it as a" }, words: [{ en: "list" }, { en: "board" }], style: "swap" }, seconds: 2, transitionIn: "cut" },
        { kind: "primitive", id: "fifth", primitive: { type: "ticker", terms: [{ en: "Issues" }, { en: "Cycles" }, { en: "Projects" }] }, seconds: 2, transitionIn: "cut" },
        { kind: "primitive", id: "sixth", primitive: { type: "prompt", flowId: "f", in: 0, out: 2, input: [200, 200, 400, 40], frame: [100, 100, 800, 500] }, seconds: 3, transitionIn: "cut" },
      ],
    };
    return input("16x9", 540, { edl: Edl.parse(edl2), captions: [] });
  };

  it("draws each move as a scene file, on a plain ground", async () => {
    const out = join(root, "led-composition");
    const { scenes } = await compileComposition({ input: ledInput(), root, out });
    expect(scenes.map((s) => s.kind)).toEqual(["opener", "label", "proof", "build", "swap", "ticker", "prompt", "endcard"]);
    // Parts sit on the grid: each starts as the last one ends.
    scenes.slice(1).forEach((s, i) => expect(s.start).toBeCloseTo(scenes[i]!.start + scenes[i]!.duration, 3));
    const ground = await readFile(join(out, "compositions", "ground.html"), "utf8");
    expect(ground).toContain("--ac-lift");
    const build = await readFile(join(out, "compositions", "third.html"), "utf8");
    expect(build).toContain("assets/still-third.png");
    await expect(stat(join(out, "assets", "still-third.png"))).resolves.toBeTruthy();
    const proof = await readFile(join(out, "compositions", "second.html"), "utf8");
    expect(proof).toContain('data-media-start="0"');
    expect(proof).not.toMatch(/Math\.random|Date\.now|setTimeout/);
  });

  it("fits a tall canvas", async () => {
    const out = join(root, "led-tall");
    const made = ledInput();
    const { scenes } = await compileComposition({ input: { ...made, aspect: "9x16", height: 1080 }, root, out });
    expect(scenes).toHaveLength(8);
    const proof = await readFile(join(out, "compositions", "second.html"), "utf8");
    const width = Number(/#second-win \{ left: [\d.-]+px; top: [\d.-]+px; width: ([\d.]+)px/.exec(proof)![1]);
    expect(width).toBeLessThanOrEqual(1080);
  });
});
