import type { MotionTokens } from "@agentcast/shared";

// Timing and easing for every moving thing in the edit, from the video's motion tokens (PRD §9.7.1).

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` at progress `p`: finds the curve parameter whose x is `p`
 * (x is monotonic because x1 and x2 are within 0–1), then returns its y. Overshooting curves return
 * values above 1 on the way.
 */
export function bezier([x1, y1, x2, y2]: MotionTokens["easing"], p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const along = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0;
  let hi = 1;
  let s = p;
  for (let i = 0; i < 32; i++) {
    s = (lo + hi) / 2;
    if (along(x1, x2, s) < p) lo = s;
    else hi = s;
  }
  return along(y1, y2, s);
}

/** Progress 0–1 on the video's signature curve. */
export const eased = (motion: MotionTokens, p: number) => bezier(motion.easing, clamp01(p));

/** The same curve with no overshoot, for the camera and transitions (a wobbling frame reads as a mistake). */
export const settled = (motion: MotionTokens, p: number) => Math.min(1, eased(motion, p));

/** Seconds a camera move or a transition takes: UI durations run slower at camera scale. */
export const moveSeconds = (motion: MotionTokens) => motion.durations.standard * motion.cameraScale;

/** Seconds to read a line on screen: about 3.5 words a second, plus a moment to notice it. */
export const readSeconds = (text: string, min = 1.2) =>
  Math.max(min, text.split(/\s+/).filter(Boolean).length / 3.5 + 0.6);

/** How long a callout stays up. */
export const calloutSeconds = (text: string) => Math.min(3.5, readSeconds(text, 1.6));

/** The title card and outro: calmer personalities (slower tokens) let them breathe longer. */
export const cardSeconds = (motion: MotionTokens) =>
  Math.round((2.2 + motion.durations.slow * motion.cameraScale * 0.6) * 10) / 10;

/**
 * An overlay shown from `start` to `end` (seconds): it rises in over the standard duration and fades
 * out over the quick one. Undefined while it's off screen.
 */
export function overlay(motion: MotionTokens, t: number, start: number, end: number, rise: number) {
  if (t < start || t >= end) return undefined;
  const enter = eased(motion, (t - start) / motion.durations.standard);
  const leave = clamp01((end - t) / motion.durations.quick);
  return { opacity: Math.min(clamp01(enter), leave), transform: `translateY(${(1 - enter) * rise}px)` };
}
