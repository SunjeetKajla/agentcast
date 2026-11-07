import type { Edl, Timeline } from "@agentcast/shared";
import { moveSeconds } from "./motion.ts";
import { cardCues, primitiveCues } from "./primitives/cues.ts";
import type { Part } from "./plan.ts";
import { clockOf } from "./retime.ts";

// The mix: where the sound effects play and how the music moves (PRD §9.7.2). Pure.

export type SfxKind = "whoosh" | "click" | "pop" | "riser" | "hit" | "tick";

/** What a designed move asks to sound: the kind, seconds into the part, how important, and a level factor. */
export type MoveCue = { kind: SfxKind; at: number; priority: number; factor?: number };

/** A take's shape: seconds from its start to its peak, and its loudest 400 ms in dB. */
export type Sound = { peak: number; levelDb: number };
export type Sounds = Partial<Record<SfxKind, Sound[]>>;

/** An effect on the output timeline: its first frame, its level (1 = as made) and which take plays. */
export type SfxCue = { kind: SfxKind; frame: number; gain: number; take: number };

/** Where the music sits before the voice ducks it, in LUFS. Voice clips measure about −20. */
export const BED_LUFS: Record<Edl["style"]["edit"], number> = { trailer: -24, guide: -36 };

/** How far the voice ducks the music. More than this and the music pumps between lines. */
export const DUCK_DB = -6;

/** How far through a move a whoosh peaks: with the move's fastest stretch, its sound starting as it does. */
const WHOOSH_AT = 0.35;

/** Seconds from an effect's start to its peak, when the file hasn't been measured. */
const PEAK: Record<SfxKind, number> = { whoosh: 0.12, click: 0, pop: 0.02, riser: 1.1, hit: 0.01, tick: 0 };

/** Levels when the file hasn't been measured (1 = as made). */
const LEVEL: Record<SfxKind, number> = { whoosh: 0.4, click: 0.25, pop: 0.35, riser: 0.35, hit: 0.55, tick: 0.12 };

/** dB over the bed for a measured take: hits stand 3–6 dB over it, ticks and air sit under. */
const OVER_BED: Record<SfxKind, number> = { whoosh: 1, click: 3, pop: 3, riser: 3, hit: 6, tick: -4 };

/** Effects sit this far lower under a voice. */
const UNDER_VOICE_DB = -3;

/** The closest two of a kind may land, in seconds. */
const MIN_GAP: Record<SfxKind, number> = { whoosh: 0.9, click: 0.12, pop: 0.08, riser: 3, hit: 1.5, tick: 0.1 };

/** Most effects a second, so a busy film doesn't turn to noise. */
const MAX_PER_SECOND = 1.2;

/** Which effects survive when there are too many, most important first. */
export const PRIORITY = { asked: 0, payoff: 1, transition: 2, click: 3, landing: 4, camera: 5, tick: 6 };

/** Characters a second the recorder types (the baseline's typing estimate). */
const TYPING_CPS = 14;

/** A camera move at least this big in zoom gets a whoosh. */
const BIG_MOVE = 0.3;

/** When the title card's name has landed. */
const TITLE_LANDS = 1.2;

type Candidate = { kind: SfxKind; at: number; priority: number; factor: number };

/**
 * The edit's sound effects. A peak lands one frame after its picture (light arrives first). With
 * `style.sfx: "auto"`, every effect has a cause on screen: a pop as the title lands; a whoosh through
 * each transition and big camera move; a click on each recorded click; a tick per typed word; a pop
 * as a headline, stat, callout, lower third or montage clip lands; and one riser into a hit as the
 * outro's call to action lands. A shot's own `sfx` cues always play.
 *
 * `sounds` (measured takes) sets levels relative to the bed and rotates takes by cue.
 */
