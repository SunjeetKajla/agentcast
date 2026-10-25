import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

