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
  type Layout,
  type PrimitiveSegment,
  type Rect,
  type ShotSegment,
  type TimelineEvent,
} from "@agentcast/shared";
import { FIXTURE_JOB_DIR, readArtifact } from "@agentcast/shared/node";
import { baselineEdl } from "./baseline.ts";
import { cameraAt, cropFor, project } from "./camera.ts";
import { scriptCaptions, voiceCaptions } from "./captions.ts";
import { bezier, moveSeconds } from "./motion.ts";
import { BED_LUFS, DUCK_DB, musicAutomation, sfxCues, type Sounds } from "./audio.ts";
import { masteringGainDb } from "./hyperframes/render.ts";
import { musicStyle, pickTrack } from "./music.ts";
import { entriesOf, regularGrid } from "./musicanalysis.ts";
import { beatsOf, ledStyle, planMusic } from "./musicplan.ts";
import { shapeOf } from "./sound.ts";
import { busiestRegion, contentBox, pixelColumns } from "./content.ts";
import { loadReferenceLibrary } from "./references.ts";
import { beatSheetOf, describeBeatSheet } from "./ledfilm.ts";
import { inventoryOf, planLayers } from "./layers.ts";
import { pressesIn } from "./primitives/cursor.ts";
import { cardCues, openerSlot, phrasesOf, primitiveCues } from "./primitives/index.ts";
import { chipFor, chooseSkeleton, DEFAULT_SKELETON, filmSeconds, ledEdl, ledPlan, productShape, snapToGrid } from "./template.ts";
import { buildStep, liftAt } from "./primitives/cues.ts";
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
const editAndTimeline = async () => {
  const f = await fixture();
  return { edl: baselineEdl(f), timeline: f.timeline };
};
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

describe("the sound effects", () => {
  const measured: Sounds = {
    whoosh: [{ peak: 0.3, levelDb: -12 }, { peak: 0.28, levelDb: -12 }],
    click: [{ peak: 0.002, levelDb: -18 }, { peak: 0.003, levelDb: -18 }, { peak: 0.002, levelDb: -18 }],
    pop: [{ peak: 0.02, levelDb: -14 }],
    riser: [{ peak: 1.1, levelDb: -8 }],
    hit: [{ peak: 0.01, levelDb: -8 }],
    tick: [{ peak: 0.001, levelDb: -24 }],
  };
  const shot = (over: Partial<ShotSegment>): ShotSegment => ({
    kind: "shot",
    id: "s",
    flowId: "f",
    in: 0,
    out: 6,
    camera: [],
    cursor: "auto",
    transitionIn: "cut",
    ...over,
  });
  const event = (over: Partial<TimelineEvent> & Pick<TimelineEvent, "t" | "kind">): TimelineEvent => ({ flowId: "f", stepId: "s1", label: "x", ...over }) as TimelineEvent;
  async function cuesFor(segment: ShotSegment, events: TimelineEvent[], mix = {}) {
    const { edl: base, timeline } = await editAndTimeline();
    const edl = { ...base, segments: [segment] };
    const { parts, frames } = planParts(edl, []);
    return { cues: sfxCues(edl, parts, { ...timeline, events }, frames, mix), parts, edl };
  }

  it("ticks once per typed word, never for a secret", async () => {
    const typed = await cuesFor(shot({}), [event({ t: 1, kind: "type", value: "plan the launch" })]);
    expect(typed.cues.filter((c) => c.kind === "tick")).toHaveLength(3);
    const secret = await cuesFor(shot({}), [event({ t: 1, kind: "type", value: { redacted: true } })]);
    expect(secret.cues.filter((c) => c.kind === "tick")).toHaveLength(0);
  });

  it("lands a measured take's peak one frame after the picture", async () => {
    const { cues, parts, edl } = await cuesFor(shot({}), [event({ t: 2, kind: "click" })], { sounds: measured });
    const click = cues.find((c) => c.kind === "click")!;
    expect(click.frame).toBe(Math.round((parts[1]!.from / edl.fps + 2 - measured.click![0]!.peak) * edl.fps) + 1);
  });

  it("rotates takes, and keeps a kind's cues apart", async () => {
    const clicks = [1, 2, 3, 3.05].map((t) => event({ t, kind: "click" }));
    const { cues } = await cuesFor(shot({}), clicks, { sounds: measured });
    const played = cues.filter((c) => c.kind === "click");
    expect(played.map((c) => c.take)).toEqual([0, 1, 2]);
  });

  it("plays one riser, into the hit on the outro, with a pop as the title lands", async () => {
    const { cues, parts } = await cuesFor(shot({}), [], { sounds: measured });
    const outro = parts.at(-1)!;
    expect(cues.filter((c) => c.kind === "riser")).toHaveLength(1);
    const hit = cues.find((c) => c.kind === "hit")!;
    const riser = cues.find((c) => c.kind === "riser")!;
    expect(hit.frame).toBeGreaterThanOrEqual(outro.from);
    expect((hit.frame - riser.frame) / 30).toBeCloseTo(measured.riser![0]!.peak, 0);
    expect(cues.some((c) => c.kind === "pop")).toBe(true);
  });

  it("whooshes on big camera moves only", async () => {
    const small = shot({ camera: [{ t: 2, target: "full", zoom: 1.2, ease: "smooth" }] });
    const big = shot({ camera: [{ t: 2, target: [10, 10, 100, 40], zoom: 1.8, ease: "spring" }] });
    const count = async (s: ShotSegment) => (await cuesFor(s, [])).cues.filter((c) => c.kind === "whoosh").length;
    expect(await count(big)).toBe((await count(small)) + 1);
  });

  it("sets measured levels from the bed, lower under a voice, and never above unity", async () => {
    const free = (await cuesFor(shot({}), [event({ t: 2, kind: "click" })], { sounds: measured })).cues.find((c) => c.kind === "click")!;
    const voiced = (await cuesFor(shot({}), [event({ t: 2, kind: "click" })], { sounds: measured, voiced: true })).cues.find((c) => c.kind === "click")!;
    expect(free.gain).toBeCloseTo(10 ** ((BED_LUFS.trailer + 3 - -18) / 20), 3);
    expect(voiced.gain).toBeLessThan(free.gain);
    const quiet = { ...measured, click: [{ peak: 0, levelDb: -60 }] };
    expect((await cuesFor(shot({}), [event({ t: 2, kind: "click" })], { sounds: quiet })).cues.find((c) => c.kind === "click")!.gain).toBe(1);
  });

  it("keeps a shot's own cues whatever the limits", async () => {
    const own = shot({ sfx: [{ t: 1, kind: "hit" }, { t: 1.1, kind: "hit" }] });
    const { cues } = await cuesFor(own, []);
    expect(cues.filter((c) => c.kind === "hit").length).toBeGreaterThanOrEqual(2);
  });
});

