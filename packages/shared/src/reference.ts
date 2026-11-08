import { z } from "zod";
import { Rect, Seconds } from "./common.ts";

// The reference library (assets/references/skeletons.json) and the beat sheet a music-led film is
// planned on (PRD §9.7.7). A skeleton is a film's structure learned from the reference films, in terms
// of our motion primitives: no footage, no frames, no one film's moves copied whole.

/** What a product's recorded page mostly is, which decides the skeletons that suit it. */
export const ProductShape = z.enum(["board", "list", "prompt", "panel", "page"]);
export type ProductShape = z.infer<typeof ProductShape>;

export const FilmSkeleton = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string(),
  /** One line for people: what the film feels like. */
  feel: z.string(),
  /** The films it's learned from (docs/LAUNCH_FILM_TEARDOWN.md) and what was taken from each. */
  learnedFrom: z.array(z.object({ film: z.string(), took: z.string() })).min(1),
  /** The product shapes it suits; empty suits any. */
  suits: z.array(ProductShape),
  /** Beats the opener's line takes. */
  openerBeats: z.number().int().min(4).max(16),
  /** The middle of the film: one module per shot, a label and then its proof. */
  module: z.object({
    /** 0: no label, the proofs cut straight into each other. */
    labelBeats: z.number().int().min(0).max(4),
    proofBeats: z.number().int().min(2).max(32),
    /** A second proof from another region of the same shot, cut straight after the first. */
    proofsPerShot: z.number().int().min(1).max(2),
    maxModules: z.number().int().min(1).max(10),
    /** `path`: the camera travels across the page's regions on the beat instead of holding one. */
    camera: z.enum(["hold", "path"]),
  }),
  /** Each module's look, cycled from a point the brand's seed picks, so two brands don't match. */
  look: z.object({
    labelOpen: z.array(z.enum(["rise", "slit", "iris"])).min(1),
    grounds: z.array(z.enum(["base", "invert", "field"])).min(1),
    tilts: z.array(z.enum(["none", "soft", "strong"])).min(1),
    /** The whole frame inverts once, on the label nearest the film's middle (with three modules or more). */
    flipMiddle: z.boolean(),
  }),
  /** The product's terms riding a rule before the end card, when there's room. */
  ticker: z.boolean(),
  endBeats: z.number().int().min(4).max(16),
  /** The reference films' numbers for this structure, for the film lint. */
  target: z.object({
    changesPer10s: z.tuple([z.number(), z.number()]),
    stillPct: z.number().min(0).max(100),
  }),
});
export type FilmSkeleton = z.infer<typeof FilmSkeleton>;

export const ReferenceLibrary = z.object({
  schemaVersion: z.literal(1),
  skeletons: z.array(FilmSkeleton).min(1),
});
export type ReferenceLibrary = z.infer<typeof ReferenceLibrary>;

/**
 * script/beat-sheet.json: a music-led film planned bar by bar before it's built. Made with the
 * script, so a shot with too little on screen is dropped where a person can see it, not after review.
 */
export const BeatSheet = z.object({
  schemaVersion: z.literal(1),
  skeletonId: z.string(),
  /** The film in one sentence. */
  thesis: z.string(),
  trackId: z.string().optional(),
  bpm: z.number().positive(),
  beat: Seconds,
  bar: Seconds,
  seconds: Seconds,
  beats: z.array(
    z.object({
      /** The EDL part: "intro", "outro" or a segment id. */
      id: z.string(),
      at: Seconds,
      seconds: Seconds,
      /** Bars it covers, counted from 1: [first, last]. */
      bars: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
      move: z.string(),
      /** The words on screen, in the first language. */
      copy: z.string().optional(),
      /** The storyboard beat it shows. */
      beatId: z.string().optional(),
      /** What it shows of the recording. */
      source: z.object({ flowId: z.string(), from: Seconds, to: Seconds, frame: Rect.optional() }).optional(),
    }),
  ),
  /** Storyboard shots left out, and why. */
  dropped: z.array(z.object({ beatId: z.string(), title: z.string().optional(), reason: z.string() })),
});
export type BeatSheet = z.infer<typeof BeatSheet>;
