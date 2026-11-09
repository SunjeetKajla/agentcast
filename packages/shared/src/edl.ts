import { z } from "zod";
import { BrandMotion } from "./art.ts";
import { FormFactor, HexColor, Rect, Seconds, TextByLang } from "./common.ts";
import { MotionTokens } from "./motion.ts";

// render/edl.json: written by the baseline and the director, compiled to a HyperFrames composition (PRD §10, §9.7.5)

/** v6 adds blur-zoom (Lovable's zoom through a blur) and ribbon (LangEase's colour sweep). */
export const TransitionKind = z.enum(["cut", "fade", "slide", "zoom-through", "blur-zoom", "ribbon"]);

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
  /** v6: the word(s) of `text` set in the accent colour. */
  accent: TextByLang.optional(),
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

/**
 * v6: a scene the director wrote itself, `composition/compositions/<id>.html` (PRD §9.7.5). Its copy
 * reaches the file as variables: variable → language → text.
 */
export const SceneSegment = z.object({
  kind: z.literal("scene"),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  beatId: z.string().optional(),
  copy: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), TextByLang).optional(),
  seconds: Seconds,
  transitionIn: TransitionKind,
});

/** v7: a designed move with typed settings, drawn by the motion-primitive library. */
export const Primitive = z.discriminatedUnion("type", [
  /** A short line filling the frame between proofs. */
  z.object({
    type: z.literal("label"),
    text: TextByLang,
    accent: TextByLang.optional(),
    ground: z.enum(["base", "invert", "field"]),
    open: z.enum(["rise", "slit", "iris"]),
  }),
  /** A fixed lead with its last word changing on the beat. */
  z.object({
    type: z.literal("swap"),
    lead: TextByLang,
    words: z.array(TextByLang).min(2).max(6),
    style: z.enum(["swap", "rolodex"]),
  }),
  /** The product's real terms riding a ruled line across the frame. */
  z.object({ type: z.literal("ticker"), terms: z.array(TextByLang).min(3).max(10) }),
  /** v8: the site's own pages on a tilted plane, sliding, the camera diving into one (job-relative image paths). */
  z.object({ type: z.literal("wall"), pages: z.array(z.string()).min(6).max(16), focus: z.number().int().min(0) }),
  /** v8: the recorded typing rebuilt as a pill in a ring of the brand's light, typing the real value; the hand presses send if the recording did. */
  z.object({
    type: z.literal("pill"),
    flowId: z.string(),
    text: z.string().min(1).max(200),
    at: Seconds,
    press: z.boolean(),
    /** The pressed button's own label from the recording ("Generate with Bulbul V4"); an arrow without it. */
    button: z.string().min(1).max(40).optional(),
    /** Choices the recording made, as chips beside the pill ("தமிழ் · Tamil"). */
    chips: z.array(z.string().min(1).max(32)).max(3).optional(),
  }),
  /** v8: footage on a device we draw, turning into view, then the camera through its screen. */
  z.object({ type: z.literal("mockup"), flowId: z.string(), in: Seconds, out: Seconds, frame: Rect, device: z.enum(["laptop"]) }),
  /** v8: the product's own output, played: a waveform of the real audio lighting up as it plays (job-relative file). */
  z.object({
    type: z.literal("output"),
    file: z.string(),
    from: Seconds,
    seconds: Seconds,
    peaks: z.array(z.number().min(0).max(1)).min(8).max(96),
    /** A headline over it, from the shot or the site. */
    title: z.string().min(1).max(60).optional(),
    /** One of the brand's own objects (job-relative image) as the disc that plays, instead of a drawn one. */
    disc: z.string().optional(),
  }),
  /** v8: logos found on the site (job-relative images), orbiting the brand's logo, then lining up under it. Opt-in. */
  z.object({ type: z.literal("orbit"), logos: z.array(z.string()).min(4).max(12) }),
  /** Footage lifted out of its page: a region as a tilted window, with a highlight hopping down rows. */
  z.object({
    type: z.literal("proof"),
    flowId: z.string(),
    in: Seconds,
    out: Seconds,
    /** The region of the page to show, in CSS pixels. */
    frame: Rect,
    tilt: z.enum(["none", "soft", "strong"]),
    hops: z.array(Rect).max(8).optional(),
    ground: z.enum(["base", "field"]).optional(),
    /** v8: where the camera travels, seconds into the part: it eases from `frame` to each stop's region in turn. */
    path: z.array(z.object({ at: Seconds, frame: Rect })).max(6).optional(),
    /** v8: a headline over the window: art direction's call (word for word from the site or the script), or the shot's title by language in a headline skeleton. */
    headline: z.union([z.string().min(1).max(60), TextByLang]).optional(),
  }),
  /** The page at one moment, built piece by piece, with one piece lifted out to the middle. */
  z.object({
    type: z.literal("build"),
    flowId: z.string(),
    /** The source second to take the page from. */
    at: Seconds,
    items: z.array(Rect).min(2).max(24),
    reveal: z.enum(["rise", "wireframe"]),
    lift: Rect.optional(),
  }),
  /** A close-up of typing into a field, pulling back to the page around it. */
  z.object({
    type: z.literal("prompt"),
    flowId: z.string(),
    in: Seconds,
    out: Seconds,
    input: Rect,
    frame: Rect,
  }),
]);
export type Primitive = z.infer<typeof Primitive>;

export const PrimitiveSegment = z.object({
  kind: z.literal("primitive"),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  beatId: z.string().optional(),
  primitive: Primitive,
  seconds: Seconds,
  transitionIn: TransitionKind,
});
export type PrimitiveSegment = z.infer<typeof PrimitiveSegment>;

export const Segment = z.discriminatedUnion("kind", [
  ShotSegment,
  StatementSegment,
  MontageSegment,
  StatSegment,
  SceneSegment,
  PrimitiveSegment,
]);
export type Segment = z.infer<typeof Segment>;

export const Card = z.object({
  component: z.string(),
  props: z.record(z.string(), z.unknown()),
  seconds: Seconds,
});

/** v7: the title card and end card of a music-led film. */
export const OpenerProps = z.object({ line: TextByLang });
export const EndCardProps = z.object({ line: TextByLang });

export const EdlStyle = z.object({
  palette: z.object({
    bg: HexColor,
    fg: HexColor,
    accent: HexColor,
    surface: HexColor.optional(),
    accent2: HexColor.optional(),
    /** v8: the brand's colours from its imagery, for glows, discs and bars when its CSS has none. */
    colours: z.array(HexColor).max(4).optional(),
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
  /** v7: what sets the film's clock. Without it, the voice. */
  timing: z.enum(["voice", "music"]).optional(),
  /** 16:9 shots: browser window, tilted window, or full bleed. */
  frame: z.enum(["window", "tilt", "none"]),
  motion: MotionTokens,
  /** v8: the brand moves art direction chose (PRD §9.7.8): the logo's motion, the cursor, the ground. */
  brand: BrandMotion.optional(),
  /** v8: the brand's own objects (job-relative images, brand kit imagery) for the imagery ground. */
  imagery: z.array(z.object({ file: z.string(), colour: HexColor, round: z.boolean() })).max(6).optional(),
});
export type EdlStyle = z.infer<typeof EdlStyle>;

export const Edl = z.object({
  /** Each version is additive, so older edits still read. A music-led edit is 7, or 8 with a proof's camera path. */
  schemaVersion: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  fps: z.literal(30),
  style: EdlStyle,
  intro: Card,
  /** Playing order. */
  segments: z.array(Segment).min(1),
  outro: Card,
});
export type Edl = z.infer<typeof Edl>;