export function sfxCues(
  edl: Edl,
  parts: Part[],
  timeline: Timeline,
  frames: number,
  mix: { sounds?: Sounds; voiced?: boolean; lang?: string } = {},
): SfxCue[] {
  const fps = edl.fps;
  const auto = edl.style.sfx === "auto";
  const candidates: Candidate[] = [];
  const add = (kind: SfxKind, at: number, priority: number, factor = 1) => candidates.push({ kind, at, priority, factor });

  const beat = 60 / (edl.style.music.bpm ?? 120);
  for (const part of parts) {
    const start = part.from / fps;
    const end = (part.from + part.frames) / fps;
    if (auto && part.kind !== "segment" && (edl.intro.component === "Opener" || edl.outro.component === "EndCard")) {
      const card = part.kind === "intro" ? edl.intro : edl.outro;
      const own = cardCues(card, part.frames / fps, beat, mix.lang ?? "en");
      if (own) {
        for (const cue of own) add(cue.kind, start + cue.at, cue.priority, cue.factor);
        continue;
      }
    }
    if (part.kind === "segment" && edl.segments[part.index]!.kind === "primitive") {
      const segment = edl.segments[part.index] as Extract<Edl["segments"][number], { kind: "primitive" }>;
      if (auto) for (const cue of primitiveCues(segment.primitive, part.frames / fps, beat, timeline, mix.lang ?? "en")) add(cue.kind, start + cue.at, cue.priority, cue.factor);
      continue;
    }
    const landed = (part.from + part.enter.frames) / fps;
    if (auto && part.enter.frames > 0 && part.kind !== "outro") add("whoosh", start + (part.enter.frames / fps) * WHOOSH_AT, PRIORITY.transition);
    if (part.kind !== "segment") {
      if (auto && part.kind === "intro") add("pop", TITLE_LANDS, PRIORITY.landing);
      if (auto && part.kind === "outro") {
        add("riser", landed + 0.3, PRIORITY.payoff);
        add("hit", landed + 0.3, PRIORITY.payoff);
      }
      continue;
    }
    const segment = edl.segments[part.index]!;
    if (segment.kind === "statement" || segment.kind === "stat") {
      if (auto) add("pop", landed + 0.15, PRIORITY.landing);
      continue;
    }
    if (segment.kind === "montage") {
      // The clips arrive one after another (montageScene) and read as landed about 0.3 s in.
      if (auto) segment.clips.slice(0, 4).forEach((_, i) => add("pop", start + 0.35 + i * 0.12, PRIORITY.landing, 0.8));
      continue;
    }
    if (segment.kind !== "shot") continue;
    const clock = clockOf(segment);
    const into = (t: number) => start + clock.toOutput(t);
    const inPart = (t: number) => t >= start && t <= end;
    if (auto) {
      for (const e of timeline.events) {
        if (e.flowId !== segment.flowId || e.t < segment.in || e.t > segment.out) continue;
        if (e.kind === "click") add("click", into(e.t), PRIORITY.click);
        if (e.kind === "type" && typeof e.value === "string") {
          let typed = 0;
          for (const word of e.value.split(/(?<=\s)/)) {
            typed += word.length;
            const t = e.t + typed / TYPING_CPS;
            if (word.trim() && t <= segment.out) add("tick", into(t), PRIORITY.tick);
          }
        }
      }
      for (const callout of segment.callouts ?? []) add("pop", into(callout.t) + 0.18, PRIORITY.landing);
      for (const third of segment.lowerThirds ?? []) add("pop", into(third.t) + 0.2, PRIORITY.landing, 0.8);
      const move = moveSeconds(edl.style.motion);
      let zoom = 1;
      for (const key of segment.camera) {
        if (key.ease !== "cut" && Math.abs(key.zoom - zoom) >= BIG_MOVE) add("whoosh", into(key.t + move * WHOOSH_AT), PRIORITY.camera, 0.6);
        zoom = key.zoom;
      }
    }
    for (const cue of segment.sfx ?? []) if (inPart(into(cue.t))) add(cue.kind, into(cue.t), PRIORITY.asked, cue.gain ?? 1);
  }

  const budget = Math.max(8, Math.ceil((frames / fps) * MAX_PER_SECOND));
  const kept: Candidate[] = [];
  for (const c of [...candidates].sort((a, b) => a.priority - b.priority || a.at - b.at)) {
    if (c.priority !== PRIORITY.asked) {
      if (kept.length >= budget) continue;
      if (kept.some((k) => k.kind === c.kind && Math.abs(k.at - c.at) < MIN_GAP[c.kind])) continue;
    }
    kept.push(c);
  }

  const played = new Map<SfxKind, number>();
  const cues: SfxCue[] = [];
  for (const c of kept.sort((a, b) => a.at - b.at)) {
    const takes = mix.sounds?.[c.kind];
    const count = played.get(c.kind) ?? 0;
    const take = takes?.length ? count % takes.length : 0;
    const sound = takes?.[take];
    const frame = Math.round((c.at - (sound?.peak ?? PEAK[c.kind])) * fps) + 1;
    if (frame < 0 || frame >= frames) continue;
    played.set(c.kind, count + 1);
    const over = OVER_BED[c.kind] + (mix.voiced ? UNDER_VOICE_DB : 0);
    const level = sound ? Math.min(1, 10 ** ((BED_LUFS[edl.style.edit] + over - sound.levelDb) / 20)) : LEVEL[c.kind];
    cues.push({ kind: c.kind, frame, gain: level * c.factor, take });
  }
  return cues;
}

