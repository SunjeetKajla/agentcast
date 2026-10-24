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
});
export type MusicTrack = z.infer<typeof MusicTrack>;

export const MusicLibrary = z.object({
  schemaVersion: z.literal(1),
  tracks: z.array(MusicTrack),
});
export type MusicLibrary = z.infer<typeof MusicLibrary>;
