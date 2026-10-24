import { z } from "zod";
import { FormFactor, HexColor, Rect, Seconds, TextByLang } from "./common.ts";
import { MotionTokens } from "./motion.ts";

// render/edl.json: written by the baseline and the director, rendered by Remotion (PRD §10, §9.7)

export const TransitionKind = z.enum(["cut", "fade", "slide", "zoom-through"]);

export const CameraKey = z.object({
  /** Source seconds. */
  t: Seconds,
  target: z.union([z.literal("full"), Rect]),
  zoom: z.number().min(1).max(2.5),
  ease: z.enum(["spring", "smooth", "cut"]),
});
export type CameraKey = z.infer<typeof CameraKey>;

export const SfxKind = z.enum(["whoosh", "click", "pop", "riser", "hit"]);

export const ShotSegment = z.object({
  kind: z.literal("shot"),
  id: z.string(),
  /** The storyboard beat this shot plays. */
  beatId: z.string().optional(),
  flowId: z.string(),
  formFactorSource: FormFactor.optional(),
  in: Seconds,
  out: Seconds,
  /** Source seconds, 1.25–4×. */
  ramps: z.array(z.object({ from: Seconds, to: Seconds, speed: z.number().min(1.25).max(4) })).optional(),
  camera: z.array(CameraKey),
  cursor: z.enum(["auto", "hidden"]),
  callouts: z
    .array(
      z.object({
        t: Seconds,
        text: TextByLang,
        anchor: Rect,
        spotlight: z.boolean().optional(),
        /** Lift the element out as a card. */
        lift: z.boolean().optional(),
      }),
    )
    .optional(),
  title: z.object({ text: TextByLang, seconds: Seconds }).optional(),
  lowerThirds: z.array(z.object({ t: Seconds, text: TextByLang })).optional(),
  sfx: z.array(z.object({ t: Seconds, kind: SfxKind, gain: z.number().optional() })).optional(),
  transitionIn: TransitionKind,
});
export type ShotSegment = z.infer<typeof ShotSegment>;

export const StatementSegment = z.object({
  kind: z.literal("statement"),
  id: z.string(),
  beatId: z.string().optional(),
  text: TextByLang,
  kicker: TextByLang.optional(),
  seconds: Seconds,
  transitionIn: TransitionKind,
});

export const MontageSegment = z.object({
  kind: z.literal("montage"),
  id: z.string(),
  clips: z.array(z.object({ flowId: z.string(), in: Seconds, out: Seconds })).min(1),
  text: TextByLang.optional(),
  seconds: Seconds,
  transitionIn: TransitionKind,
});

export const StatSegment = z.object({
  kind: z.literal("stat"),
  id: z.string(),
  value: z.number(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  decimals: z.number().int().min(0).max(3).optional(),
  label: TextByLang,
  seconds: Seconds,
  transitionIn: TransitionKind,
});

export const Segment = z.discriminatedUnion("kind", [ShotSegment, StatementSegment, MontageSegment, StatSegment]);
export type Segment = z.infer<typeof Segment>;

export const Card = z.object({
  component: z.string(),
  props: z.record(z.string(), z.unknown()),
  seconds: Seconds,
});

export const EdlStyle = z.object({
  palette: z.object({
    bg: HexColor,
    fg: HexColor,
    accent: HexColor,
    surface: HexColor.optional(),
    accent2: HexColor.optional(),
  }),
  /** The brand's fonts (Google Fonts families). */
  fonts: z.object({ display: z.string(), text: z.string() }),
  look: z.object({
    theme: z.enum(["dark", "light"]),
    title: z.enum(["center", "editorial", "wordmark", "split"]),
    statement: z.enum(["center", "editorial", "panel", "outline"]),
    backdrop: z.enum(["glow", "solid", "mesh", "hero"]),
    chrome: z.enum(["browser", "minimal", "none"]),
    radius: z.number().nonnegative(),
  }),
  pacing: z.enum(["calm", "balanced", "punchy"]),
  edit: z.enum(["trailer", "guide"]),
  captionStyle: z.enum(["karaoke", "block", "minimal"]),
  music: z.object({
    mood: z.string(),
    /** From assets/music/tags.json. */
    trackId: z.string().optional(),
    bpm: z.number().positive().optional(),
    firstBeat: Seconds.optional(),
    gainDb: z.number().optional(),
    duckDb: z.number(),
  }),
  sfx: z.enum(["auto", "none"]),
  /** 16:9 shots: browser window, tilted window, or full bleed. */
  frame: z.enum(["window", "tilt", "none"]),
  motion: MotionTokens,
});
export type EdlStyle = z.infer<typeof EdlStyle>;

export const Edl = z.object({
  schemaVersion: z.literal(5),
  fps: z.literal(30),
  style: EdlStyle,
  intro: Card,
  /** Playing order. */
  segments: z.array(Segment).min(1),
  outro: Card,
});
export type Edl = z.infer<typeof Edl>;
