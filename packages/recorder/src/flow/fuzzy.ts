import type { SemanticLocator } from "./semantic.ts";
import { isAriaRole } from "./semantic.ts";

export function normalizeTarget(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/** Conservative typo tolerance: short names and differing numeric identifiers never approximate. */
export function textSimilarity(query: string, candidate: string): number {
  const a = normalizeTarget(query),
    b = normalizeTarget(candidate);
  if (!a || !b) return 0;
  if (
    JSON.stringify(query.match(/\d+/g) ?? []) !==
    JSON.stringify(candidate.match(/\d+/g) ?? [])
  )
    return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 6 || Math.max(a.length, b.length) > 256)
    return 0;
  if (Math.abs(a.length - b.length) > 2) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious: number[] | undefined;
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (
        beforePrevious &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      )
        cost = Math.min(cost, beforePrevious[j - 2]! + 1);
      next.push(cost);
    }
    beforePrevious = row;
    row = next;
  }
  const distance = row[b.length]!;
  const score = 1 - distance / Math.max(a.length, b.length);
  return distance <= 2 && score >= 0.88 ? score : 0;
}

/** ARIA snapshots supply computed accessible names (including aria-labelledby and shadow DOM). */
export function snapshotCandidates(snapshot: string): SemanticLocator[] {
  const output: SemanticLocator[] = [];
  for (const match of snapshot
    .slice(0, 128_000)
    .matchAll(/^\s*-\s+([a-z]+)\s+("(?:\\.|[^"\\])*")/gm)) {
    if (!isAriaRole(match[1]!)) continue;
    try {
      const name = JSON.parse(match[2]!) as string;
      if (name && name.length <= 512)
        output.push({ kind: "role", role: match[1]!, name });
      if (output.length >= 500) break;
    } catch {
      /* Malformed page text is not a locator. */
    }
  }
  return output;
}

export function rankFuzzy(
  query: string,
  candidates: SemanticLocator[],
): { spec: SemanticLocator; score: number }[] {
  const unique = new Map<string, SemanticLocator>();
  for (const candidate of candidates)
    unique.set(JSON.stringify(candidate), candidate);
  return [...unique.values()]
    .map((spec) => ({ spec, score: textSimilarity(query, spec.name) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}
