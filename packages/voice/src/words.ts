import type { Alignment } from "./client";

/** A spoken word with its timing in the clip (seconds). Punctuation stays attached, as captions show it. */
export type Word = { text: string; start: number; end: number };

/**
 * Character timings → words: split on whitespace, each word spanning from its first character's
 * start to its last character's end. Works for Devanagari too, where vowel signs and viramas are
 * their own characters but never whitespace.
 */
export function alignmentToWords(a: Alignment): Word[] {
  const words: Word[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text)
      words.push({
        text,
        start: round(start),
        end: round(Math.max(end, start)),
      });
    text = "";
  };
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) return flush();
    if (!text) start = a.character_start_times_seconds[i] ?? end;
    text += ch;
    end = a.character_end_times_seconds[i] ?? end;
  });
  flush();
  return words;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The line as the voice should read it: identifiers like performance_glitch_user as words, not
 * "performance underscore glitch…". Each change keeps the length, so the timings of what was spoken
 * map back onto the line as written (withText), and captions still show the identifier.
 */
export const spokenForm = (text: string) =>
  text.replace(/(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}])/gu, " ");

/** The alignment of a spoken form, relabelled with the line as written (same length; otherwise unchanged). */
export const withText = (a: Alignment, text: string): Alignment => {
  const chars = [...text];
  return chars.length === a.characters.length ? { ...a, characters: chars } : a;
};

export type AlignmentCheck = {
  ok: boolean;
  problems: string[];
  /** Spoken words per second, from the first word's start to the last word's end. */
  wordsPerSecond: number;
  /** Longest silence between two words. */
  longestGap: number;
};

/**
 * Sanity checks for a clip's timings (spike S5's bar): every word of the text is there, times only
 * move forward, nothing is zero-length or longer than a few seconds, and the last word ends inside
 * the audio.
 */
export function checkAlignment(
  text: string,
  words: Word[],
  audioSeconds?: number,
): AlignmentCheck {
  const problems: string[] = [];
  const expected = text.split(/\s+/).filter(Boolean).length;
  if (words.length !== expected)
    problems.push(`${words.length} timed words for ${expected} in the text`);
  if (
    words
      .map((word) => word.text)
      .join(" ")
      .normalize("NFC") !== text.trim().replace(/\s+/g, " ").normalize("NFC")
  )
    problems.push("Timed words do not match the approved text");
  let longestGap = 0;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0)
      problems.push("Invalid or negative word timing");
    if (prev && w.start < prev.start)
      problems.push(`"${w.text}" starts before "${prev.text}"`);
    if (prev) longestGap = Math.max(longestGap, w.start - prev.end);
    if (w.end - w.start <= 0) problems.push(`"${w.text}" has no duration`);
    if (w.end - w.start > 3)
      problems.push(`"${w.text}" lasts ${(w.end - w.start).toFixed(1)} s`);
  });
  const last = words.at(-1);
  if (audioSeconds !== undefined && last && last.end > audioSeconds + 0.15)
    problems.push(
      `last word ends at ${last.end} s, after the audio (${audioSeconds.toFixed(2)} s)`,
    );
  const span = last && words[0] ? last.end - words[0].start : 0;
  return {
    ok: problems.length === 0,
    problems,
    wordsPerSecond:
      span > 0 ? Math.round((words.length / span) * 100) / 100 : 0,
    longestGap: Math.round(longestGap * 1000) / 1000,
  };
}

/** Character error rate between what was meant and what a transcriber heard (punctuation and case ignored). */
export function charErrorRate(expected: string, heard: string): number {
  const norm = (s: string) =>
    s
      .normalize("NFC")
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const a = [...norm(expected)];
  const b = [...norm(heard)];
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return Math.round((prev[b.length]! / a.length) * 1000) / 1000;
}