/** Seconds a duck takes to come down before a line, and to come back up after it. */
const DUCK_ATTACK = 0.15;
const DUCK_RELEASE = 0.5;
/** Lines closer than this stay ducked between them, so the music doesn't bob. */
const DUCK_HOLD = 1.5;
/** A trailer's music starts this far under its full level, and reaches it this far through the film. */
const ARC_START_DB = -10;
const ARC_PLATEAU = 0.6;
/** The most automation points a lane takes. */
const MAX_POINTS = 512;

const smoothstep = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The music's volume over the film. A trailer's builds to a plateau; the voice ducks it, but never
 * below `duckDb` under full level, so a line near the start doesn't push the quiet opening lower still.
 */
export function musicAutomation(
  music: Pick<Edl["style"]["music"], "gainDb" | "duckDb">,
  edit: Edl["style"]["edit"],
  clips: { from: number; frames: number }[],
  fps: number,
  duration: number,
): { t: number; v: number }[] {
  const gain = music.gainDb ?? -6;
  const plateau = duration * ARC_PLATEAU;
  const arc = (t: number) => (edit === "trailer" ? ARC_START_DB * (1 - smoothstep(t / plateau)) : 0);

  const lines = clips.map((c) => [c.from / fps, (c.from + c.frames) / fps] as const);
  let hold = DUCK_HOLD;
  let spans: [number, number][];
  let points: number[];
  do {
    spans = [];
    for (const [from, to] of lines) {
      const prev = spans.at(-1);
      if (prev && from - prev[1] < hold) prev[1] = Math.max(prev[1], to);
      else spans.push([from, to]);
    }
    points = [0, duration, ...spans.flatMap(([from, to]) => [from - DUCK_ATTACK, from, to, to + DUCK_RELEASE])];
    if (edit === "trailer") for (let t = 1; t < plateau; t++) points.push(t);
    points = [...new Set(points.filter((t) => t >= 0 && t <= duration).map(r3))].sort((a, b) => a - b);
    hold *= 2;
  } while (points.length > MAX_POINTS && spans.length > 1);

  const duck = (t: number) => {
    let down = 0;
    for (const [from, to] of spans) {
      if (t >= from - DUCK_ATTACK && t <= to + DUCK_RELEASE) {
        const k = t < from ? (t - from + DUCK_ATTACK) / DUCK_ATTACK : t > to ? 1 - (t - to) / DUCK_RELEASE : 1;
        down = Math.max(down, k);
      }
    }
    return music.duckDb * down;
  };
  return points.slice(0, MAX_POINTS).map((t) => ({ t, v: r3(10 ** ((gain + Math.min(arc(t), duck(t))) / 20)) }));
}
