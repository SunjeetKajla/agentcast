import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MusicLibrary as MusicLibrarySchema } from "@agentcast/shared";
import { BED_LUFS, DUCK_DB } from "./audio.ts";
import type { Edl, MusicLibrary, MusicTrack, Personality } from "./compat";

/** The music library folder: assets/music/ in the repo, or AGENTCAST_MUSIC_DIR. */
export const musicDir = () => process.env.AGENTCAST_MUSIC_DIR ?? fileURLToPath(new URL("../../../assets/music/", import.meta.url));

/** assets/music/tags.json, validated; undefined when there's no library. */
export async function loadMusicLibrary(dir = musicDir()): Promise<MusicLibrary | undefined> {
  const text = await readFile(`${dir.replace(/\/$/, "")}/tags.json`, "utf8").catch(() => undefined);
  return text ? MusicLibrarySchema.parse(JSON.parse(text)) : undefined;
}

/**
 * `style.music` for a picked track: its own gain brings it to the grammar's bed level (tracks differ
 * by 10 dB or more), kept under −1 dBTP.
 */
export function musicStyle(track: MusicTrack, edit: Edl["style"]["edit"]): Edl["style"]["music"] {
  const gainDb = Math.round(Math.min(BED_LUFS[edit] - track.lufs, -1 - track.truePeak) * 10) / 10;
  return { mood: track.mood[0] ?? "none", trackId: track.id, bpm: track.bpm, firstBeat: track.firstBeat, gainDb, duckDb: DUCK_DB };
}

/** Moods that suit each motion personality, best first. */
const MOODS: Record<Personality, string[]> = {
  premium: ["cinematic", "elegant", "inspiring", "calm", "ambient", "minimal"],
  corporate: ["corporate", "uplifting", "tech", "inspiring", "positive"],
  playful: ["playful", "fun", "happy", "bright", "upbeat", "quirky"],
  energetic: ["energetic", "upbeat", "electronic", "driving", "sport", "hype"],
};

/** How driving the track should be: up front in a trailer, a quiet bed under a guide. */
const ENERGY: Record<Edl["style"]["edit"], Record<Personality, number>> = {
  trailer: { premium: 3, corporate: 3, playful: 4, energetic: 5 },
  guide: { premium: 2, corporate: 2, playful: 2, energetic: 3 },
};

const hash = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * The music bed for a video (PRD §9.7.2): the library's track whose moods best fit the
 * personality, closest in energy to the grammar, preferring tracks long enough not to loop. Ties
 * go by `seed` (the job id), so different jobs don't all get the same track. Undefined when the
 * library is empty.
 */
export function pickTrack(
  library: MusicLibrary | undefined,
  o: {
    personality: Personality;
    edit: Edl["style"]["edit"];
    seconds: number;
    seed: string;
    /** A music-led edit needs a grid it can trust. */
    led?: boolean;
  },
): MusicTrack | undefined {
  const tracks = (library?.tracks ?? []).filter((t) => !o.led || t.analysis.confidence !== "low");
  if (!tracks.length) return undefined;
  const wanted = MOODS[o.personality];
  const energy = ENERGY[o.edit][o.personality];
  const score = (t: MusicTrack) => {
    const moods = t.mood.map((m) => m.toLowerCase());
    const fit = wanted.reduce(
      (s, m, i) =>
        s + (moods.includes(m) ? (wanted.length - i) / wanted.length : 0),
      0,
    );
    return (
      fit * 2 -
      Math.abs(t.energy - energy) * 0.8 +
      (t.seconds >= o.seconds ? 0.5 : 0) +
      ((hash(o.seed + t.id) % 100) / 100) * 0.3
    );
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}
