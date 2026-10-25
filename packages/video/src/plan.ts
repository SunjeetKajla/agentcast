import type { Aspect, Edl, Storyboard, Timeline, TimelineEvent, Voiceover, Word } from "@agentcast/shared";
import type { SfxKind } from "./audio.ts";
import { moveSeconds } from "./motion.ts";
import { clockOf } from "./retime.ts";

// The edit laid out on the output timeline: which part plays when, and where each voice line sits.
// Pure, so the composition, the worker and the tests all agree on every frame.

/** One voice clip and the part it plays over: a segment's id, "intro" or "outro". */
export type Narration = { part: string; src: string; seconds: number; words: Word[] };

/** A caption line in output seconds; `words` (output seconds too) when the voice gave word timings. */
export type Caption = { text: string; start: number; end: number; words?: Word[] };

/** Everything one render needs. Paths are relative to the job folder until render.ts serves them. */
export type VideoInput = {
  edl: Edl;
  aspect: Aspect;
  lang: string;
  /** The job's recording (every flow, one after another) and its timeline. */
  footage: { src: string; timeline: Timeline };
  /** This language's voice lines in playing order; empty for a silent video. */
  narration: Narration[];
  captions: Caption[];
  brand: {
    name: string;
    tagline?: string;
    /** Shown without the scheme. */
    site: string;
    logo?: { src: string; width: number; height: number; plate: boolean };
    /** The landing page's first screen (brand kit): the split title and the hero backdrop. */
    hero?: string;
  };
  /** The script's words for the cards. */
  copy: { title?: string; cta?: string };
  /** 540 for the preview, 1080 for finals; the width follows the aspect. */
  height: number;
  /** The generated sound effects, when the edit has any, and the music bed (style.music's track). */
  audio?: { sfx: Partial<Record<SfxKind, string>>; music?: string };
};

export const outputSize = (aspect: Aspect, height: number) => {
  const long = Math.round((height * 16) / 9 / 2) * 2;
  return aspect === "16x9" ? { w: long, h: height } : { w: height, h: long };
};

/** Air around the voice (PRD §9.6: the voice leads, the picture follows). */
export const VOICE_SPACING = { lead: 0.3, gap: 0.25, tail: 0.4 };

/**
 * The part each beat's line plays over. A beat with its own segment plays over it; a beat before the
 * first segment over the title card; after the last, over the outro; between two, over the segment
 * before it (which holds its last frame if the line needs the time).
 */
export function beatParts(storyboard: Storyboard, edl: Pick<Edl, "segments">): Map<string, string> {
  const own = new Map(edl.segments.map((s) => [("beatId" in s && s.beatId) || s.id, s.id]));
  const out = new Map<string, string>();
  let last: string | undefined;
  const firstOwned = storyboard.beats.findIndex((b) => own.has(b.id));
  storyboard.beats.forEach((beat, i) => {
    const part = own.get(beat.id);
    if (part) last = part;
    out.set(
      beat.id,
      part ??
        (firstOwned < 0 || i < firstOwned || beat.role === "hook"
          ? "intro"
          : beat.role === "cta"
            ? "outro"
            : (last ?? "intro")),
    );
  });
  // Anything after the last segment closes the video.
  const lastOwned = storyboard.beats.findLastIndex((b) => own.has(b.id));
  storyboard.beats.forEach((beat, i) => {
    if (lastOwned >= 0 && i > lastOwned) out.set(beat.id, "outro");
  });
  return out;
}

/** This language's clips, each on its beat's part, in storyboard order. */
export function assignNarration(storyboard: Storyboard, voice: Voiceover, edl: Pick<Edl, "segments">): Narration[] {
  const clips = new Map(voice.clips.map((c) => [c.beatId, c]));
  const parts = beatParts(storyboard, edl);
  return storyboard.beats.flatMap((beat) => {
    const clip = clips.get(beat.id);
    return clip ? [{ part: parts.get(beat.id)!, src: clip.file, seconds: clip.seconds, words: clip.words }] : [];
  });
}

export type Transition = { kind: Edl["segments"][number]["transitionIn"]; frames: number };

/**
 * One part of the output, in frames from the start of the video. A part's `enter` overlaps the end of
 * the part before it (whose `exit` is the same transition), so both are on screen while it plays. A
 * shot's `hold` is how many frames it freezes on its last frame while its narration finishes.
 */
export type Part = ({ kind: "intro" | "outro" } | { kind: "segment"; index: number; hold: number }) & {
  id: string;
  from: number;
  frames: number;
  enter: Transition;
  exit: Transition;
};

