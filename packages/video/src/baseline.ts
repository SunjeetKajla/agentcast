import {
  Edl,
  MOTION_PRESETS,
  type Brand,
  type CameraKey,
  type MotionTokens,
  type Personality,
  type Script,
  type Segment,
  type ShotSegment,
  type Storyboard,
  type Timeline,
  type Voiceover,
} from "@agentcast/shared";
import { cropFor, inView, onPage } from "./camera.ts";
import { chooseLook } from "./look.ts";
import { calloutSeconds, cardSeconds, moveSeconds, readSeconds } from "./motion.ts";
import { VOICE_SPACING } from "./plan.ts";

// The edit without an LLM (PRD §9.7): the fallback, and the starting point the director improves.

/** AgentCast's own look, for a product without a brand kit. */
const DEFAULT_PALETTE = { bg: "#0e1012", fg: "#f1f0ea", accent: "#8ab4f8", surface: "#181b1f" };

const PACING: Record<Personality, Edl["style"]["pacing"]> = {
  playful: "balanced",
  premium: "calm",
  corporate: "balanced",
  energetic: "punchy",
};

/** How a shot arrives after a different moment, by personality. Continuous footage cuts. */
const TRANSITION: Record<Personality, ShotSegment["transitionIn"]> = {
  premium: "fade",
  corporate: "fade",
  playful: "slide",
  energetic: "zoom-through",
};

/** Actions the camera moves to. Typing keeps it where the field already is. */
const AIMED = new Set(["click", "select", "hover", "type"]);