describe("the music's volume", () => {
  const db = (v: number) => 20 * Math.log10(v);
  const music = { gainDb: -4, duckDb: DUCK_DB };
  const line = (from: number, seconds: number) => ({ from: from * 30, frames: seconds * 30 });
  const at = (points: { t: number; v: number }[], t: number) => points.find((p) => p.t === t)!.v;

  it("builds a trailer to its plateau, and never goes down without a voice", () => {
    const points = musicAutomation(music, "trailer", [], 30, 30);
    expect(db(at(points, 0))).toBeCloseTo(-14, 0);
    expect(db(points.at(-1)!.v)).toBeCloseTo(-4, 0);
    for (const [i, p] of points.entries()) if (i) expect(p.v).toBeGreaterThanOrEqual(points[i - 1]!.v);
    expect(new Set(points.filter((p) => p.t >= 18).map((p) => p.v)).size).toBe(1);
  });

  it("keeps a guide flat", () => {
    const points = musicAutomation({ gainDb: -16, duckDb: DUCK_DB }, "guide", [], 30, 30);
    expect(new Set(points.map((p) => p.v)).size).toBe(1);
  });

  it("ducks a line by no more than the duck, down before it starts and back up after it", () => {
    const points = musicAutomation(music, "trailer", [line(20, 3)], 30, 30);
    expect(db(at(points, 20))).toBeCloseTo(-10, 0);
    expect(db(at(points, 23))).toBeCloseTo(-10, 0);
    expect(db(at(points, 19.85))).toBeCloseTo(-4, 0);
    expect(db(at(points, 23.5))).toBeCloseTo(-4, 0);
  });

  it("doesn't bob between close lines", () => {
    const points = musicAutomation(music, "trailer", [line(20, 2), line(23, 2)], 30, 30);
    expect(points.some((p) => p.t === 22.5)).toBe(false);
    expect(db(at(points, 25))).toBeCloseTo(-10, 0);
    const apart = musicAutomation(music, "trailer", [line(20, 2), line(25, 2)], 30, 60);
    expect(db(at(apart, 22.5))).toBeGreaterThan(-13);
  });

  it("doesn't push a line near the start lower than the duck", () => {
    const points = musicAutomation(music, "trailer", [line(1, 2)], 30, 30);
    for (const p of points) if (p.t >= 1 && p.t <= 3) expect(db(p.v)).toBeGreaterThanOrEqual(-14.1);
  });

  it("stays inside the lane's limit, even with hundreds of lines", () => {
    const many = Array.from({ length: 600 }, (_, i) => line(i * 3, 1));
    expect(musicAutomation(music, "guide", many, 30, 1800).length).toBeLessThanOrEqual(512);
  });

  it("levels tracks of different loudness to the same bed, under −1 dBTP", () => {
    const track = { id: "t", file: "t.mp3", title: "t", source: "https://x.example", license: "CC0", mood: ["fun"], energy: 3, bpm: 120, firstBeat: 0, seconds: 100, analysis: { confidence: "high" as const, entries: [0], tailEnd: 100 } };
    expect(musicStyle({ ...track, lufs: -19.8, truePeak: -0.7 }, "trailer").gainDb).toBe(-4.2);
    expect(musicStyle({ ...track, lufs: -9.2, truePeak: 1.1 }, "trailer").gainDb).toBe(-14.8);
    expect(musicStyle({ ...track, lufs: -30, truePeak: -3 }, "trailer").gainDb).toBe(2);
  });
});

describe("the music's grid", () => {
  it("fits jittery beats to one tempo", () => {
    const beats = Array.from({ length: 80 }, (_, i) => 0.025 + i * 0.5 + (i % 3 === 0 ? 0.012 : i % 3 === 1 ? -0.012 : 0));
    beats[12] = beats[12]! - 0.11;
    const grid = regularGrid(beats, 119.7);
    expect(grid.bpm).toBeCloseTo(120, 1);
    expect(grid.firstBeat).toBeCloseTo(0.025, 1);
    expect(grid.fit).toBeGreaterThan(0.9);
  });

  it("sees when beats don't fit", () => {
    let t = 0;
    const beats = Array.from({ length: 40 }, (_, i) => (t += [0.75, 0.88, 0.62, 0.81, 0.97][i % 5]!));
    expect(regularGrid(beats, 80).fit).toBeLessThan(0.6);
  });

  it("enters at a section start only when the music holds up after it", () => {
    const bars = Array.from({ length: 40 }, (_, i) => i * 2);
    const quietThenFull = bars.map((_, i) => (i < 12 ? -24 : -16));
    expect(entriesOf(bars, quietThenFull, [8, 24.4, 60])[0]).toBe(24);
    expect(entriesOf(bars, quietThenFull, [8])[0]).toBe(24);
    expect(entriesOf(bars.slice(0, 3), [-20, -20, -20], [])).toEqual([0]);
  });
});

