import { z } from "zod";
import { Rect, Seconds } from "./common.ts";

// Brand motion (docs/BRAND_MOTION_PLAN.md, PRD §9.7.8): the brand kit and the layers captured for a job, what
// they add up to, and the art direction chosen from them.

/** A horizontal span of the logo, as shares of its width: [from, to]. */
export const Span = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export type Span = z.infer<typeof Span>;

/** brief/brand-kit.json: what the brand gives the film beyond its colours and fonts. */
export const BrandKit = z.object({
  schemaVersion: z.literal(1),
  logo: z
    .object({
      /** The 4× capture (brief/logo.png), always there. */
      png: z.string(),
      /** brief/logo.svg: the vector, cleaned to shapes and gradients, when the site had one. */
      svg: z.string().optional(),
      /** brief/logo-cut.png: the capture with the background it sat on keyed out, for a raster logo. */
      cut: z.string().optional(),
      /** "mark+wordmark": a symbol then a name; "wordmark": letters only; "mark": a symbol only. */
      kind: z.enum(["mark+wordmark", "wordmark", "mark"]),
      /** The symbol's span, when there is one. */
      mark: Span.optional(),
      /** The wordmark's letters, left to right; letters that touch come out as one. */
      letters: z.array(Span),
    })
    .optional(),
  /** Viewport captures of the site's own pages (brief/captures/NN.jpg), for walls and mockup screens. */
  captures: z.array(z.object({ file: z.string(), url: z.url() })),
  /** Other companies' logos in a row on the site (brief/logos/NN.png): integrations or customers. Used only with consent. */
  cloud: z.array(z.object({ file: z.string(), kind: z.enum(["integrations", "customers", "unknown"]) })).default([]),
  /**
   * The brand's own objects (an orb, an illustration, a product render) cut out of its pages and its recording
   * (brief/imagery/*.png), the biggest first. A brand whose CSS is black and white often keeps its colour here.
   */
  imagery: z
    .array(
      z.object({
        file: z.string(),
        /** The cut-out's size in its source's own pixels: how far it can be enlarged. */
        w: z.number().positive(),
        h: z.number().positive(),
        colour: z.string().regex(/^#[0-9a-f]{6}$/i),
        round: z.boolean(),
        from: z.enum(["page", "recording"]),
      }),
    )
    .default([]),
  /** The brand's colours read from its imagery (glows included), the strongest first; empty for a brand with none. */
  colours: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(4).default([]),
});
export type BrandKit = z.infer<typeof BrandKit>;

/** render/layers.json: pieces of the recording cut out as their own images, from the element map. */
export const LayerList = z.object({
  schemaVersion: z.literal(1),
  layers: z.array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9-]*$/),
      kind: z.enum(["panel", "component", "card", "column", "row"]),
      /** render/layers/<id>.png, cut from the recording at `t`. */
      file: z.string(),
      flowId: z.string(),
      t: Seconds,
      /** Where it was on the page, in the recording's CSS pixels. */
      box: Rect,
      /** Source pixels per CSS pixel: how far it can be enlarged before it goes soft. */
      density: z.number().positive(),
    }),
  ),
});
export type LayerList = z.infer<typeof LayerList>;

export const ProductType = z.enum([
  "project-tool",
  "ai-prompt",
  "voice-audio",
  "design-canvas",
  "dev-tool",
  "data-analytics",
  "commerce",
  "fintech",
  "consumer-app",
  "suite",
  "other",
]);
export type ProductType = z.infer<typeof ProductType>;

/** The moves a film can be built around. Some aren't in the compiler yet; `MOVES_BUILT` says which are. */
export const Move = z.enum(["prompt", "build", "cards", "panel", "list", "ticker", "swap", "wall", "glow-pill", "mockup", "output", "orbit", "mascot"]);
export type Move = z.infer<typeof Move>;
export const MOVES_BUILT: readonly Move[] = ["prompt", "build", "cards", "panel", "list", "ticker", "swap", "wall", "glow-pill", "mockup", "output", "orbit"];

