import type { Brand, Edl, Personality } from "@agentcast/shared";

// The video's layouts, chosen from the product's brand kit (PRD §9.7.3).

export type Look = Edl["style"]["look"];

/** AgentCast's own look, for a product without a brand kit. */
export const DEFAULT_LOOK: Look = {
  theme: "dark",
  title: "center",
  statement: "center",
  backdrop: "glow",
  chrome: "browser",
  radius: 16,
};

/** Layouts that suit each personality, best first. */
const TITLES: Record<Personality, Look["title"][]> = {
  premium: ["editorial", "split", "wordmark"],
  corporate: ["split", "editorial", "center"],
  playful: ["center", "wordmark"],
  energetic: ["wordmark", "center", "split"],
};
const STATEMENTS: Record<Personality, Look["statement"][]> = {
  premium: ["editorial", "outline"],
  corporate: ["editorial", "center"],
  playful: ["panel", "center"],
  energetic: ["panel", "outline"],
};

/** A small stable hash, so the same site always gets the same choices. */
const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 17);

/**
 * The look for a brand: its own theme; its corner radius at 1080p (pill buttons get round windows,
 * sharp brands stay sharp and get a bare frame); title and headline layouts the personality suits,
 * picked by `seed` (the site) so two products rarely match (`split` needs the hero screenshot, a
 * `wordmark` title a name that reads as one); and a backdrop from what the brand has: its gradient as
 * a mesh, its hero blurred, or its plain colour. A greyscale brand never gets a colour mesh.
 */
export function chooseLook(brand: Brand | undefined, personality: Personality, seed: string): Look {
  if (!brand) return DEFAULT_LOOK;
  const n = hash(seed);
  const pick = <T>(options: T[], salt: number) => options[(n + salt) % options.length]!;
  const greyscale = brand.accentFrom === "text";
  const titles = TITLES[personality].filter((t) => t !== "split" || brand.hero);
  let backdrop: Look["backdrop"];
  if (brand.gradient?.length && !greyscale) backdrop = "mesh";
  else if (brand.hero && (personality === "corporate" || personality === "premium")) backdrop = "hero";
  else if (!greyscale && (personality === "playful" || personality === "energetic")) backdrop = "mesh";
  else backdrop = pick(brand.theme === "dark" ? ["glow", "solid"] : ["solid", "glow"], 2);
  return {
    theme: brand.theme,
    title: pick(titles.length ? titles : ["center"], 0),
    statement: pick(STATEMENTS[personality], 1),
    backdrop,
    chrome: brand.radius <= 4 ? "minimal" : "browser",
    radius: brand.radius >= 999 ? 26 : Math.min(28, Math.round(brand.radius * 1.4)),
  };
}