describe("the music's plan", () => {
  const track = {
    id: "t",
    file: "t.mp3",
    title: "t",
    source: "https://x.example",
    license: "CC0",
    mood: ["fun"],
    energy: 3,
    bpm: 120,
    firstBeat: 0.025,
    seconds: 188,
    lufs: -18,
    truePeak: -1,
    analysis: { confidence: "high" as const, entries: [24.025, 60.025], tailEnd: 183.7 },
  };

  it("enters at a strong bar and leaves through the track's ending, on bar lines", () => {
    const plan = planMusic(track, 20, 4);
    expect(plan.spans).toEqual([
      { at: 0, mediaStart: 24.025, seconds: 16 },
      { at: 16, mediaStart: 178.025, seconds: 4 },
    ]);
    expect((plan.spans[1]!.mediaStart - track.firstBeat) % plan.bar).toBeCloseTo(0, 3);
  });

  it("plays straight through a track too short to join", () => {
    const plan = planMusic({ ...track, seconds: 30, analysis: { ...track.analysis, entries: [2.025], tailEnd: 29 } }, 28, 4);
    expect(plan.spans).toHaveLength(1);
  });

  it("gives a led film's music its premix to play from the start", () => {
    expect(ledStyle(track).firstBeat).toBe(0);
    expect(beatsOf(track)).toEqual({ beat: 0.5, bar: 2 });
  });
});

describe("a music-led edit", () => {
  const view = { w: 1440, h: 900, dpr: 2 };
  const timeline = (events: Partial<TimelineEvent>[], duration = 20): Timeline => ({
    schemaVersion: 2,
    recordingId: "r",
    formFactor: "desktop",
    viewport: view,
    fps: 30,
    duration,
    flows: [{ flowId: "f", in: 0, out: duration }],
    events: events.map((e) => ({ flowId: "f", stepId: "s", kind: "settled", label: "x", url: "https://x.example", t: 1, ...e }) as TimelineEvent),
    dead: [],
  });
  const beat = (id: string, from: number, to: number, title?: string): Storyboard["beats"][number] => ({
    id,
    role: "core",
    flowId: "f",
    in: from,
    out: to,
    onScreen: title ? [{ kind: "title", text: title }] : [],
    motion: { kind: "reveal", emotion: "calm" },
    intent: "x",
    maxSeconds: 3,
  });
  const script = (beats: Storyboard["beats"]): Script => ({
    schemaVersion: 2,
    lang: "en",
    hook: "Plan and ship",
    titleCard: "Plan and ship",
    cta: "Try it",
    posting: { title: "t", description: "d", hashtags: [] },
    segments: beats.map((b) => ({ beatId: b.id, text: "", onScreen: b.onScreen.map((o) => o.text), maxSeconds: 3 })),
  });
  const led = (beats: Storyboard["beats"], t: Timeline, over = {}) =>
    ledEdl({
      timeline: t,
      storyboard: { schemaVersion: 1, arc: "launch", edit: "trailer", beats },
      scripts: { en: script(beats) },
      personality: "energetic",
      targetSeconds: 30,
      ...over,
    });
  const columns: Layout["groups"][number] = {
    kind: "columns",
    box: [100, 200, 1200, 600],
    items: [
      [100, 200, 280, 600],
      [400, 200, 280, 600],
      [700, 200, 280, 600],
      [1000, 200, 280, 600],
    ],
  };
  const moves = (edl: Edl) => edl.segments.map((s) => (s.kind === "primitive" ? s.primitive.type : s.kind));

  it("opens, plays a label then a proof per shot, and closes, each a whole number of beats", () => {
    const beats = [beat("a", 0, 5, "Plan it"), beat("b", 5, 10, "Ship it")];
    const edl = led(beats, timeline([{ t: 2, layout: { groups: [columns] } }, { t: 7, layout: { panel: [800, 20, 600, 860], groups: [] } }]));
    expect(edl.schemaVersion).toBe(7);
    expect(edl.style.timing).toBe("music");
    expect(edl.intro.component).toBe("Opener");
    expect(edl.outro.component).toBe("EndCard");
    expect(moves(edl)).toEqual(["label", "build", "label", "proof"]);
    for (const seconds of [edl.intro.seconds, edl.outro.seconds, ...edl.segments.map((s) => ("seconds" in s ? s.seconds : 0))])
      expect((seconds / 0.5) % 1).toBeCloseTo(0, 5);
    const { parts } = planParts(edl, []);
    // Nothing overlaps: every part starts as the last one ends, on the grid.
    parts.slice(1).forEach((p, i) => expect(p.from).toBe(parts[i]!.from + parts[i]!.frames));
    expect(parts.every((p) => p.enter.frames === 0)).toBe(true);
  });

  it("builds a page from its columns, lifting a piece from the middle", () => {
    const cards: Layout["groups"][number] = { kind: "rows", box: [400, 300, 280, 300], items: [[400, 300, 280, 96], [400, 410, 280, 96], [400, 520, 280, 96]] };
    const edl = led([beat("a", 0, 5)], timeline([{ t: 2, layout: { groups: [columns, cards] } }]));
    const p = (edl.segments[0] as PrimitiveSegment).primitive;
    expect(p).toMatchObject({ type: "build", at: 2, reveal: "rise", lift: [400, 410, 280, 96] });
    expect(p.type === "build" && p.items).toHaveLength(4);
  });

  it("takes a page's structure as an action found it", () => {
    const edl = led([beat("a", 0, 5)], timeline([{ t: 3, kind: "click", layout: { at: 2.5, groups: [columns] } }]));
    expect((edl.segments[0] as PrimitiveSegment).primitive).toMatchObject({ type: "build", at: 2.5 });
  });

  it("hops down a list only while the page is still", () => {
    const rows: Layout["groups"][number] = { kind: "rows", box: [800, 100, 500, 400], items: [0, 1, 2, 3, 4, 5].map((i) => [800, 100 + i * 60, 500, 52] as Rect) };
    const layout = { panel: [780, 20, 640, 860] as Rect, groups: [rows] };
    const still = led([beat("a", 0, 10)], timeline([{ t: 4, layout }]));
    expect((still.segments[0] as PrimitiveSegment).primitive).toMatchObject({ type: "proof", frame: [780, 20, 640, 860] });
    const hops = (still.segments[0] as PrimitiveSegment).primitive;
    expect(hops.type === "proof" && hops.hops).toHaveLength(3);
    const moved = led([beat("a", 0, 10)], timeline([{ t: 4, layout }, { t: 4.6, kind: "click" }]));
    const few = (moved.segments[0] as PrimitiveSegment).primitive;
    expect(few.type === "proof" && (few.hops ?? []).length).toBeLessThanOrEqual(1);
  });

  it("closes in on typing", () => {
    const edl = led([beat("a", 0, 6)], timeline([{ t: 1, kind: "type", value: "plan the launch", bbox: [300, 300, 500, 44] }, { t: 3, layout: { component: [200, 200, 800, 400], groups: [] } }]));
    expect((edl.segments[0] as PrimitiveSegment).primitive).toMatchObject({ type: "prompt", input: [300, 300, 500, 44], frame: [200, 200, 800, 400] });
  });

  it("never shows a secret being typed as a close-up", () => {
    const edl = led([beat("a", 0, 6)], timeline([{ t: 1, kind: "type", value: { redacted: true }, bbox: [300, 300, 500, 44] }]));
    expect(moves(edl)).not.toContain("prompt");
  });

  it("doesn't repeat a move when it has a choice", () => {
    const layout = { panel: [780, 20, 640, 860] as Rect, groups: [columns] };
    const edl = led([beat("a", 0, 5), beat("b", 5, 10)], timeline([{ t: 2, layout }, { t: 7, layout }]));
    expect(moves(edl)).toEqual(["build", "proof"]);
  });

  it("leaves out a shot with nothing on screen, and reads a drawn board from its pixels", () => {
    const empty = { t: 2, box: [0, 0, 100, 100] as Rect, fill: 0.02 };
    const beats = [beat("a", 0, 5), beat("b", 5, 10)];
    const t = timeline([{ t: 7, layout: { panel: [800, 20, 600, 860], groups: [] } }]);
    expect(moves(led(beats, t, { content: { a: empty } }))).toEqual(["proof"]);
    const board = { ...empty, board: { t: 2, columns: columns.items, cards: [[400, 300, 280, 96] as Rect] } };
    expect(moves(led(beats, t, { content: { a: board } }))).toEqual(["build", "proof"]);
  });

  it("still has a proof if every shot looks empty", () => {
    const empty = { t: 2, box: [0, 0, 100, 100] as Rect, fill: 0.02 };
    expect(moves(led([beat("a", 0, 5)], timeline([]), { content: { a: empty } }))).toEqual(["proof"]);
  });

  it("flips the frame around the middle of a longer film", () => {
    const beats = [beat("a", 0, 5, "One"), beat("b", 5, 10, "Two"), beat("c", 10, 15, "Three")];
    const edl = led(beats, timeline([{ t: 2, layout: { groups: [columns] } }]));
    const labels = edl.segments.flatMap((s) => (s.kind === "primitive" && s.primitive.type === "label" ? [s.primitive] : []));
    expect(labels.map((l) => l.ground)).toEqual(["base", "invert", "base"]);
    expect(labels[0]!.open).toBe("slit");
  });

  it("uses the track's beat, and fits the film to the target", () => {
    const beats = Array.from({ length: 9 }, (_, i) => beat(`b${i}`, i, i + 1, "Go"));
    const edl = led(beats, timeline([]), { grid: { beat: 0.75, bar: 3 }, targetSeconds: 20 });
    expect(filmSeconds(edl)).toBeLessThanOrEqual(24);
    for (const s of edl.segments) if (s.kind === "primitive") expect((s.seconds / 0.75) % 1).toBeCloseTo(0, 5);
  });

  it("sends a director's edit back onto the grid, and says how much moved", () => {
    const edl = led([beat("a", 0, 5, "Go")], timeline([]));
    const label = edl.segments[0] as PrimitiveSegment;
    const off = { ...edl, segments: [{ ...label, seconds: 1.3 }, ...edl.segments.slice(1)] };
    const { edl: snapped } = snapToGrid(off);
    expect((snapped.segments[0] as PrimitiveSegment).seconds).toBe(1.5);
    expect(snapToGrid({ ...edl, segments: [{ ...label, seconds: 3.1 }] }).moved).toBe(0);
    expect(snapToGrid({ ...edl, segments: [{ ...label, seconds: 0.1 }] }).edl.segments[0]).toMatchObject({ seconds: 0.5 });
  });
});

