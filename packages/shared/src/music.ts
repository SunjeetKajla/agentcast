import { z } from "zod";
import { Seconds } from "./common.ts";

// assets/music/tags.json, the music library (PRD §9.7.2). Audio files aren't committed.

export const MusicTrack = z.object({
  id: z.string(),
  file: z.string(),
  title: z.string(),
  artist: z.string().optional(),
  source: z.url(),
  /** Required: no unlicensed music. */
  license: z.string().min(1),
  mood: z.array(z.string()),
  energy: z.number().int().min(1).max(5),
  bpm: z.number().positive(),
  firstBeat: Seconds,
  seconds: Seconds,
  /** v2: integrated loudness and true peak, so every track sits at the same level in the mix. */
  lufs: z.number(),
  truePeak: z.number(),
  /** v3: `firstBeat` and `bpm` are a constant-tempo grid whose bars start at `firstBeat`. */
  analysis: z.object({
    /** How well the track's beats fit that grid. A low-confidence track can't drive a music-led edit. */
    confidence: z.enum(["high", "medium", "low"]),
    /** Bar starts where the music is already strong, to enter at. */
    entries: z.array(Seconds).min(1),
    /** Where the track's own ending has died away. */
    tailEnd: Seconds,
  }),
});
export type MusicTrack = z.infer<typeof MusicTrack>;

export const MusicLibrary = z.object({
  schemaVersion: z.literal(3),
  tracks: z.array(MusicTrack),
});
export type MusicLibrary = z.infer<typeof MusicLibrary>;

/** render/music-plan.json: the music as a music-led film plays it, joined on bar lines. */
export const MusicPlan = z.object({
  schemaVersion: z.literal(1),
  trackId: z.string(),
  bpm: z.number().positive(),
  /** Seconds a beat and a bar last. The film's grid starts at 0. */
  beat: Seconds,
  bar: Seconds,
  seconds: Seconds,
  /** Stretches of the track in playing order: where each starts in the film and in the file. */
  spans: z.array(z.object({ at: Seconds, mediaStart: Seconds, seconds: Seconds })).min(1),
});
export type MusicPlan = z.infer<typeof MusicPlan>;

export const SoundKind = z.enum([
  "whoosh",
  "click",
  "pop",
  "riser",
  "hit",
  "tick",
]);
export type SoundKind = z.infer<typeof SoundKind>;

/** assets/sfx/tags.json, the sound effect pack. Kinds it doesn't cover use the generated fallbacks. */
export const SfxPack = z.object({
  schemaVersion: z.literal(1),
  sounds: z.array(
    z.object({
      kind: SoundKind,
      file: z.string(),
      source: z.url(),
      /** Required: no unlicensed sounds. */
      license: z.string().min(1),
    }),
  ),
});
export type SfxPack = z.infer<typeof SfxPack>;
