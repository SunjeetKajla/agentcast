import type { ProductBrief } from "@agentcast/shared";

// The copy lint for a music-led film's on-screen words: three of genjutsu's four checks (MIT,
// https://genjutsu.athevon.dev), turned from interface copy to film copy. Decorative filler, the fourth,
// is about the picture and stays a manual read.
//   Hollow copy: is the line true of this product and of no other?
//   Invented information: does every number come from the product?
//   Reflex convergence: did the idea choose this construction, or habit?

/** Stock launch phrases: they'd fit any product, so they say nothing about this one. English only. */
const STOCK = [
  "ship faster",
  "build faster",
  "move faster",
  "work smarter",
  "with momentum",
  "next level",
  "next-level",
  "supercharge",
  "seamless",
  "unlock",
  "revolutioni",
  "game changer",
  "game-changer",
  "all-in-one",
  "effortless",
  "like never before",
  "the future of",
  "made simple",
  "cutting-edge",
  "world-class",
  "best-in-class",
  "streamline",
  "get started",
  "level up",
  "reimagine",
];

/** The film's words as the lint reads them: the opening, each on-screen text and the closing line. */
export type FilmCopy = { titleCard: string; hook: string; cta: string; onScreen: string[] };

/** What the copy lint finds, each a sentence to send back to the writer. */
export function copyIssues(copy: FilmCopy, lang: string, product?: Pick<ProductBrief, "name" | "oneLiner" | "valueProps" | "keyTerms">): string[] {
  const issues: string[] = [];
  const lines = [copy.titleCard, copy.hook, ...copy.onScreen, copy.cta].filter((l) => l.trim());
  if (lang === "en")
    for (const line of new Set(lines)) {
      const stock = STOCK.find((s) => line.toLowerCase().includes(s));
      if (stock) issues.push(`"${line}" is a stock phrase ("${stock}") that fits any product: say what is true of this one and no other`);
    }
  if (product) {
    const known = [product.name, product.oneLiner, ...product.valueProps, ...product.keyTerms].join(" ");
    for (const line of new Set(lines))
      for (const n of line.match(/\d[\d.,]*\s*[%x×kKmMbB+]?/g) ?? [])
        if (!known.includes(n.replace(/\s+/g, "").replace(/[%x×kKmMbB+]$/, "").replace(/[.,]$/, "")))
          issues.push(`"${line}" says ${n.trim()}, which the product brief doesn't: use only numbers the product states`);
  }
  // The same opening word on three or more lines reads as a formula, not an idea.
  const openings = new Map<string, number>();
  for (const line of copy.onScreen) {
    const word = line.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (word) openings.set(word, (openings.get(word) ?? 0) + 1);
  }
  for (const [word, n] of openings) if (n >= 3) issues.push(`${n} on-screen lines open with "${word}": vary them, so each reads as its own idea`);
  return issues;
}
