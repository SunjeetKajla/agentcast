import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Brand,
  CreativeBrief,
  Edl,
  MOTION_PRESETS,
  Script,
  Storyboard,
  Timeline,
  Voiceover,
  jobPaths,
} from "@agentcast/shared";
import { FIXTURE_JOB_DIR, readArtifact } from "@agentcast/shared/node";
import { baselineEdl } from "./baseline.ts";
import { cameraAt, cropFor, project } from "./camera.ts";
import { scriptCaptions, voiceCaptions } from "./captions.ts";
import { bezier, moveSeconds } from "./motion.ts";
import { sfxCues } from "./audio.ts";
import { chooseLook, DEFAULT_LOOK } from "./look.ts";
import { clockOf, speedAt } from "./retime.ts";
import { assignNarration, beatParts, cursorAt, outputSize, planParts, VOICE_SPACING } from "./plan.ts";

const read = <S extends Parameters<typeof readArtifact>[1]>(rel: string, schema: S) =>
  readArtifact(join(FIXTURE_JOB_DIR, rel), schema);
const fixture = async () => ({
  timeline: await read(jobPaths.timeline("desktop"), Timeline),
  storyboard: await read(jobPaths.storyboard, Storyboard),
  scripts: { en: await read(jobPaths.script("en"), Script), hi: await read(jobPaths.script("hi"), Script) },
  voices: [await read(jobPaths.voice("en"), Voiceover), await read(jobPaths.voice("hi"), Voiceover)],
  brand: await read(jobPaths.brand, Brand),
  personality: (await read(jobPaths.creativeBrief, CreativeBrief)).personality,
});
const motion = MOTION_PRESETS.corporate;
const src = { w: 1440, h: 900 };