/** record/outputs.json: what the product made while it was recorded (a voice product's speech), kept from the recording session. */
export const ProductOutputs = z.object({
  schemaVersion: z.literal(1),
  outputs: z.array(
    z.object({
      /** record/output/NN.<ext>. */
      file: z.string(),
      kind: z.enum(["audio"]),
      /** The MIME type it arrived with. */
      type: z.string(),
      flowId: z.string(),
      /** Recording second it arrived at. */
      t: Seconds,
    }),
  ),
});
export type ProductOutputs = z.infer<typeof ProductOutputs>;
/** Recorder's per-flow index, before the worker moves times onto the joined recording. */
export const FlowAudioFiles = z.array(ProductOutputs.shape.outputs.element.omit({ kind: true, flowId: true }));

/** The film's brand settings, carried in the EDL's style so every variant draws them. */
export const BrandMotion = z.object({
  /** How the logo arrives on the end card (and the opener, when it leads with the logo). */
  logo: z.enum(["lockup", "letters", "fade"]),
  /** A cursor gliding to each recorded click, pressing as a pointing hand. */
  cursor: z.enum(["hand", "none"]),
  /**
   * The ground under the moves: plain, a bloom of light in the brand's colour, the brand's colour field, or the
   * brand's own objects drifting through every scene (moved on each cut, ringing the end card).
   */
  world: z.enum(["plain", "bloom", "field", "imagery"]),
  /** How the film opens: with its line a phrase at a time, or with the logo revealing, then the line. */
  opener: z.enum(["line", "logo"]).default("line"),
});
export type BrandMotion = z.infer<typeof BrandMotion>;

/** What a job has to build a film from (PRD §9.7.8 "B"). Computed, never written by an LLM. */
export type Inventory = {
  typing: boolean;
  board: boolean;
  list: boolean;
  panel: boolean;
  cards: boolean;
  /** Recorded clicks with a target box: where a cursor can go. */
  clicks: number;
  captures: number;
  logo: "vector" | "raster" | "none";
  logoKind?: "mark+wordmark" | "wordmark" | "mark";
  hero: boolean;
  theme: "light" | "dark";
  colourful: boolean;
  /** Source pixels per CSS pixel of the recording. */
  density: number;
  /** Layers cut from the recording, by kind. */
  layers: Record<string, number>;
  /** Product outputs kept from the recording (audio). */
  outputs: number;
  /** Other companies' logos usable in the film: 0 unless the person allowed them. */
  cloud: number;
  /** The brand's own objects cut out (brand kit imagery). */
  imagery: number;
};

/** One shot's art direction call. */
export const ShotCall = z.object({
  crop: z.enum(["acted", "focus", "page"]).optional(),
  headline: z.string().min(1).max(60).optional(),
});
export type ShotCall = z.infer<typeof ShotCall>;

/** brief/art-direction.json: the design chosen for this film, with a reason for each choice. */
export const ArtDirection = z.object({
  schemaVersion: z.literal(1),
  productType: ProductType,
  skeletonId: z.string(),
  brand: BrandMotion,
  /** The two or three moves the film is built around, in order of preference. */
  featured: z.array(Move).max(3),
  avoid: z.array(Move),
  /** One line per choice: productType, skeleton, logo, cursor, world, featured. */
  reasons: z.record(z.string(), z.string()),
  /** Who chose: the director's turn, or the rules table when it's off or failed. */
  by: z.enum(["director", "rules"]),
  /** Choices the worker had to change because the assets or the compiler couldn't back them. */
  changed: z.array(z.string()),
  /**
   * Calls for single shots, by storyboard beat id: how to frame the recording ("acted": just where things were
   * clicked and typed; "focus": the busiest part of the page; "page": all of it) and a headline over it, taken word
   * for word from the site's text or the script.
   */
  shots: z.record(z.string(), ShotCall).default({}),
});
export type ArtDirection = z.infer<typeof ArtDirection>;
