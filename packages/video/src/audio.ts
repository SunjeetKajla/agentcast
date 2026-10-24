import type { Edl, Timeline } from "@agentcast/shared";
import type { Part } from "./plan.ts";
import { clockOf } from "./retime.ts";

// Where the sound effects play (PRD §9.7.2).

export type SfxKind = "whoosh" | "click" | "pop" | "riser" | "hit";

/** An effect on the output timeline: its first frame and its level (1 = as made). */
export type SfxCue = { kind: SfxKind; frame: number; gain: number };

/** Seconds from an effect's start to its peak: the peak, not the start, lands on the moment. */
const PEAK: Record<SfxKind, number> = { whoosh: 0.3, click: 0, pop: 0.02, riser: 1.1, hit: 0.01 };

/** Levels under the voice: present, never louder than the narration. */
const LEVEL: Record<SfxKind, number> = { whoosh: 0.4, click: 0.25, pop: 0.35, riser: 0.35, hit: 0.55 };

/**
 * The edit's sound effects. With `style.sfx: "auto"`: a riser that peaks as the title card's name
 * lands, a whoosh through the middle of every transition, a pop as a headline or stat lands, a soft
 * click on every recorded click, and a hit as the outro's call to action lands. A shot's own `sfx`
 * cues play either way.
 */
export function sfxCues(edl: Edl, parts: Part[], timeline: Timeline, frames: number): SfxCue[] {
  const fps = edl.fps;
  const auto = edl.style.sfx === "auto";
  const cues: SfxCue[] = [];
  const at = (kind: SfxKind, seconds: number, gain = 1) => {
    const frame = Math.round((seconds - PEAK[kind]) * fps);
    if (frame >= 0 && frame < frames) cues.push({ kind, frame, gain: LEVEL[kind] * gain });
  };
  for (const part of parts) {
    const start = part.from / fps;
    const landed = (part.from + part.enter.frames) / fps;
    if (auto && part.enter.frames > 0) at("whoosh", start + part.enter.frames / fps / 2);
    if (part.kind !== "segment") {
      // The riser peaks as the title card's name has landed; the hit as the call to action does.
      if (auto && part.kind === "intro") at("riser", 1.2);
      if (auto && part.kind === "outro") at("hit", landed + 0.3);
      continue;
    }
    const segment = edl.segments[part.index]!;
    if (segment.kind === "statement" || segment.kind === "stat") {
      if (auto) at("pop", landed + 0.15);
      continue;
    }
    if (segment.kind !== "shot") continue;
    const clock = clockOf(segment);
    const into = (t: number) => start + clock.toOutput(t);
    if (auto)
      for (const e of timeline.events)
        if (e.kind === "click" && e.flowId === segment.flowId && e.t >= segment.in && e.t <= segment.out)
          at("click", into(e.t));
    for (const cue of segment.sfx ?? []) at(cue.kind, into(cue.t), cue.gain ?? 1);
  }
  return cues.sort((a, b) => a.frame - b.frame);
}
