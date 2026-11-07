import { EndCardProps, OpenerProps, type Edl, type Primitive, type Timeline } from "@agentcast/shared";
import type { MoveCue } from "../audio.ts";

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

/** When a build's items land: eighth notes, closing up if there are many. */
export const buildStep = (items: number, beat: number) => Math.min(beat / 2, (beat * 2) / items);

/** When a build's lifted piece comes forward, on a beat: after the pieces land, with time left to read it. */
export function liftAt(items: number, seconds: number, beat: number) {
  const built = items * buildStep(items, beat) + beat / 2;
  const at = Math.ceil(built / beat) * beat;
  return seconds - at >= beat * 2 ? at : undefined;
}

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
      return [{ kind: "whoosh", at: 0.05, priority: PRIORITY.transition }, ...hops.map((at) => ({ kind: "click" as const, at, priority: PRIORITY.click, factor: 0.8 }))];
    }
    case "build": {
      const step = buildStep(p.items.length, beat);
      const lands: MoveCue[] = p.items.slice(0, 6).map((_, i) => ({ kind: "pop", at: i * step, priority: PRIORITY.landing, factor: 0.8 }));
      const lift = p.lift ? liftAt(p.items.length, seconds, beat) : undefined;
      return [...lands, ...(lift === undefined ? [] : [{ kind: "pop" as const, at: lift + 0.05, priority: PRIORITY.landing }])];
    }
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
export function cardCues(card: Edl["intro"], seconds: number, beat: number, lang: string): MoveCue[] | undefined {
  if (card.component === "Opener") {
    const phrases = phrasesOf(textIn(OpenerProps.parse(card.props).line, lang));
    const slot = openerSlot(phrases.length, seconds, beat);
    return [
      ...phrases.map((_, i) => ({ kind: "pop" as const, at: i * slot, priority: PRIORITY.landing, factor: 0.8 })),
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
      return [0.3, 0.92];
    case "build":
      return [0.45, 0.9];
    case "prompt":
      return [0.4, 0.92];
  }
}