describe("motion", () => {
  it("follows a cubic-bezier like CSS", () => {
    expect(bezier([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 3);
    expect(bezier([0.4, 0, 0.2, 1], 0)).toBe(0);
    expect(bezier([0.4, 0, 0.2, 1], 1)).toBe(1);
    expect(bezier([0.34, 1.56, 0.64, 1], 0.6)).toBeGreaterThan(1);
  });
});

describe("camera", () => {
  it("sees the whole 16:9 frame at zoom 1 and a full-height column for 9:16", () => {
    expect(cropFor("full", 1, src, 16 / 9)).toEqual({ x: 0, y: 45, w: 1440, h: 810 });
    const column = cropFor("full", 1, src, 9 / 16);
    expect(column.h).toBe(900);
    expect(column.x).toBeCloseTo((1440 - column.w) / 2);
  });

  it("centres on a target and stays inside the recording", () => {
    const crop = cropFor([1300, 20, 100, 40], 2, src, 16 / 9);
    expect(crop.x + crop.w).toBeCloseTo(1440);
    expect(crop.y).toBe(0);
    expect(crop.w).toBeCloseTo(720);
  });

  it("moves from the full frame to its key over one move, then holds", () => {
    const keys = [
      { t: 1, target: [600, 400, 100, 50] as [number, number, number, number], zoom: 2, ease: "spring" as const },
    ];
    expect(cameraAt(keys, 0.5, src, 16 / 9, motion)).toEqual(cropFor("full", 1, src, 16 / 9));
    const landed = cameraAt(keys, 1 + moveSeconds(motion), src, 16 / 9, motion);
    expect(landed.w).toBeCloseTo(720);
    const midway = cameraAt(keys, 1 + moveSeconds(motion) / 2, src, 16 / 9, motion);
    expect(midway.w).toBeLessThan(1440);
    expect(midway.w).toBeGreaterThan(720);
  });

  it("projects recording points into the output", () => {
    expect(project([720, 405], { x: 0, y: 0, w: 1440, h: 810 }, { w: 1920, h: 1080 })).toEqual([960, 540]);
  });
});

describe("baseline edit", () => {
  it("cuts the fixture storyboard into a valid edit with camera moves and on-screen text", async () => {
    const f = await fixture();
    const edl = baselineEdl(f);
    expect(Edl.parse(edl)).toEqual(edl);
    const shots = edl.segments.filter((s) => s.kind === "shot");
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      const beat = f.storyboard.beats.find((b) => b.id === shot.beatId)!;
      expect([shot.in, shot.out]).toEqual([beat.in, beat.out]);
      shot.camera.forEach((k, i) => {
        expect(k.t).toBeGreaterThanOrEqual(shot.in);
        expect(k.t).toBeLessThan(shot.out);
        if (i) expect(k.t).toBeGreaterThan(shot.camera[i - 1]!.t);
      });
    }
    expect(shots.some((s) => s.camera.some((k) => k.target !== "full"))).toBe(true);
    // Brand kit style, and Hindi on-screen text from the Hindi script.
    expect(edl.style.palette.accent).toBe(f.brand.palette.accent);
    const text = shots.flatMap((s) => [...(s.callouts ?? []).map((c) => c.text), ...(s.title ? [s.title.text] : [])]);
    expect(text.length).toBeGreaterThan(0);
    for (const t of text) expect(Object.keys(t).sort()).toEqual(["en", "hi"]);
  });

  it("refuses a storyboard with no footage", async () => {
    const f = await fixture();
    const storyboard = { ...f.storyboard, beats: f.storyboard.beats.filter((b) => !b.flowId) };
    expect(() => baselineEdl({ ...f, storyboard })).toThrow(/no footage/);
  });
});

describe("timing", () => {
  it("lays parts end to end, overlapping only at transitions, and fits every voice line", async () => {
    const f = await fixture();
    const edl = baselineEdl(f);
    const narration = assignNarration(f.storyboard, f.voices[0]!, edl);
    const { parts, clips, frames } = planParts(edl, narration);
    expect(parts.map((p) => p.id)).toEqual(["intro", ...edl.segments.map((s) => s.id), "outro"]);
    for (const [i, p] of parts.entries()) {
      const next = parts[i + 1];
      if (next) expect(next.from).toBe(p.from + p.frames - next.enter.frames);
      expect(p.exit).toEqual(next?.enter ?? { kind: "cut", frames: 0 });
    }
    expect(frames).toBe(parts.at(-1)!.from + parts.at(-1)!.frames);
    // Every line starts after the one before ends, and ends inside its part.
    clips.forEach((c, i) => {
      if (i) expect(c.from).toBeGreaterThanOrEqual(clips[i - 1]!.from + clips[i - 1]!.frames);
    });
    expect(clips.length).toBe(narration.length);
    expect(clips.at(-1)!.from + clips.at(-1)!.frames).toBeLessThanOrEqual(frames);
    // A part holds long enough for its lines.
    for (const p of parts) {
      const seconds = narration.filter((n) => n.part === p.id).reduce((s, n) => s + n.seconds, 0);
      if (seconds) expect(p.frames / 30).toBeGreaterThan(seconds + VOICE_SPACING.lead);
    }
  });

  it("sends hook lines to the title card and CTA lines to the outro", async () => {
    const f = await fixture();
    const edl = baselineEdl(f);
    const parts = beatParts(f.storyboard, edl);
    for (const beat of f.storyboard.beats) {
      if (beat.role === "hook") expect(parts.get(beat.id)).toBe("intro");
      if (beat.role === "cta") expect(parts.get(beat.id)).toBe("outro");
    }
  });

  it("sizes outputs for each aspect", () => {
    expect(outputSize("16x9", 1080)).toEqual({ w: 1920, h: 1080 });
    expect(outputSize("9x16", 1080)).toEqual({ w: 1080, h: 1920 });
    expect(outputSize("16x9", 540)).toEqual({ w: 960, h: 540 });
  });
});

describe("captions", () => {
  it("follows the voice in short lines that never overlap", async () => {
    const f = await fixture();
    const edl = baselineEdl(f);
    const { clips } = planParts(edl, assignNarration(f.storyboard, f.voices[0]!, edl));
    const captions = voiceCaptions(clips);
    expect(captions.length).toBeGreaterThanOrEqual(clips.length);
    captions.forEach((c, i) => {
      expect(c.text.split(" ").length).toBeLessThanOrEqual(7);
      expect(c.end).toBeGreaterThan(c.start);
      if (i) expect(c.start).toBeGreaterThanOrEqual(captions[i - 1]!.end);
    });
  });

  it("spreads the script over each part without a voice", async () => {
    const f = await fixture();
    const edl = baselineEdl({ ...f, voices: [] });
    const { parts } = planParts(edl);
    const captions = scriptCaptions(parts, edl, f.storyboard, f.scripts.en);
    expect(captions.length).toBeGreaterThan(0);
    expect(captions.map((c) => c.text).join(" ")).toContain(f.scripts.en.segments[0]!.text.split(" ")[0]!);
  });
});

describe("cursor", () => {
  it("follows recorded moves, ripples after a click and hides when idle", async () => {
    const { timeline } = await fixture();
    const click = timeline.events.find((e) => e.kind === "click" && e.cursor)!;
    const moving = cursorAt(timeline.events, (click.cursor!.t0 + click.cursor!.t1) / 2);
    expect(moving.visible).toBe(true);
    const clicked = cursorAt(timeline.events, click.t + 0.1);
    expect(clicked.clicked).toBeCloseTo(0.1);
    expect(cursorAt([], 1).visible).toBe(false);
    const last = Math.max(...timeline.events.map((e) => e.cursor?.t1 ?? e.t));
    expect(cursorAt(timeline.events, last + 3).visible).toBe(false);
  });
});

describe("speed ramps", () => {
  const shot = { in: 2, out: 12, ramps: [{ from: 4, to: 8, speed: 3 }] };
  it("shortens the shot and maps output and source time both ways", () => {
    const clock = clockOf(shot);
    expect(clock.seconds).toBeLessThan(10);
    expect(clock.seconds).toBeGreaterThan(10 - 4 * (1 - 1 / 3));
    for (const s of [2, 3.5, 5, 6, 7.9, 11]) expect(clock.toSource(clock.toOutput(s))).toBeCloseTo(s, 2);
    expect(clock.toSource(0)).toBe(2);
    expect(clock.toSource(99)).toBeCloseTo(12);
  });
  it("eases in and out of its speed", () => {
    const ramps = shot.ramps;
    expect(speedAt(ramps, 3.9)).toBe(1);
    expect(speedAt(ramps, 4.05)).toBeLessThan(2);
    expect(speedAt(ramps, 6)).toBe(3);
    expect(speedAt(ramps, 7.95)).toBeLessThan(2);
  });
  it("is the plain offset without ramps", () => {
    const clock = clockOf({ in: 1, out: 4 });
    expect(clock.seconds).toBe(3);
    expect(clock.toSource(1.5)).toBe(2.5);
  });
});

describe("a trailer baseline", () => {
  it("has sound effects, tilted windows, the brand's look and a closing montage", async () => {
    const f = await fixture();
    expect(f.storyboard.edit).toBe("trailer");
    const edl = baselineEdl(f);
    expect(edl.style).toMatchObject({ sfx: "auto", frame: "tilt" });
    expect(edl.style.look).toEqual(chooseLook(f.brand, f.personality, new URL(f.brand.url).host));
    const montage = edl.segments.at(-1)!;
    if (edl.segments.filter((s) => s.kind === "shot").length >= 2) {
      expect(montage.kind).toBe("montage");
      if (montage.kind === "montage") for (const c of montage.clips) expect(c.out - c.in).toBeGreaterThanOrEqual(1);
    }
    for (const s of edl.segments)
      if (s.kind === "shot")
        for (const r of s.ramps ?? []) {
          expect(r.from).toBeGreaterThanOrEqual(s.in);
          expect(r.to).toBeLessThanOrEqual(s.out);
        }
  });

  it("places its sound effects on the moments", async () => {
    const f = await fixture();
    const edl = baselineEdl(f);
    const { parts, frames } = planParts(edl, assignNarration(f.storyboard, f.voices[0]!, edl));
    const cues = sfxCues(edl, parts, f.timeline, frames);
    const kinds = new Set(cues.map((c) => c.kind));
    for (const kind of ["riser", "hit", "whoosh"]) expect(kinds).toContain(kind);
    if (f.timeline.events.some((e) => e.kind === "click")) expect(kinds).toContain("click");
    for (const c of cues) expect(c.frame).toBeLessThan(frames);
    expect(sfxCues({ ...edl, style: { ...edl.style, sfx: "none" } }, parts, f.timeline, frames)).toEqual([]);
  });
});

describe("the look", () => {
  it("is stable per site, follows the brand's theme, and only splits beside a hero", async () => {
    const { brand } = await fixture();
    const a = chooseLook(brand, "premium", "linear.app");
    expect(chooseLook(brand, "premium", "linear.app")).toEqual(a);
    expect(a.theme).toBe(brand.theme);
    const noHero = { ...brand, hero: undefined };
    for (const seed of ["a", "b", "c", "d", "e"]) expect(chooseLook(noHero, "corporate", seed).title).not.toBe("split");
    const greyscale = { ...brand, accentFrom: "text" as const, gradient: undefined };
    for (const p of ["playful", "energetic"] as const) expect(chooseLook(greyscale, p, "x").backdrop).not.toBe("mesh");
    expect(chooseLook(undefined, "premium", "x")).toEqual(DEFAULT_LOOK);
  });
});
