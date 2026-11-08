import { EndCardProps, OpenerProps, type Edl, type Primitive, type Timeline } from "@agentcast/shared";
import type { MoveCue } from "../audio.ts";
import { MOCKUP, WALL, outputStart, pillTimes } from "./brand.ts";

// When a designed move's parts happen, pure and shared by its scene, its sounds and its stills, so the
// sound lands exactly where the picture does.

const PRIORITY = { payoff: 1, transition: 2, click: 3, landing: 4, tick: 6 };

/** Splits a line into 1–3 word phrases, the way the reference films do. */
export function phrasesOf(text: string, maxWords = 3, maxChars = 18): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const length = cur.join(" ").length + word.length + (cur.length ? 1 : 0);
    if (cur.length && (cur.length >= maxWords || length > maxChars)) {
      out.push(cur.join(" "));
      cur = [];
    }
    cur.push(word);
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

const textIn = (text: Record<string, string>, lang: string) => text[lang] ?? text.en ?? Object.values(text)[0] ?? "";

/** Whole beats a phrase holds: the opener's phrases share it, keeping a beat for the line that closes it. */
export const openerSlot = (phrases: number, seconds: number, beat: number) =>
  Math.max(beat, Math.floor((seconds - beat) / Math.max(1, phrases) / beat) * beat);

/**
 * When a build's items land: spread over the first part of the move, on eighth or quarter notes, so a
 * few items don't land at once and then hold; eighths closing up if there are many.
 */
export function buildStep(items: number, beat: number, seconds: number) {
  const spread = (seconds * 0.45) / items;
  if (spread <= beat / 2) return Math.min(beat / 2, (beat * 2) / items);
  return Math.min(beat, Math.round(spread / (beat / 2)) * (beat / 2));
}

/** When a build's lifted piece comes forward, on a beat: after the pieces land, with time left to read it. */
export function liftAt(items: number, seconds: number, beat: number) {
  const built = items * buildStep(items, beat, seconds) + beat / 2;
  const at = Math.ceil(built / beat) * beat;
  return seconds - at >= beat * 2 ? at : undefined;
}

/** Seconds a proof's camera takes from one region to the next, starting on its beat. */
export const PATH_MOVE = 0.6;

/** When a proof's highlight hops: the last beats, by which time the page has settled. */
export const hopTimes = (hops: number, seconds: number, beat: number) =>
  Array.from({ length: hops }, (_, i) => Math.max(0, seconds - (hops - i) * beat));

/** A prompt's pull-back, the last part of its time. */
export const pullBackAt = (seconds: number, beat: number) => Math.max(seconds * 0.5, seconds - beat * 2);

/** A swap's word changes. */
export const swapTimes = (words: number, seconds: number, beat: number) => {
  const slot = Math.max(beat / 2, Math.min(beat, Math.floor((seconds / words / beat) * 2) * (beat / 2)));
  return Array.from({ length: words }, (_, i) => i * slot);
};

