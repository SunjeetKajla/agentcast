import type { Edl, MusicLibrary, MusicTrack, Personality } from "./compat";

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
  },
): MusicTrack | undefined {
  const tracks = library?.tracks ?? [];
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
