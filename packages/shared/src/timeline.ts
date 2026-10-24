import { z } from "zod";
import { FormFactor, Point, Rect, Redacted, Seconds } from "./common.ts";
import { StepAction } from "./flow.ts";

// record/<formFactor>/timeline.json, the edit timeline (PRD §10).
// All times are seconds of video time in recording.mp4 beside it.

export const TimelineEvent = z.object({
  t: Seconds,
  flowId: z.string(),
  stepId: z.string(),
  kind: z.union([StepAction, z.literal("settled")]),
  /** "Create project" */
  label: z.string(),
  /** Drives auto-zoom and callout anchors. */
  bbox: Rect.optional(),
  cursor: z.object({ from: Point, to: Point, t0: Seconds, t1: Seconds }).optional(),
  value: z.union([z.string(), Redacted]).optional(),
  url: z.string(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Timeline = z.object({
  schemaVersion: z.literal(1),
  recordingId: z.string(),
  formFactor: FormFactor,
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive(), dpr: z.number().positive() }),
  fps: z.literal(30),
  duration: Seconds,
  flows: z.array(z.object({ flowId: z.string(), in: Seconds, out: Seconds })),
  events: z.array(TimelineEvent),
  /** Safe-to-cut intervals [from, to]. */
  dead: z.array(z.tuple([Seconds, Seconds])),
});
export type Timeline = z.infer<typeof Timeline>;
