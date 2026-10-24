import { z } from "zod";
import { Lang, Seconds, VideoMode } from "./common.ts";

// script/storyboard.json (shared by every language) and script/script.<lang>.json (PRD §9.4)

export const BeatRole = z.enum(["hook", "problem", "setup", "core", "payoff", "cta", "headline"]);
export type BeatRole = z.infer<typeof BeatRole>;

export const Beat = z
  .object({
    id: z.string(),
    role: BeatRole,
    /** Footage span in source seconds: all three or none (cards and headlines have none). */
    flowId: z.string().optional(),
    in: Seconds.optional(),
    out: Seconds.optional(),
    /** English; scripts translate. */
    onScreen: z.array(
      z.object({
        kind: z.enum(["title", "callout", "lowerThird"]),
        text: z.string(),
        stepId: z.string().optional(),
      }),
    ),
    motion: z.object({
      kind: z.enum(["reveal", "emphasis", "transition", "hold"]),
      emotion: z.string(),
      focusStepId: z.string().optional(),
    }),
    /** What the narration must get across. */
    intent: z.string(),
    /** 85% of the footage (70% in trailers), or the card's length for hook/cta. */
    maxSeconds: Seconds,
  })
  .refine(
    (b) => {
      const set = [b.flowId, b.in, b.out].filter((v) => v !== undefined).length;
      return set === 0 || (set === 3 && b.out! > b.in!);
    },
    { message: "flowId, in and out are all set (with out > in) or all missing" },
  );
export type Beat = z.infer<typeof Beat>;

export const Storyboard = z.object({
  schemaVersion: z.literal(1),
  arc: VideoMode,
  edit: z.enum(["trailer", "guide"]),
  beats: z.array(Beat).min(1),
});
export type Storyboard = z.infer<typeof Storyboard>;

export const Script = z.object({
  schemaVersion: z.literal(2),
  lang: Lang,
  hook: z.string(),
  titleCard: z.string(),
  cta: z.string(),
  posting: z.object({ title: z.string(), description: z.string(), hashtags: z.array(z.string()) }),
  segments: z.array(
    z.object({
      beatId: z.string(),
      text: z.string(),
      onScreen: z.array(z.string()),
      maxSeconds: Seconds,
    }),
  ),
});
export type Script = z.infer<typeof Script>;
