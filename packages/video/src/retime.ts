import type { ShotSegment } from "@agentcast/shared";

// Speed ramps (PRD §9.6): stretches of a shot's footage played faster. A shot's clock maps output
// seconds (time into the shot as it plays) to source seconds (time in the recording) and back.

export type Ramp = NonNullable<ShotSegment["ramps"]>[number];

export type Clock = {
  /** Output seconds the footage takes. */
  seconds: number;
  /** The source second on screen `o` output seconds into the shot, clamped to the footage. */
  toSource(o: number): number;
  /** Output seconds into the shot at which source second `s` plays (linear outside the footage). */
  toOutput(s: number): number;
};

const smoothstep = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/**
 * Playback speed at source second `s`. Inside a ramp the speed eases up from 1 over its first stretch
 * and back down over its last (a quarter of the ramp, at most 0.35 s each), so it reads as a ramp and
 * never as a jump cut.
 */
export function speedAt(ramps: Ramp[], s: number): number {
  const ramp = ramps.find((r) => s >= r.from && s <= r.to);
  if (!ramp) return 1;
  const edge = Math.min(0.35, (ramp.to - ramp.from) / 4);
  return 1 + (ramp.speed - 1) * Math.min(smoothstep((s - ramp.from) / edge), smoothstep((ramp.to - s) / edge));
}

/** Source step of the table: finer than a 30 fps frame at 4×, so no frame falls between entries. */
const STEP = 1 / 240;
const clocks = new WeakMap<object, Clock>();

/** A shot's clock. Without ramps it's the footage offset by `in`; with them, output time is the integral of 1 / speed. */
export function clockOf(shot: Pick<ShotSegment, "in" | "out" | "ramps">): Clock {
  const cached = clocks.get(shot);
  if (cached) return cached;
  const length = shot.out - shot.in;
  const ramps = (shot.ramps ?? []).filter((r) => r.to > shot.in && r.from < shot.out);
  let clock: Clock;
  if (!ramps.length) {
    clock = {
      seconds: length,
      toSource: (o) => shot.in + Math.min(Math.max(0, o), length),
      toOutput: (s) => s - shot.in,
    };
  } else {
    const steps = Math.max(1, Math.ceil(length / STEP));
    const h = length / steps;
    // elapsed[i]: output seconds when source second in + i·h is on screen.
    const elapsed = new Float64Array(steps + 1);
    for (let i = 0; i < steps; i++) elapsed[i + 1] = elapsed[i]! + h / speedAt(ramps, shot.in + (i + 0.5) * h);
    const seconds = elapsed[steps]!;
    clock = {
      seconds,
      toOutput(s) {
        if (s <= shot.in) return s - shot.in;
        if (s >= shot.out) return seconds + (s - shot.out);
        const x = (s - shot.in) / h;
        const i = Math.min(steps - 1, Math.floor(x));
        return elapsed[i]! + (elapsed[i + 1]! - elapsed[i]!) * (x - i);
      },
      toSource(o) {
        const t = Math.min(Math.max(0, o), seconds);
        let lo = 0;
        let hi = steps;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (elapsed[mid]! <= t) lo = mid;
          else hi = mid;
        }
        const span = elapsed[hi]! - elapsed[lo]!;
        return shot.in + (lo + (span > 0 ? (t - elapsed[lo]!) / span : 0)) * h;
      },
    };
  }
  clocks.set(shot, clock);
  return clock;
}