/** A voice clip on the output timeline. Its words are in output seconds. */
export type PlacedClip = { src: string; from: number; frames: number; words: Word[] };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The output timeline: the title card, each segment and the outro, each overlapping the one before by
 * its transition (at most a third of either part; cuts don't overlap). A part lasts as long as its
 * footage or scene, or as long as its narration needs if that's longer. Lines on a part start once
 * its transition has played, so two parts' lines never overlap.
 */
export function planParts(edl: Edl, narration: Narration[] = []) {
  const fps = edl.fps;
  const transition = Math.round(moveSeconds(edl.style.motion) * fps);
  const items = [
    {
      id: "intro",
      kind: "intro" as const,
      base: Math.round(edl.intro.seconds * fps),
      enter: "cut" as const,
      shot: false,
    },
    ...edl.segments.map((s, index) => ({
      id: s.id,
      kind: "segment" as const,
      index,
      shot: s.kind === "shot",
      // A shot lasts its footage through its speed ramps.
      base: Math.max(1, Math.round((s.kind === "shot" ? clockOf(s).seconds : s.seconds) * fps)),
      enter: s.transitionIn,
    })),
    {
      id: "outro",
      kind: "outro" as const,
      base: Math.round(edl.outro.seconds * fps),
      enter: "fade" as const,
      shot: false,
    },
  ];
  const parts: Part[] = [];
  const clips: PlacedClip[] = [];
  const { lead, gap, tail } = VOICE_SPACING;
  let end = 0;
  for (const item of items) {
    const prev = parts.at(-1);
    const overlap =
      prev && item.enter !== "cut"
        ? Math.max(0, Math.min(transition, Math.floor(prev.frames / 3), Math.floor(item.base / 3)))
        : 0;
    const enter: Transition = { kind: item.enter, frames: overlap };
    if (prev) prev.exit = enter;
    const lines = narration.filter((n) => n.part === item.id);
    const first = Math.max(lead, overlap / fps + 0.1);
    const spoken = lines.reduce((sum, n) => sum + n.seconds, 0) + gap * Math.max(0, lines.length - 1);
    const need = lines.length ? Math.ceil((first + spoken + tail) * fps) : 0;
    const frames = Math.max(item.base, need);
    const from = end - overlap;
    const common = { id: item.id, from, frames, enter, exit: { kind: "cut", frames: 0 } as Transition };
    parts.push(
      item.kind === "segment"
        ? { ...common, kind: "segment", index: item.index, hold: item.shot ? frames - item.base : 0 }
        : { ...common, kind: item.kind },
    );
    let at = from / fps + first;
    for (const line of lines) {
      const start = Math.round(at * fps) / fps;
      clips.push({
        src: line.src,
        from: Math.round(start * fps),
        frames: Math.ceil(line.seconds * fps),
        words: line.words.map((w) => ({ text: w.text, start: round3(start + w.start), end: round3(start + w.end) })),
      });
      at += line.seconds + gap;
    }
    end = from + frames;
  }
  return { parts, clips, frames: end };
}

export type CursorState = {
  x: number;
  y: number;
  visible: boolean;
  /** Seconds since a click, while it ripples. */ clicked?: number;
};

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/**
 * The pointer at source second `t` (the screencast has no OS cursor, so the edit draws one): it
 * follows the recorded moves, rests where it stopped, ripples after a click and hides after 2.5 s
 * without activity.
 */
export function cursorAt(events: TimelineEvent[], t: number, ripple = 0.45): CursorState {
  let pos: [number, number] | undefined;
  let active = -Infinity;
  let click = -Infinity;
  for (const e of events) {
    const moveStart = e.cursor?.t0 ?? e.t;
    if (moveStart > t) break;
    if (e.cursor) {
      const { from, to, t0, t1 } = e.cursor;
      const k = easeInOut(t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 1);
      pos = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
      active = Math.min(t, t1);
    }
    if (e.t > t) continue;
    if (e.kind === "click") {
      click = e.t;
      active = e.t;
      if (!pos && e.bbox) pos = [e.bbox[0] + e.bbox[2] / 2, e.bbox[1] + e.bbox[3] / 2];
    }
    if (e.kind === "type" || e.kind === "press") active = e.t;
  }
  if (!pos) return { x: 0, y: 0, visible: false };
  const since = t - click;
  return {
    x: pos[0],
    y: pos[1],
    visible: t - active < 2.5,
    ...(since >= 0 && since < ripple ? { clicked: since } : {}),
  };
}
