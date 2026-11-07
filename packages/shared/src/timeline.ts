import { z } from "zod";
import { FormFactor, Point, Rect, Redacted, Seconds } from "./common.ts";
import { StepAction } from "./flow.ts";

// record/<formFactor>/timeline.json, the edit timeline (PRD §10).
// All times are seconds of video time in recording.mp4 beside it.

/**
 * v2: the page's structure when a step settled, for animating its parts (the element map). Boxes only,
 * in CSS pixels clipped to the viewport: no text, so nothing private is kept.
 */
export const Layout = z.object({
  /** When it was taken, if not the event's own time: the page as an action was about to happen. */
  at: Seconds.optional(),
  /** A dialog or drawer on top of the page. */
  panel: Rect.optional(),
  /** The card or section the acted element sits in. */
  component: Rect.optional(),
  /** Repeating items on top of the page, largest first. */
  groups: z.array(
    z.object({
      kind: z.enum(["rows", "cards", "columns"]),
      box: Rect,
      items: z.array(Rect).min(3),
    }),
  ),
});
export type Layout = z.infer<typeof Layout>;

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
  /** On a settled event. */
  layout: Layout.optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Timeline = z.object({
  /** v2 adds `layout` to settled events, so a v1 timeline still reads. */
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
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