describe("the reference library", () => {
  const view = { w: 1440, h: 900, dpr: 2 };
  const timeline = (events: Partial<TimelineEvent>[], duration = 20): Timeline => ({
    schemaVersion: 2,
    recordingId: "r",
    formFactor: "desktop",
    viewport: view,
    fps: 30,
    duration,
    flows: [{ flowId: "f", in: 0, out: duration }],
    events: events.map((e) => ({ flowId: "f", stepId: "s", kind: "settled", label: "x", url: "https://x.example", t: 1, ...e }) as TimelineEvent),
    dead: [],
  });
  const beat = (id: string, from: number, to: number, title?: string): Storyboard["beats"][number] => ({
    id,
    role: "core",
    flowId: "f",
    in: from,
    out: to,
    onScreen: title ? [{ kind: "title", text: title }] : [],
    motion: { kind: "reveal", emotion: "calm" },
    intent: "x",
    maxSeconds: 3,
  });
  const storyboard = (beats: Storyboard["beats"]): Storyboard => ({ schemaVersion: 1, arc: "launch", edit: "trailer", beats });
  const script = (beats: Storyboard["beats"]): Script => ({
    schemaVersion: 2,
    lang: "en",
    hook: "Plan and ship",
    titleCard: "Plan and ship",
    cta: "Try it",
    posting: { title: "t", description: "d", hashtags: [] },
    segments: beats.map((b) => ({ beatId: b.id, text: "", onScreen: b.onScreen.map((o) => o.text), maxSeconds: 3 })),
  });
  const columns: Layout["groups"][number] = {
    kind: "columns",
    box: [100, 200, 1200, 600],
    items: [0, 1, 2, 3].map((i) => [100 + i * 300, 200, 280, 600] as Rect),
  };
  const rows: Layout["groups"][number] = { kind: "rows", box: [800, 100, 500, 400], items: [0, 1, 2, 3, 4, 5].map((i) => [800, 100 + i * 60, 500, 52] as Rect) };
  const plan = (skeletonId: string, beats: Storyboard["beats"], t: Timeline, over = {}) =>
    loadReferenceLibrary().then((library) =>
      ledPlan({
        timeline: t,
        storyboard: storyboard(beats),
        scripts: { en: script(beats) },
        personality: "energetic",
        targetSeconds: 30,
        skeleton: library!.skeletons.find((s) => s.id === skeletonId)!,
        ...over,
      }),
    );
  const moves = (edl: Edl) => edl.segments.map((s) => (s.kind === "primitive" ? s.primitive.type : s.kind));

  it("is valid, and its label-then-proof entry is the template's default", async () => {
    const library = await loadReferenceLibrary();
    expect(library!.skeletons.map((s) => s.id)).toEqual(["modules", "rapid", "glide", "type-led", "showcase", "canvas", "listen"]);
    expect(library!.skeletons.find((s) => s.id === "modules")).toEqual(DEFAULT_SKELETON);
  });

  it("picks a skeleton that suits the product, the same one for the same seed", async () => {
    const library = (await loadReferenceLibrary())!;
    for (const seed of ["linear.app", "ui.shadcn.com", "sarvam.ai", "a", "b"]) {
      const picked = chooseSkeleton(library, "board", seed);
      expect(picked.suits.length === 0 || picked.suits.includes("board")).toBe(true);
      expect(chooseSkeleton(library, "board", seed)).toBe(picked);
    }
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => chooseSkeleton(library, "page", seed).id));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("reads a product's shape from what was recorded", () => {
    const beats = [beat("a", 0, 5)];
    expect(productShape(storyboard(beats), timeline([{ t: 2, layout: { groups: [columns] } }]))).toBe("board");
    expect(productShape(storyboard(beats), timeline([{ t: 1, kind: "type", value: "write a note", bbox: [1, 1, 300, 40] }]))).toBe("prompt");
    expect(productShape(storyboard(beats), timeline([{ t: 2, layout: { groups: [rows] } }]))).toBe("list");
    expect(productShape(storyboard(beats), timeline([]))).toBe("page");
  });

  it("cuts a rapid film to two angles a shot, on short beats", async () => {
    const beats = [beat("a", 0, 10, "Plan it"), beat("b", 10, 20, "Ship it")];
    const t = timeline([{ t: 2, layout: { panel: [780, 20, 640, 860], groups: [columns, rows] } }, { t: 12, layout: { panel: [700, 20, 700, 860], groups: [rows] } }]);
    const { edl } = await plan("rapid", beats, t);
    expect(moves(edl)).toEqual(["label", "build", "proof", "label", "proof", "proof"]);
    const proofs = edl.segments.filter((s) => s.kind === "primitive" && s.primitive.type !== "label");
    expect(proofs.every((s) => (s as PrimitiveSegment).seconds === 1.5)).toBe(true);
  });

  it("glides the camera across a shot's regions on the beat, with no labels", async () => {
    const t = timeline([
      { t: 1, layout: { panel: [0, 0, 700, 900], groups: [] } },
      { t: 6, layout: { panel: [740, 0, 700, 900], groups: [] } },
    ]);
    const { edl } = await plan("glide", [beat("a", 0, 12, "Plan it")], t);
    expect(edl.schemaVersion).toBe(8);
    expect(moves(edl)).toEqual(["proof"]);
    const p = (edl.segments[0] as PrimitiveSegment).primitive;
    // The first panel settles a second in, so the window opens on the whole page, then moves to each panel.
    expect(p.type === "proof" && p.frame).toEqual([0, 0, 1440, 900]);
    expect(p.type === "proof" && p.path).toHaveLength(2);
    const stop = p.type === "proof" ? p.path!.at(-1)! : undefined;
    expect((stop!.at / 0.5) % 1).toBeCloseTo(0, 5);
    expect(stop!.frame[0]).toBeGreaterThan(300);
  });

  it("says which shots it left out, and why", async () => {
    const empty = { t: 2, box: [0, 0, 100, 100] as Rect, fill: 0.02 };
    const beats = [beat("a", 0, 5, "Empty one"), beat("b", 5, 10, "Full one")];
    const t = timeline([{ t: 7, layout: { panel: [800, 20, 600, 860], groups: [] } }]);
    const { dropped } = await plan("modules", beats, t, { content: { a: empty } });
    expect(dropped).toEqual([{ beatId: "a", title: "Empty one", reason: "too little on screen to show" }]);
  });

  it("frames the busiest part of a page that's full edge to edge, not the whole page", () => {
    const beats = [beat("a", 0, 5)];
    const full = { t: 2, box: [0, 60, 1440, 840] as Rect, fill: 0.5, focus: [720, 450, 720, 450] as Rect };
    const edl = ledEdl({ timeline: timeline([]), storyboard: storyboard(beats), scripts: { en: script(beats) }, personality: "energetic", targetSeconds: 30, content: { a: full } });
    const p = (edl.segments[0] as PrimitiveSegment).primitive;
    expect(p.type === "proof" && p.frame[2]).toBeLessThan(1440);
  });

  it("never frames a nav bar as the component", () => {
    const beats = [beat("a", 0, 5)];
    const edl = ledEdl({ timeline: timeline([{ t: 2, layout: { component: [0, 0, 1440, 64], groups: [] } }]), storyboard: storyboard(beats), scripts: { en: script(beats) }, personality: "energetic", targetSeconds: 30 });
    const p = (edl.segments[0] as PrimitiveSegment).primitive;
    expect(p.type === "proof" && p.frame).not.toEqual([0, 0, 1440, 900]);
  });

  it("lifts the top of the middle column when a board has nothing smaller", () => {
    const beats = [beat("a", 0, 5)];
    const edl = ledEdl({ timeline: timeline([{ t: 2, layout: { groups: [columns] } }]), storyboard: storyboard(beats), scripts: { en: script(beats) }, personality: "energetic", targetSeconds: 30 });
    const p = (edl.segments[0] as PrimitiveSegment).primitive;
    expect(p.type === "build" && p.lift).toEqual([700, 200, 280, 196]);
  });

  it("lays the film out bar by bar in its beat sheet, with what it shows and what it left out", async () => {
    const empty = { t: 2, box: [0, 0, 100, 100] as Rect, fill: 0.02 };
    const beats = [beat("a", 0, 5, "Empty one"), beat("b", 5, 10, "Full one")];
    const t = timeline([{ t: 7, layout: { panel: [800, 20, 600, 860], groups: [] } }]);
    const { edl, dropped, skeleton } = await plan("modules", beats, t, { content: { a: empty } });
    const sheet = beatSheetOf(edl, { skeletonId: skeleton.id, thesis: "Plan and ship", grid: { beat: 0.5, bar: 2 }, dropped });
    expect(sheet.beats.map((b) => [b.id, b.at, b.bars, b.move])).toEqual([
      ["intro", 0, [1, 2], "opener"],
      ["b-label", 4, [3, 3], "label (base, slit)"],
      ["b-proof", 5, [3, 4], "proof"],
      ["outro", 8, [5, 6], "end card"],
    ]);
    expect(sheet.beats[1]!.copy).toBe("Full one");
    expect(sheet.beats[2]!.source).toMatchObject({ flowId: "f", frame: [800, 20, 600, 860] });
    expect(describeBeatSheet(sheet).at(-1)).toBe("left out: Empty one (too little on screen to show)");
  });

  it("tries art direction's moves first, and keeps out the ones it avoids", async () => {
    const t = timeline([{ t: 2, layout: { panel: [780, 20, 640, 860], groups: [columns] } }]);
    const beats = [beat("a", 0, 10, "Plan it")];
    expect(moves((await plan("modules", beats, t)).edl)).toEqual(["label", "build"]);
    expect(moves((await plan("modules", beats, t, { prefer: ["proof"] })).edl)).toEqual(["label", "proof"]);
    expect(moves((await plan("modules", beats, t, { avoid: ["build"] })).edl)).toEqual(["label", "proof"]);
    const motion = { logo: "lockup" as const, cursor: "hand" as const, world: "bloom" as const };
    const { edl } = await plan("modules", beats, t, { motion });
    expect(edl).toMatchObject({ schemaVersion: 8, style: { brand: motion } });
  });

  it("places the brand moves art direction asks for, when the job has their material", async () => {
    const t = timeline([{ t: 1, kind: "type", value: "plan the launch", bbox: [300, 300, 500, 44] }, { t: 3, kind: "click", bbox: [800, 300, 80, 40] }, { t: 5, layout: { panel: [780, 20, 640, 860], groups: [] } }]);
    const beats = [beat("a", 0, 8, "Plan it")];
    const assets = {
      captures: Array.from({ length: 7 }, (_, i) => `brief/captures/0${i + 1}.jpg`),
      cloud: ["a", "b", "c", "d"].map((x) => `brief/logos/${x}.png`),
      outputs: [{ file: "record/output/f-01.wav", flowId: "f", t: 3.5, seconds: 2.4, peaks: Array(16).fill(0.5) }],
    };
    const { edl } = await plan("modules", beats, t, { prefer: ["wall", "pill", "output", "orbit"], assets });
    expect(moves(edl)).toEqual(["wall", "label", "pill", "output", "orbit"]);
    const pill = edl.segments.find((x) => x.kind === "primitive" && x.primitive.type === "pill") as PrimitiveSegment;
    expect(pill.primitive).toMatchObject({ text: "plan the launch", press: true });
    // Without them asked for, or without the material, none of them.
    expect(moves((await plan("modules", beats, t, { assets })).edl)).toEqual(["label", "prompt", "ticker"].slice(0, 2));
    expect(moves((await plan("modules", beats, t, { prefer: ["wall", "orbit"], assets: { captures: assets.captures.slice(0, 3), cloud: [] } })).edl)).not.toContain("wall");
  });

  it("dresses the moves in the recording's own words, the brand's objects and the director's shot calls", async () => {
    const t = timeline([
      { t: 0.5, kind: "select", stepId: "s1", value: "ta-IN", bbox: [600, 400, 230, 33] },
      { t: 1, kind: "type", stepId: "s2", value: "வணக்கம்! நான் உங்கள் உதவியாளர்.", bbox: [170, 340, 400, 180] },
      { t: 3, kind: "click", stepId: "s3", bbox: [600, 620, 230, 33] },
    ]);
    const beats = [beat("a", 0, 8, "Speak it")];
    const steps = { "f/s1": { action: "select", text: "Tamil", value: "ta-IN" }, "f/s3": { action: "click", text: "Generate with Bulbul V4" } };
    const assets = {
      outputs: [{ file: "record/output/f-01.mp3", flowId: "f", t: 3.5, seconds: 2.4, peaks: Array(16).fill(0.5) }],
      imagery: [{ file: "brief/imagery/a.png", colour: "#b23573", round: true }, { file: "brief/imagery/b.png", colour: "#98c854", round: true }],
      colours: ["#9a365c", "#9ac854", "#f48a77"],
    };
    const { edl } = await plan("modules", beats, t, { prefer: ["pill", "output"], assets, steps });
    const pill = edl.segments.find((x) => x.kind === "primitive" && x.primitive.type === "pill") as PrimitiveSegment;
    expect(pill.primitive).toMatchObject({ button: "Generate with Bulbul V4", chips: ["தமிழ் · Tamil"], press: true });
    const out = edl.segments.find((x) => x.kind === "primitive" && x.primitive.type === "output") as PrimitiveSegment;
    expect(out.primitive).toMatchObject({ title: "தமிழ் · Tamil", disc: "brief/imagery/a.png" });
    expect(edl.style.palette.colours).toEqual(assets.colours);
    expect(edl.style.imagery).toHaveLength(2);
    // The director's call: just where things were done, with a headline from the site.
    const called = await plan("modules", beats, t, { shots: { a: { crop: "acted", headline: "Hear it in Tamil" } } });
    const proof = called.edl.segments.find((x) => x.kind === "primitive" && x.primitive.type === "proof") as PrimitiveSegment;
    expect(proof.primitive).toMatchObject({ headline: "Hear it in Tamil" });
    const frame = (proof.primitive.type === "proof" ? proof.primitive.frame : [0, 0, 0, 0]) as [number, number, number, number];
    expect(frame[0]).toBeLessThanOrEqual(170);
    expect(frame[0] + frame[2]).toBeGreaterThanOrEqual(830);
    expect(frame[2]).toBeLessThan(1440);
  });

  it("gives each structure its own kind of music, and jobs different tracks within it", () => {
    const track = (id: string, energy: number, mood: string[]) => ({ id, file: `${id}.mp3`, title: id, source: "x", license: "CC0", mood, energy, bpm: 120, firstBeat: 0, seconds: 180, lufs: -14, truePeak: -1, analysis: { confidence: "medium" as const, entries: [0], tailEnd: 170 } });
    const library = { schemaVersion: 1 as const, tracks: [track("hype", 5, ["energetic", "driving", "electronic"]), track("calm", 2, ["calm", "minimal", "ambient"]), track("warm", 2, ["warm", "calm", "inspiring"]), track("still", 2, ["calm", "minimal", "elegant"])] };
    const pick = (want: { energy: [number, number]; moods: string[] } | undefined, seed = "job") =>
      pickTrack(library as never, { personality: "energetic", edit: "trailer", seconds: 25, seed, led: true, ...(want ? { want } : {}) })!.id;
    expect(pick(undefined)).toBe("hype");
    // A one-take wants calm music even for an energetic brand; different jobs land on different calm tracks.
    const calm = { energy: [2, 3] as [number, number], moods: ["calm", "minimal", "ambient", "elegant"] };
    expect(pick(calm)).not.toBe("hype");
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => pick(calm, seed))).size).toBeGreaterThan(1);
  });

  it("keeps a skeleton for its product types, and builds the films the new structures describe", async () => {
    const library = (await loadReferenceLibrary())!;
    for (const seed of ["a", "b", "c", "d", "e", "f"]) expect(chooseSkeleton(library, "prompt", seed).id).not.toBe("listen");
    const listen = library.skeletons.find((s) => s.id === "listen")!;
    const t = timeline([
      { t: 1, kind: "type", stepId: "s2", value: "hello there friend", bbox: [300, 300, 500, 44] },
      { t: 3, kind: "click", stepId: "s3", bbox: [800, 300, 80, 40] },
      { t: 5, layout: { panel: [780, 20, 640, 860], groups: [] } },
    ]);
    const outputs = [{ file: "record/output/f-01.mp3", flowId: "f", t: 3.5, seconds: 2.4, peaks: Array(16).fill(0.5) }];
    const film = ledPlan({ timeline: t, storyboard: storyboard([beat("a", 0, 8, "Hear it")]), scripts: { en: script([beat("a", 0, 8, "Hear it")]) }, personality: "premium", targetSeconds: 30, skeleton: listen, prefer: ["pill", "output"], assets: { outputs } });
    // The film's line gets its own beat, then the product speaks.
    expect(moves(film.edl)).toEqual(["label", "pill", "label", "output"]);
    const showcase = library.skeletons.find((s) => s.id === "showcase")!;
    const quiet = timeline([{ t: 2, layout: { panel: [780, 20, 640, 860], groups: [] } }]);
    const shown = ledPlan({ timeline: quiet, storyboard: storyboard([beat("a", 0, 8, "Plan it")]), scripts: { en: script([beat("a", 0, 8, "Plan it")]) }, personality: "premium", targetSeconds: 30, skeleton: showcase });
    // No cards between: the title rides the window.
    expect(moves(shown.edl)).not.toContain("label");
    const proof = shown.edl.segments.find((x) => x.kind === "primitive" && x.primitive.type === "proof") as PrimitiveSegment;
    expect(proof.primitive).toMatchObject({ headline: { en: "Plan it" } });
  });

  it("names a recorded choice as a chip", () => {
    expect(chipFor({ action: "select", value: "ta-IN" })).toBe("தமிழ் · Tamil");
    expect(chipFor({ action: "select", value: "en" })).toBe("English");
    expect(chipFor({ action: "select", text: "Shubh · Conversational", value: "shubh_enhi_companion" })).toBe("Shubh · Conversational");
    expect(chipFor({ action: "select", value: "x1" })).toBeUndefined();
  });

  it("cuts out each settled piece once, at its latest settle", () => {
    const t = timeline([
      { t: 2, layout: { panel: [780, 20, 640, 860], groups: [rows] } },
      { t: 5, layout: { panel: [781, 21, 640, 860], groups: [columns] } },
      { t: 6, kind: "click", layout: { panel: [10, 10, 100, 100], groups: [] } },
    ]);
    const layers = planLayers(t);
    expect(layers.filter((l) => l.kind === "panel")).toEqual([{ id: "panel-1", kind: "panel", flowId: "f", t: 5, box: [781, 21, 640, 860] }]);
    expect(layers.filter((l) => l.kind === "row")).toHaveLength(6);
    expect(layers.filter((l) => l.kind === "column")).toHaveLength(4);
    const inv = inventoryOf({ timeline: t, layers: { schemaVersion: 1, layers: layers.map((l) => ({ ...l, file: "x.png", density: 2 })) }, theme: "dark", colourful: false, hero: false, density: 2 });
    expect(inv).toMatchObject({ board: true, list: true, panel: true, typing: false, logo: "none", layers: { panel: 1, row: 6, column: 4 } });
  });

  it("puts the hand only on recorded clicks the move shows, in its own time", () => {
    const clicks = [
      { t: 2.0, box: [400, 300, 100, 40] as [number, number, number, number] },
      { t: 2.3, box: [420, 320, 100, 40] as [number, number, number, number] },
      { t: 4.0, box: [1300, 800, 50, 30] as [number, number, number, number] },
      { t: 9.0, box: [400, 300, 100, 40] as [number, number, number, number] },
    ];
    const presses = pressesIn({ clicks, from: 1, to: 5, speed: 1, dur: 3, frame: [300, 200, 600, 400], scale: 2 });
    // The second is too close after the first; the third is outside the region; the last is after the move.
    expect(presses).toEqual([{ x: 300, y: 240, at: 1 }]);
  });

  it("finds the busiest half of a page", () => {
    const gray = new Uint8Array(144 * 90).fill(10);
    for (let y = 50; y < 90; y++) for (let x = 80; x < 144; x++) gray[y * 144 + x] = 200;
    for (let y = 10; y < 20; y++) for (let x = 0; x < 30; x++) gray[y * 144 + x] = 200;
    const [x, y, w, h] = busiestRegion(gray, 144, 90);
    expect(x).toBeGreaterThan(0.4);
    expect(y).toBeGreaterThan(0.4);
    expect([w, h]).toEqual([0.5, 0.5]);
  });

  it("spreads a few pieces over the build instead of landing them at once", () => {
    expect(buildStep(2, 0.5, 4)).toBe(0.5);
    expect(buildStep(4, 0.5, 4)).toBe(0.5);
    expect(buildStep(12, 0.5, 3)).toBeCloseTo(1 / 12, 5);
    expect(liftAt(4, 4, 0.5)).toBe(2.5);
  });
});