export type BaselineInput = {
  timeline: Timeline;
  storyboard: Storyboard;
  /** Every language's script: on-screen text is shown in the language being rendered. */
  scripts: Record<string, Script>;
  /** Every language's voice, if made: shots last at least as long as their shortest line. */
  voices?: Voiceover[];
  personality: Personality;
  brand?: Brand;
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * One segment per storyboard beat with footage, trimmed to its span, plus a headline scene for each
 * headline beat. The camera starts toward each clicked element early enough to land as the click
 * does, stays through typing and the motion tokens' hold, and eases back to the whole frame when
 * nothing happens for a while. A beat's title opens its shot, callouts point at their step's
 * element as the pointer heads there, and lower thirds take the next quiet moment.
 */
export function baselineEdl(o: BaselineInput): Edl {
  const { storyboard } = o;
  const view = { w: o.timeline.viewport.w, h: o.timeline.viewport.h };
  // Element boxes cut to the page: an element can stick out past the edge of the viewport.
  const timeline: Timeline = {
    ...o.timeline,
    events: o.timeline.events.map(({ bbox, ...e }) => {
      const box = bbox && onPage(bbox, view);
      return box ? { ...e, bbox: box } : e;
    }),
  };
  const trailer = storyboard.edit === "trailer";
  const preset = MOTION_PRESETS[o.personality];
  // A trailer pushes in harder.
  const motion = trailer ? { ...preset, zoom: Math.min(2.5, Math.max(preset.zoom, 1.65)) } : preset;
  const move = moveSeconds(motion);
  const langs = Object.keys(o.scripts);

  /** A beat's on-screen text in every language (scripts carry translations in storyboard order). */
  const translated = (beatId: string, index: number, fallback: string) =>
    Object.fromEntries(
      (langs.length ? langs : ["en"]).map((lang) => [
        lang,
        o.scripts[lang]?.segments.find((s) => s.beatId === beatId)?.onScreen[index] || fallback,
      ]),
    );
  /** The shortest language's line for a beat, with air around it. */
  const spoken = (beatId: string) => {
    const seconds = (o.voices ?? []).map((v) => v.clips.find((c) => c.beatId === beatId)?.seconds);
    if (!seconds.length || seconds.some((s) => s === undefined)) return 0;
    return Math.min(...(seconds as number[])) + VOICE_SPACING.lead + VOICE_SPACING.tail;
  };

  const segments: Segment[] = [];
  for (const beat of storyboard.beats) {
    const prev = segments.at(-1);
    if (beat.flowId === undefined || beat.in === undefined || beat.out === undefined) {
      const title = beat.onScreen.findIndex((x) => x.kind === "title");
      if (beat.role !== "headline" || title < 0) continue;
      const text = translated(beat.id, title, beat.onScreen[title]!.text);
      segments.push({
        kind: "statement",
        id: beat.id,
        beatId: beat.id,
        text,
        seconds: round(Math.max(readSeconds(Object.values(text)[0] ?? "", 1.8), spoken(beat.id))),
        transitionIn: "fade",
      });
      continue;
    }
    const sin = Math.max(0, beat.in);
    const sout = Math.min(timeline.duration, beat.out);
    if (sout - sin < 0.5) continue;

    const camera = cameraFor(timeline, sin, sout, motion.zoom, motion.hold, move);
    const texts = textsFor(
      timeline,
      beat,
      { sin, sout, held: Math.max(sout, sin + spoken(beat.id)) },
      camera,
      motion,
      translated,
    );
    const continuous = prev?.kind === "shot" && prev.flowId === beat.flowId && Math.abs(prev.out - sin) < 0.3;
    // A trailer speeds through waits and typing, as long as the shot stays as long as its line.
    const ramps = trailer ? rampsFor(timeline, sin, sout, spoken(beat.id), texts) : [];
    segments.push({
      kind: "shot",
      id: beat.id,
      beatId: beat.id,
      flowId: beat.flowId,
      in: round(sin),
      out: round(sout),
      ...(ramps.length ? { ramps } : {}),
      camera,
      cursor: "auto",
      ...texts,
      // Out of a headline, a trailer zooms through into its proof.
      transitionIn: !prev
        ? "fade"
        : continuous
          ? "cut"
          : trailer && prev.kind === "statement"
            ? "zoom-through"
            : TRANSITION[o.personality],
    });
  }
  if (!segments.some((s) => s.kind === "shot")) throw new Error("The storyboard has no footage to cut.");
  if (trailer) {
    const montage = montageOf(timeline, segments);
    if (montage) segments.push(montage);
  }

  const card = cardSeconds(motion);
  const brand = o.brand;
  return Edl.parse({
    schemaVersion: 5,
    fps: 30,
    style: {
      palette: brand ? brand.palette : DEFAULT_PALETTE,
      fonts: { display: brand?.fonts.display.family ?? "Inter", text: brand?.fonts.text.family ?? "Inter" },
      look: chooseLook(brand, o.personality, brand ? new URL(brand.url).host : "agentcast"),
      pacing: PACING[o.personality],
      edit: storyboard.edit,
      captionStyle: trailer ? "minimal" : o.voices?.length ? "karaoke" : "block",
      music: { mood: "none", duckDb: -12 },
      // A trailer has sound effects and tilted windows; a guide stays plain and flat.
      sfx: trailer ? "auto" : "none",
      frame: trailer ? "tilt" : "window",
      motion,
    },
    intro: { component: "TitleCard", props: {}, seconds: card },
    segments,
    outro: { component: "Outro", props: {}, seconds: card },
  });
}

/**
 * Camera keys for one shot. Each aimed action gets a key that starts one move before it, so the
 * camera lands as the action happens; after a quiet stretch longer than the hold the camera first
 * returns to the whole frame. A move between two zoomed targets more than a third of the frame apart
 * goes out to the whole frame and back in, or cuts when there's no time (a whip pan reads as a
 * mistake). Keys are in order and at least half a move apart, except cuts.
 */
function cameraFor(
  timeline: Timeline,
  sin: number,
  sout: number,
  zoom: number,
  hold: number,
  move: number,
): CameraKey[] {
  const keys: CameraKey[] = [];
  const view = { w: timeline.viewport.w, h: timeline.viewport.h };
  const centre = (target: [number, number, number, number]) => {
    const c = cropFor(target, zoom, view, 16 / 9);
    return [c.x + c.w / 2, c.y + c.h / 2] as const;
  };
  const push = (key: CameraKey) => {
    const t = Math.max(key.t, (keys.at(-1)?.t ?? -Infinity) + (key.ease === "cut" ? 0.1 : move / 2));
    if (t < sout) keys.push({ ...key, t: round(t) });
  };
  let busyUntil = -Infinity;
  for (const e of timeline.events) {
    if (e.kind === "settled" || e.t < sin || e.t > sout || !AIMED.has(e.kind) || !e.bbox) continue;
    const typing = e.kind === "type" ? (typeof e.value === "string" ? e.value.length / 14 : 0.6) : 0;
    const start = Math.max(sin, e.t - move);
    if (keys.length && start - busyUntil > hold + move)
      push({ t: busyUntil + hold, target: "full", zoom: 1, ease: "smooth" });
    const prev = keys.at(-1);
    const [ax, ay] = prev && prev.target !== "full" ? centre(prev.target) : [0, 0];
    const [bx, by] = centre(e.bbox);
    const far = prev && prev.target !== "full" && Math.hypot(ax - bx, ay - by) > view.w / 3;
    if (far && start - prev.t >= move) {
      const out = Math.max(prev.t + move / 2, start - move / 2);
      push({ t: out, target: "full", zoom: 1, ease: "smooth" });
      push({ t: Math.max(start, out + move / 2), target: e.bbox, zoom, ease: "spring" });
    } else if (far) push({ t: Math.max(sin, e.t - 0.15), target: e.bbox, zoom, ease: "cut" });
    else push({ t: start, target: e.bbox, zoom, ease: "spring" });
    busyUntil = Math.max(busyUntil, e.t + typing);
  }
  if (keys.length && busyUntil + hold < sout - move)
    push({ t: busyUntil + hold, target: "full", zoom: 1, ease: "smooth" });
  return keys;
}

/** A shot's title, callouts and lower thirds, one at a time so they never cover each other. */
function textsFor(
  timeline: Timeline,
  beat: Storyboard["beats"][number],
  /** The footage's in and out, and how long the shot plays with its narration. */
  span: { sin: number; sout: number; held: number },
  camera: CameraKey[],
  motion: MotionTokens,
  translated: (beatId: string, index: number, fallback: string) => Record<string, string>,
): Pick<ShotSegment, "title" | "callouts" | "lowerThirds"> {
  const { sin, held } = span;
  // Text may stay up while a shot holds for its narration, but starts while the footage plays.
  const latest = Math.min(held - 1, span.sout - 0.3);
  const view = { w: timeline.viewport.w, h: timeline.viewport.h };
  const move = moveSeconds(motion);
  const free = (a: number, b: number) => busy.every(([x, y]) => b <= x || a >= y);
  const out: Pick<ShotSegment, "title" | "callouts" | "lowerThirds"> = {};
  const busy: [number, number][] = [];
  beat.onScreen.forEach((item, index) => {
    const text = translated(beat.id, index, item.text);
    const words = Object.values(text)[0] ?? item.text;
    if (item.kind === "title") {
      const seconds = Math.min(3, readSeconds(words, 1.4), (held - sin) * 0.5);
      if (seconds < 1 || out.title) return;
      out.title = { text, seconds: round(seconds) };
      busy.push([sin, sin + seconds + 0.2]);
    } else if (item.kind === "callout") {
      const event = timeline.events.find(
        (e) => e.stepId === item.stepId && e.kind !== "settled" && e.t >= sin && e.t < span.sout,
      );
      // A native dropdown's choice has no box of its own: point at what was opened just before.
      const anchor =
        event &&
        (event.bbox ?? timeline.events.filter((e) => e.bbox && e.t <= event.t && e.t > event.t - 3).at(-1)?.bbox);
      if (!event || !anchor) return;
      // Up as the camera lands on the element (its move starts one move before the action), and
      // only once the camera shows it.
      const lasts = calloutSeconds(words);
      let t = Math.max(sin, event.t - move * 0.25, ...busy.map(([, end]) => end));
      while (t <= latest && !inView(camera, t + Math.min(0.5, lasts / 2), anchor, view, motion)) t += 0.25;
      if (t > latest || !free(t, t + lasts)) return;
      (out.callouts ??= []).push({
        t: round(t),
        text,
        anchor,
        ...(beat.motion.kind === "emphasis" ? { spotlight: true } : {}),
      });
      busy.push([t, t + lasts + 0.2]);
    } else {
      const need = readSeconds(words, 2);
      let t = sin + 0.6;
      for (const [a, b] of [...busy].sort((p, q) => p[0] - q[0])) if (t + need > a && t < b) t = b;
      if (t > latest) return;
      (out.lowerThirds ??= []).push({ t: round(t), text });
      busy.push([t, t + need + 0.2]);
    }
  });
  return out;
}

/**
 * Speed ramps for a trailer shot (PRD §9.6): typing plays at 3×, and long waits between actions and
 * the recorder's dead time at 2.5×, the longest first. Never while text is on screen, and only while
 * the footage stays at least as long as its narration, so a ramp never turns into a freeze.
 */
function rampsFor(
  timeline: Timeline,
  sin: number,
  sout: number,
  spoken: number,
  texts: Pick<ShotSegment, "title" | "callouts" | "lowerThirds">,
): NonNullable<ShotSegment["ramps"]> {
  const inShot = timeline.events.filter((e) => e.t >= sin && e.t <= sout);
  const windows: { from: number; to: number; speed: number }[] = [];
  for (const e of inShot)
    if (e.kind === "type" && typeof e.value === "string" && e.value.length > 6)
      windows.push({ from: e.t + 0.25, to: e.t + e.value.length / 14 - 0.1, speed: 3 });
  const acts = inShot.filter((e) => e.kind !== "settled");
  for (const [i, act] of acts.entries()) {
    const next = acts[i + 1];
    if (!next) break;
    const settled = inShot.find((e) => e.kind === "settled" && e.stepId === act.stepId && e.t >= act.t)?.t ?? act.t;
    const leaves = next.cursor?.t0 ?? next.t;
    if (leaves - settled > 1.4) windows.push({ from: settled + 0.45, to: leaves - 0.3, speed: 2.5 });
  }
  for (const [a, b] of timeline.dead) if (b - a > 1) windows.push({ from: a + 0.2, to: b - 0.2, speed: 2.5 });
  // Text reads at normal speed.
  const busy: [number, number][] = [];
  if (texts.title) busy.push([sin, sin + texts.title.seconds]);
  for (const c of texts.callouts ?? []) busy.push([c.t, c.t + calloutSeconds(Object.values(c.text)[0] ?? "")]);
  for (const l of texts.lowerThirds ?? []) busy.push([l.t, l.t + readSeconds(Object.values(l.text)[0] ?? "", 2)]);
  let slack = sout - sin - spoken;
  const ramps: NonNullable<ShotSegment["ramps"]> = [];
  const candidates = windows
    .map((w) => ({ ...w, from: Math.max(sin, w.from), to: Math.min(sout, w.to) }))
    .filter((w) => w.to - w.from >= 0.8)
    .sort((a, b) => b.to - b.from - (a.to - a.from));
  for (const w of candidates) {
    if (busy.some(([a, b]) => w.from < b && w.to > a)) continue;
    if (ramps.some((r) => w.from < r.to + 0.2 && w.to > r.from - 0.2)) continue;
    // What it saves, allowing for the eased edges that run slower.
    const saves = (w.to - w.from) * (1 - 1 / w.speed) * 0.85;
    if (saves > slack) continue;
    slack -= saves;
    ramps.push({ from: round(w.from), to: round(w.to), speed: w.speed });
  }
  return ramps.sort((a, b) => a.from - b.from);
}

/**
 * The closing montage of a trailer: the payoff moment of up to four shots (each one's last settled
 * result and a second around it), side by side. Needs at least two moments to be a montage.
 */
function montageOf(timeline: Timeline, segments: Segment[]): Segment | undefined {
  const shots = segments.filter((s): s is ShotSegment => s.kind === "shot");
  const clips = shots
    .map((shot) => {
      const payoff =
        timeline.events.filter((e) => e.kind === "settled" && e.t >= shot.in && e.t <= shot.out).at(-1)?.t ?? shot.out;
      const out = Math.min(shot.out, payoff + 1);
      return { flowId: shot.flowId, in: round(Math.max(shot.in, out - 2.4)), out: round(out) };
    })
    .filter((c) => c.out - c.in >= 1)
    .slice(-4);
  if (clips.length < 2) return undefined;
  return { kind: "montage", id: "montage", clips, seconds: 2.8, transitionIn: "zoom-through" };
}
