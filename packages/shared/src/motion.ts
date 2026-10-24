import { z } from "zod";
import { Personality, Seconds } from "./common.ts";

// Motion tokens (FR-76, PRD §9.7.1). Every primitive takes its timing from these.

export const Bezier = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Bezier = z.infer<typeof Bezier>;

export const MotionTokens = z.object({
  personality: Personality,
  /** Signature cubic-bezier. */
  easing: Bezier,
  /** Seconds, overlay (UI) scale. */
  durations: z.object({ quick: Seconds, standard: Seconds, slow: Seconds }),
  /** Camera moves, transitions and cards take durations × this (2–3). */
  cameraScale: z.number().min(1).max(4),
  /** Overlays only, 0–0.3. */
  overshoot: z.number().min(0).max(0.3),
  entrance: z.enum(["fade-scale", "slide", "rise", "snap"]),
  /** Seconds the camera stays after an action. */
  hold: Seconds,
  /** Zoom onto a clicked element. */
  zoom: z.number().min(1).max(2.5),
});
export type MotionTokens = z.infer<typeof MotionTokens>;

/** Starting values per personality. The video track (Neeraj) owns the tuning. */
export const MOTION_PRESETS: Record<Personality, MotionTokens> = {
  playful: {
    personality: "playful",
    easing: [0.34, 1.56, 0.64, 1],
    durations: { quick: 0.2, standard: 0.35, slow: 0.6 },
    cameraScale: 2.5,
    overshoot: 0.2,
    entrance: "fade-scale",
    hold: 0.8,
    zoom: 1.6,
  },
  premium: {
    personality: "premium",
    easing: [0.16, 1, 0.3, 1],
    durations: { quick: 0.25, standard: 0.45, slow: 0.8 },
    cameraScale: 3,
    overshoot: 0,
    entrance: "rise",
    hold: 1.2,
    zoom: 1.4,
  },
  corporate: {
    personality: "corporate",
    easing: [0.4, 0, 0.2, 1],
    durations: { quick: 0.2, standard: 0.3, slow: 0.5 },
    cameraScale: 2.5,
    overshoot: 0.05,
    entrance: "slide",
    hold: 1,
    zoom: 1.5,
  },
  energetic: {
    personality: "energetic",
    easing: [0.22, 1, 0.36, 1],
    durations: { quick: 0.15, standard: 0.25, slow: 0.4 },
    cameraScale: 2,
    overshoot: 0.15,
    entrance: "snap",
    hold: 0.6,
    zoom: 1.8,
  },
};