describe("the moves' sounds", () => {
  const t = { events: [] } as unknown as Timeline;
  it("land when the moves do", () => {
    const items = [[0, 0, 10, 10], [20, 0, 10, 10], [40, 0, 10, 10], [60, 0, 10, 10]] as Rect[];
    const build = primitiveCues({ type: "build", flowId: "f", at: 1, items, reveal: "rise", lift: items[1]! }, 3, 0.5, t, "en");
    expect(build.map((c) => [c.kind, c.at])).toEqual([["pop", 0], ["pop", 0.25], ["pop", 0.5], ["pop", 0.75], ["pop", 1.55]]);
    const hop = primitiveCues({ type: "proof", flowId: "f", in: 0, out: 3, frame: [0, 0, 10, 10], tilt: "soft", hops: items.slice(0, 2) }, 3, 0.5, t, "en");
    expect(hop.filter((c) => c.kind === "click").map((c) => c.at)).toEqual([2, 2.5]);
    expect(primitiveCues({ type: "label", text: { en: "x" }, ground: "invert", open: "iris" }, 1, 0.5, t, "en")[0]!.kind).toBe("hit");
  });

  it("put a riser into the hit on the end card, once", () => {
    const cues = cardCues({ component: "EndCard", props: { line: { en: "Go" } }, seconds: 4 }, 4, 0.5, "en")!;
    expect(cues.map((c) => c.kind)).toEqual(["riser", "hit"]);
    expect(cardCues({ component: "TitleCard", props: {}, seconds: 4 }, 4, 0.5, "en")).toBeUndefined();
    const opener = cardCues({ component: "Opener", props: { line: { en: "Plan and navigate from idea to launch" } }, seconds: 4 }, 4, 0.5, "en")!;
    expect(opener.at(-1)).toMatchObject({ kind: "whoosh", at: 3.55 });
  });

  it("split a line into phrases and share time out on whole beats", () => {
    expect(phrasesOf("Plan and navigate from idea to launch")).toEqual(["Plan and navigate", "from idea to", "launch"]);
    expect(openerSlot(2, 4, 0.5)).toBe(1.5);
    expect(openerSlot(8, 4, 0.5)).toBe(0.5);
  });
});