/** A move's sounds, seconds into its part. */
export function primitiveCues(p: Primitive, seconds: number, beat: number, timeline: Timeline, _lang: string): MoveCue[] {
  switch (p.type) {
    case "label":
      return [p.ground === "invert" ? { kind: "hit", at: 0, priority: PRIORITY.payoff, factor: 0.5 } : { kind: "pop", at: 0.02, priority: PRIORITY.landing }];
    case "swap":
      return swapTimes(p.words.length, seconds, beat).map((at) => ({ kind: "tick", at, priority: PRIORITY.landing }));
    case "ticker":
      return [{ kind: "whoosh", at: 0.05, priority: PRIORITY.transition, factor: 0.6 }];
    case "proof": {
      const hops = hopTimes(p.hops?.length ?? 0, seconds, beat);
      // A camera move along the path: a soft whoosh through it.
      const moves = (p.path ?? []).map((stop) => ({ kind: "whoosh" as const, at: stop.at + PATH_MOVE * 0.35, priority: PRIORITY.transition, factor: 0.5 }));
      return [{ kind: "whoosh", at: 0.05, priority: PRIORITY.transition }, ...moves, ...hops.map((at) => ({ kind: "click" as const, at, priority: PRIORITY.click, factor: 0.8 }))];
    }
    case "build": {
      const step = buildStep(p.items.length, beat, seconds);
      const lands: MoveCue[] = p.items.slice(0, 6).map((_, i) => ({ kind: "pop", at: i * step, priority: PRIORITY.landing, factor: 0.8 }));
      const lift = p.lift ? liftAt(p.items.length, seconds, beat) : undefined;
      return [...lands, ...(lift === undefined ? [] : [{ kind: "pop" as const, at: lift + 0.05, priority: PRIORITY.landing }])];
    }
    case "wall":
      return [
        { kind: "whoosh", at: 0.05, priority: PRIORITY.transition },
        { kind: "whoosh", at: seconds - WALL.dive + 0.4, priority: PRIORITY.transition },
      ];
    case "mockup":
      return [
        { kind: "whoosh", at: 0.05, priority: PRIORITY.transition },
        { kind: "whoosh", at: seconds - MOCKUP.through + 0.4, priority: PRIORITY.transition },
      ];
    case "pill": {
      const t = pillTimes(p, seconds, beat);
      const ticks: MoveCue[] = [];
      let chars = 0;
      for (const word of p.text.split(/(?<=\s)/)) {
        chars += [...word].length;
        const at = t.start + chars / t.rate;
        if (word.trim() && at < (t.press ?? t.fold)) ticks.push({ kind: "tick", at, priority: PRIORITY.tick });
      }
      return [{ kind: "whoosh", at: 0.05, priority: PRIORITY.transition, factor: 0.6 }, ...ticks, ...(t.press === undefined ? [] : [{ kind: "click" as const, at: t.press, priority: PRIORITY.click }])];
    }
    case "output":
      return [
        { kind: "pop", at: 0.1, priority: PRIORITY.landing },
        { kind: "click", at: outputStart(beat), priority: PRIORITY.click },
      ];
    case "orbit":
      return p.logos.slice(0, 6).map((_, i) => ({ kind: "pop" as const, at: 0.2 + i * 0.07, priority: PRIORITY.landing, factor: 0.6 }));
    case "prompt": {
      const typed = timeline.events.find((e) => e.kind === "type" && e.flowId === p.flowId && e.t >= p.in && e.t <= p.out);
      const value = typeof typed?.value === "string" ? typed.value : "";
      const pull = pullBackAt(seconds, beat);
      const speed = (p.out - p.in) / seconds;
      let chars = 0;
      const ticks: MoveCue[] = [];
      for (const word of value.split(/(?<=\s)/)) {
        chars += word.length;
        const at = (typed!.t - p.in + chars / 14) / speed;
        if (word.trim() && at < pull) ticks.push({ kind: "tick", at, priority: PRIORITY.tick });
      }
      return [...ticks, { kind: "whoosh", at: pull + 0.05, priority: PRIORITY.transition }];
    }
  }
}

/** A title or end card's sounds, or undefined for the voice-led cards. */
export function cardCues(card: Edl["intro"], seconds: number, beat: number, lang: string, logoFirst = false): MoveCue[] | undefined {
  if (card.component === "Opener") {
    const phrases = phrasesOf(textIn(OpenerProps.parse(card.props).line, lang));
    // Opening on the logo: a pop as it lands, a whoosh as it lifts away, then the line in the time left.
    const from = logoFirst ? Math.max(beat * 2, Math.floor(seconds / 2 / beat) * beat) : 0;
    const slot = openerSlot(phrases.length, seconds - from, beat);
    return [
      ...(logoFirst ? [{ kind: "pop" as const, at: 0.1, priority: PRIORITY.landing }, { kind: "whoosh" as const, at: from - 0.15, priority: PRIORITY.transition, factor: 0.6 }] : []),
      ...phrases.map((_, i) => ({ kind: "pop" as const, at: from + i * slot, priority: PRIORITY.landing, factor: 0.8 })),
      { kind: "whoosh", at: seconds - beat + 0.05, priority: PRIORITY.transition },
    ];
  }
  if (card.component === "EndCard") {
    EndCardProps.parse(card.props);
    return [
      { kind: "riser", at: 0, priority: PRIORITY.payoff },
      { kind: "hit", at: 0, priority: PRIORITY.payoff },
    ];
  }
  return undefined;
}

/** Where to look at a move, as shares of its time. */
export function primitiveMoments(p: Primitive): number[] {
  switch (p.type) {
    case "label":
    case "ticker":
      return [0.6];
    case "swap":
      return [0.4, 0.85];
    case "proof":
      return p.path?.length ? [0.25, 0.6, 0.92] : [0.3, 0.92];
    case "build":
      return [0.45, 0.9];
    case "prompt":
      return [0.4, 0.92];
    case "wall":
    case "mockup":
      return [0.4, 0.8];
    case "pill":
      return [0.5, 0.85];
    case "output":
      return [0.6];
    case "orbit":
      return [0.4, 0.92];
  }
}
