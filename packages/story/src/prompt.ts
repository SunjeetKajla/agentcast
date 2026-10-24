import type { Personality, VideoMode } from "@agentcast/shared";
/**
 * Keywords → personality, from the skill's keyword table plus how people describe videos. Order
 * matters only for ties: the first archetype with the most hits wins.
 */
const KEYWORDS: Record<Personality, string[]> = {
  energetic: [
    "energetic",
    "punchy",
    "bold",
    "dynamic",
    "exciting",
    "hype",
    "hyped",
    "fast",
    "snappy",
    "product hunt",
    "tiktok",
    "reels",
    "viral",
    "upbeat",
  ],
  premium: [
    "premium",
    "elegant",
    "minimal",
    "luxury",
    "sophisticated",
    "calm",
    "cinematic",
    "keynote",
    "polished",
    "sleek",
    "slow",
    "refined",
  ],
  playful: [
    "playful",
    "fun",
    "whimsical",
    "bouncy",
    "cute",
    "friendly",
    "quirky",
    "cheerful",
    "casual",
  ],
  corporate: [
    "professional",
    "clean",
    "business",
    "enterprise",
    "corporate",
    "b2b",
    "serious",
    "formal",
    "trustworthy",
    "clear",
  ],
};

/** Default length and personality per video type when the prompt doesn't say. */
const DEFAULTS: Record<
  VideoMode,
  { seconds: number; personality: Personality }
> = {
  launch: { seconds: 60, personality: "energetic" },
  tutorial: { seconds: 90, personality: "corporate" },
  sales: { seconds: 75, personality: "corporate" },
};

/** What a prompt says outright. Pure, so the composer can read it back instantly. */
export type PromptReading = {
  targetSeconds: number;
  personality: Personality;
  tone: string[];
  audience?: string;
  /** Which values came from the prompt rather than the mode's defaults. */
  stated: { seconds: boolean; personality: boolean };
};

export function readPrompt(
  prompt: string | undefined,
  mode: VideoMode,
): PromptReading {
  const text = ` ${(prompt ?? "").toLowerCase()} `;
  const d = DEFAULTS[mode];

  let seconds: number | undefined;
  const s = /(\d{1,3})\s*(?:s|sec|secs|second|seconds)\b/.exec(text);
  const m =
    /\b(\d+(?:\.\d+)?|half an?|a|one)\s*(?:min|mins|minute|minutes)\b/.exec(
      text,
    );
  if (s) seconds = Number(s[1]);
  else if (m)
    seconds = Math.round(
      (m[1] === "a" || m[1] === "one"
        ? 1
        : m[1]!.startsWith("half")
          ? 0.5
          : Number(m[1])) * 60,
    );
  // "Under a minute" means a bit less than one: aim for about 90%, in 5 s steps.
  const match = s ?? m;
  if (
    seconds !== undefined &&
    match &&
    /\b(under|less than|below|at most|max(?:imum)?|no more than|within)\s*$/.test(
      text.slice(0, match.index),
    )
  )
    seconds = Math.floor((seconds * 0.9) / 5) * 5;
  if (seconds !== undefined) seconds = Math.min(180, Math.max(15, seconds));

  const aud =
    /\bfor ([a-z][a-z0-9 &'-]{2,40}?)(?=[,.;!]|\s+(?:with|that|who|in|on|and)\b|\s*$)/.exec(
      text.trim(),
    );
  const audience =
    aud &&
    !/^\d/.test(aud[1]!) &&
    !/^(a |an |the )?(launch|product hunt|demo|video)\b/.test(aud[1]!)
      ? aud[1]!.trim()
      : undefined;
  // The audience ("for enterprise buyers") says who it's for, not how it should feel.
  const styleText = audience ? text.replace(`for ${audience}`, " ") : text;

  const hits = (Object.keys(KEYWORDS) as Personality[]).map((p) => ({
    p,
    words: KEYWORDS[p].filter((k) => new RegExp(`\\b${k}\\b`).test(styleText)),
  }));
  const best = hits.reduce((a, b) => (b.words.length > a.words.length ? b : a));
  const tone = hits.flatMap((h) => h.words).slice(0, 3);

  return {
    targetSeconds: seconds ?? d.seconds,
    personality: best.words.length ? best.p : d.personality,
    tone,
    ...(audience ? { audience } : {}),
    stated: {
      seconds: seconds !== undefined,
      personality: best.words.length > 0,
    },
  };
}

const MODE_NOUN: Record<VideoMode, string> = {
  launch: "launch video",
  tutorial: "how-to video",
  sales: "sales demo",
};
const PERSONALITY_ADJ: Record<Personality, string> = {
  playful: "playful",
  premium: "calm, premium",
  corporate: "clear, professional",
  energetic: "energetic",
};

/** "A 60 s energetic launch video for developers." */
export function describeReading(r: PromptReading, mode: VideoMode): string {
  const article = /^[aeiou]/.test(PERSONALITY_ADJ[r.personality]) ? "An" : "A";
  return `${article} ${PERSONALITY_ADJ[r.personality]} ${MODE_NOUN[mode]}, about ${r.targetSeconds} s${r.audience ? `, for ${r.audience}` : ""}.`;
}

export const wordBudget = (seconds: number, lang: string, tutorial = false) =>
  Math.max(
    3,
    Math.floor(
      seconds *
        ({ en: 2.8, hi: 2.55 }[lang.split("-")[0]!] ?? 2.6) *
        (tutorial ? 0.85 : 1),
    ),
  );
