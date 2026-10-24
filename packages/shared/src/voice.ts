import { z } from "zod";
import { Lang, Seconds } from "./common.ts";

// voice/<lang>.json, the narration (PRD §9.5); clips at voice/<lang>/<beatId>.mp3

export const Word = z.object({
  text: z.string(),
  /** Seconds into the clip. */
  start: Seconds,
  end: Seconds,
});
export type Word = z.infer<typeof Word>;

export const VoiceClip = z.object({
  beatId: z.string(),
  /** Relative to the job dir. */
  file: z.string(),
  text: z.string(),
  seconds: Seconds,
  words: z.array(Word),
  model: z.string(),
  /** Hash of voice, model, spoken line and neighbours: reuse the clip when unchanged. */
  key: z.string(),
});
export type VoiceClip = z.infer<typeof VoiceClip>;

export const Voiceover = z.object({
  schemaVersion: z.literal(1),
  lang: Lang,
  voiceId: z.string(),
  voiceName: z.string(),
  clips: z.array(VoiceClip),
});
export type Voiceover = z.infer<typeof Voiceover>;