describe("reading a page's pixels", () => {
  const frame = (w: number, h: number, paint: (x: number, y: number) => number) => Uint8Array.from({ length: w * h }, (_, i) => paint(i % w, Math.floor(i / w)));

  it("finds the region with content, and how much there is", () => {
    const { box, fill } = contentBox(frame(144, 90, (x, y) => (x >= 72 && y >= 45 ? 200 : 10)), 144, 90);
    expect(box[0]).toBeCloseTo(0.5, 1);
    expect(box[1]).toBeCloseTo(0.5, 1);
    expect(fill).toBeGreaterThan(0.2);
  });

  it("finds a board's columns from evenly spaced gutters, even if the outer ones fade", () => {
    const paint = (x: number, y: number) => {
      if (y < 100 || y > 380) return 10;
      if ((x > 200 && x < 206) || (x > 356 && x < 362) || (x > 512 && x < 518)) return 10;
      if (x < 142 || x > 577) return 10; // the outer columns fade out
      return (y - 100) % 90 < 80 ? 22 : 10; // cards with gaps between
    };
    const found = pixelColumns(frame(720, 450, paint), 720, 450);
    expect(found?.columns).toHaveLength(4);
    expect(found!.columns[1]![0]).toBeCloseTo(206 / 720, 2);
    expect(found!.columns[1]![2]).toBeCloseTo(150 / 720, 1);
    expect(found!.cards.length).toBeGreaterThanOrEqual(4);
  });

  it("doesn't see a board in ordinary pages", () => {
    expect(pixelColumns(frame(720, 450, (x, y) => (y > 100 && y < 300 && x > 100 && x < 600 ? 150 : 10)), 720, 450)).toBeUndefined();
    expect(pixelColumns(frame(720, 450, () => 10), 720, 450)).toBeUndefined();
  });
});

describe("the master", () => {
  it("is one gain to the target, none for silence", () => {
    expect(masteringGainDb(-20.5)).toBe(6.5);
    expect(masteringGainDb(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(masteringGainDb(Number.NaN)).toBe(0);
  });
});

describe("a sound's shape", () => {
  it("finds the peak and the level", () => {
    const rate = 48000;
    const samples = new Float32Array(rate);
    for (let i = rate / 2; i < rate / 2 + 480; i++) samples[i] = 0.5;
    const shape = shapeOf(samples, rate);
    expect(shape.seconds).toBe(1);
    expect(shape.peak).toBeCloseTo(0.505, 2);
    // 10 ms of sound over the 400 ms window.
    expect(shape.levelDb).toBeCloseTo(20 * Math.log10(0.5 * Math.sqrt(480 / 19200)), 1);
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
