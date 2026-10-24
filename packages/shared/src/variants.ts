import type { Aspect, FormFactor, Lang } from "./common.ts";
import type { JobConfig } from "./job.ts";

// The variant matrix (PRD §9.8, plan Phase 6 task 4): aspect × language × footage source.

export type Variant = {
  /** File stem in out/: "16x9-en", or "9x16-en-mobile" for native mobile footage. */
  id: string;
  aspect: Aspect;
  lang: Lang;
  /** Which recording it's cut from. 9:16 from desktop footage is reframed by the virtual camera. */
  source: FormFactor;
};

/**
 * Desktop footage serves every aspect; mobile footage serves 9:16 only.
 * Without desktop footage, 16:9 variants are dropped (a phone screen doesn't fill a 16:9 frame).
 */
export function variantMatrix(variants: JobConfig["variants"]): Variant[] {
  const out = new Map<string, Variant>();
  for (const lang of variants.langs) {
    for (const aspect of variants.aspects) {
      if (variants.formFactors.includes("desktop")) {
        const id = `${aspect}-${lang}`;
        out.set(id, { id, aspect, lang, source: "desktop" });
      }
      if (aspect === "9x16" && variants.formFactors.includes("mobile")) {
        const id = `${aspect}-${lang}-mobile`;
        out.set(id, { id, aspect, lang, source: "mobile" });
      }
    }
  }
  return [...out.values()];
}
