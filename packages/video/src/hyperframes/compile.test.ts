import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  it("opens a typing close-up closer than the page it pulls back to, in a window that fills the frame", async () => {
    const out = join(root, "led-prompt");
    const made = ledInput();
    // A low-density recording and a small field: the window must still fill most of the canvas.
    const small = { ...made, footage: { ...made.footage, timeline: { ...made.footage.timeline, viewport: { ...made.footage.timeline.viewport, dpr: 1.33 } } } };
    await compileComposition({ input: small, root, out });
    const html = await readFile(join(out, "compositions", "sixth.html"), "utf8");
    const width = Number(/#sixth-win \{ left: [\d.-]+px; top: [\d.-]+px; width: ([\d.]+)px/.exec(html)![1]);
    expect(width).toBeGreaterThan(960 * 0.7);
    const index = await readFile(join(out, "index.html"), "utf8");
    const vars = JSON.parse(/data-composition-id="sixth"[^>]*data-variable-values='([^']*)'/.exec(index)![1]!.replaceAll("&quot;", '"')) as { near: string; far: string };
    expect(JSON.parse(vars.near)[2]).toBeGreaterThan(JSON.parse(vars.far)[2]);
  });

  it("draws art direction's brand moves: the logo in pieces, the hand on a click, the ground's world", async () => {
    const out = join(root, "led-brand");
    const made = ledInput();
    const edl = Edl.parse({ ...made.edl, schemaVersion: 8, style: { ...made.edl.style, brand: { logo: "lockup", cursor: "hand", world: "bloom" } } });
    const timeline = { ...made.footage.timeline, events: [...made.footage.timeline.events, { flowId: "f", stepId: "s", kind: "click" as const, label: "x", url: "https://x.example", t: 1.2, bbox: [400, 300, 100, 40] as [number, number, number, number] }] };
    // The compiler only places the logo's file, so any file stands in for it.
    await mkdir(join(root, "brief"), { recursive: true });
    await writeFile(join(root, "brief", "logo.png"), "png");
    const logo = { src: "brief/logo.png", width: 400, height: 100, plate: false, parts: { kind: "mark+wordmark" as const, mark: [0, 0.25] as [number, number], letters: [[0.36, 0.47], [0.49, 0.52]] as [number, number][] } };
    await compileComposition({ input: { ...made, edl, footage: { ...made.footage, timeline }, brand: { ...made.brand, logo } }, root, out });
    const end = await readFile(join(out, "compositions", "outro.html"), "utf8");
    expect(end).toContain('id="outro-mark"');
    expect(end).toContain('id="outro-l1"');
    const proof = await readFile(join(out, "compositions", "second.html"), "utf8");
    expect(proof).toContain('id="second-cur"');
    const index = await readFile(join(out, "index.html"), "utf8");
    expect(index).toMatch(/data-composition-id="ground"[^>]*&quot;world&quot;:&quot;bloom&quot;/);
  });

  it("draws the brand moves from the job's own material, plays the output and ducks the music under it", async () => {
    const out = join(root, "led-moves");
    const made = ledInput();
    for (const dir of ["brief/captures", "brief/logos", "record/output"]) await mkdir(join(root, dir), { recursive: true });
    const pages = Array.from({ length: 6 }, (_, i) => `brief/captures/0${i + 1}.jpg`);
    const logos = Array.from({ length: 4 }, (_, i) => `brief/logos/0${i + 1}.png`);
    for (const f of [...pages, ...logos, "record/output/f-01.wav"]) await writeFile(join(root, f), "x");
    const peaks = Array.from({ length: 16 }, (_, i) => (i % 4) / 4);
    const moves = [
      { kind: "primitive", id: "wall", primitive: { type: "wall", pages, focus: 0 }, seconds: 4, transitionIn: "cut" },
      { kind: "primitive", id: "pill", primitive: { type: "pill", flowId: "f", text: "plan the launch", at: 1, press: true }, seconds: 3, transitionIn: "cut" },
      { kind: "primitive", id: "lap", primitive: { type: "mockup", flowId: "f", in: 0, out: 3, frame: [0, 0, 1440, 900], device: "laptop" }, seconds: 3, transitionIn: "cut" },
      { kind: "primitive", id: "voice", primitive: { type: "output", file: "record/output/f-01.wav", from: 0, seconds: 2, peaks }, seconds: 3, transitionIn: "cut" },
      { kind: "primitive", id: "orbit", primitive: { type: "orbit", logos }, seconds: 4, transitionIn: "cut" },
    ];
    const edl = Edl.parse({ ...made.edl, schemaVersion: 8, segments: moves, style: { ...made.edl.style, brand: { logo: "fade", cursor: "hand", world: "plain", opener: "line" } } });
    const music = "render/audio/music.mp3";
    await mkdir(join(root, "render/audio"), { recursive: true });
    await writeFile(join(root, music), "x");
    const { scenes } = await compileComposition({ input: { ...made, edl, audio: { sfx: {}, music } }, root, out });
    expect(scenes.map((x) => x.kind)).toEqual(["opener", "wall", "pill", "mockup", "output", "orbit", "endcard"]);
    for (const f of ["assets/pages/01.jpg", "assets/cloud/04.png", "assets/output/f-01.wav"]) await expect(stat(join(out, f))).resolves.toBeTruthy();
    expect(await readFile(join(out, "compositions", "pill.html"), "utf8")).toContain('id="pill-cur"');
    const index = await readFile(join(out, "index.html"), "utf8");
    // The output plays a beat into its part (wall 4 s + pill 3 s + mockup 3 s after the 4 s opener = 14 s).
    expect(index).toMatch(/<audio id="out-1" src="assets\/output\/f-01.wav" data-start="14.5"/);
    const automation = JSON.parse(/id="music"[^>]*data-automation='([^']*)'/.exec(index)![1]!.replaceAll("&quot;", '"')) as { lanes: { points: { t: number; v: number }[] }[] };
    const at = (t: number) => automation.lanes[0]!.points.filter((p) => p.t <= t).at(-1)!.v;
    expect(at(15)).toBeLessThan(at(12));
  });

  it("makes each move for the variant's size, even over a file from another size", async () => {
    const out = join(root, "led-resized");
    const small = ledInput();
    await compileComposition({ input: small, root, out });
    const path = join(out, "compositions", "second.html");
    const widthOf = async () => Number(/#second-win \{ left: [\d.-]+px; top: [\d.-]+px; width: ([\d.]+)px/.exec(await readFile(path, "utf8"))![1]);
    const at540 = await widthOf();
    // A file the compiler doesn't recognise, as after a stale list or a director's edit.
    await writeFile(path, (await readFile(path, "utf8")).replace("<template>", "<template><!-- changed -->"));
    const { scenes } = await compileComposition({ input: { ...small, height: 1080 }, root, out, scenes: join(out, "compositions") });
    expect(scenes.find((s) => s.id === "second")!.custom).toBe(false);
    expect(await readFile(path, "utf8")).not.toContain("<!-- changed -->");
    expect(await widthOf()).toBeCloseTo(at540 * 2, 0);
  });
});
