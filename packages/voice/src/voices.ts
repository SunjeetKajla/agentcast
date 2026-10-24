import type { ElevenLabs } from "./client";

/** Premade voices every plan can use through the API (spike S5): Bella for English, Brian for Hindi. */
export const PREMADE: Record<string, { id: string; name: string }> = {
  en: { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella" },
  hi: { id: "nPczCjzI2devNBz1zQrb", name: "Brian" },
};

/** Free plans can only use premade voices and the account's own (cloned, designed) through the API; library voices answer 402. */
export const usableOnPlan = (tier: string, category: string) =>
  tier !== "free" || ["premade", "cloned", "generated"].includes(category);

export type PickedVoice = {
  id: string;
  name: string;
  category: string;
  /** Why the configured voice wasn't used. */ fellBack?: string;
};

/**
 * The voice for a language: the configured one when the plan can use it, otherwise the premade
 * default. Two free calls at most; the key and the plan never change mid-job.
 */
export async function pickVoice(
  el: ElevenLabs,
  lang: string,
  configured: string | undefined,
  tier: string,
  signal?: AbortSignal,
): Promise<PickedVoice> {
  const fallback = PREMADE[lang.split("-")[0]!] ?? PREMADE.en!;
  if (configured) {
    try {
      const v = await el.voice(configured, signal);
      if (usableOnPlan(tier, v.category))
        return { id: configured, name: v.name, category: v.category };
      return {
        id: fallback.id,
        name: fallback.name,
        category: "premade",
        fellBack: `"${v.name}" is a ${v.category} voice, which the ${tier} plan can't use through the API`,
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      return {
        id: fallback.id,
        name: fallback.name,
        category: "premade",
        fellBack: `voice ${configured} wasn't found (${(err as Error).message.slice(0, 120)})`,
      };
    }
  }
  return {
    id: fallback.id,
    name: fallback.name,
    category: "premade",
    fellBack: "no voice is configured for this language",
  };
}
