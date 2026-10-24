import type { Edl, Script, Storyboard } from "@agentcast/shared";
import { beatParts, type Caption, type Part, type PlacedClip } from "./plan.ts";

// Caption lines: from the voice's word timings when there is a voice, else from the script.

const MAX_WORDS = 7;
const MAX_CHARS = 42;

/** Splits words into short caption lines, breaking after a sentence ends or when a line is full. */
function lines<W extends { text: string }>(words: W[]): W[][] {
  const out: W[][] = [];
  let line: W[] = [];
  for (const w of words) {
    const length = [...line, w].map((x) => x.text).join(" ").length;
    if (line.length && (line.length >= MAX_WORDS || length > MAX_CHARS)) {
      out.push(line);
      line = [];
    }
    line.push(w);
    if (/[.!?…।]["')\]]*$/.test(w.text)) {
      out.push(line);
      line = [];
    }
  }
  if (line.length) out.push(line);
  return out;
}

/** Captions that follow the voice word by word (karaoke), one short line at a time. */
export function voiceCaptions(clips: PlacedClip[]): Caption[] {
  const out: Caption[] = [];
  for (const clip of clips)
    for (const words of lines(clip.words)) {
      out.push({
        text: words.map((w) => w.text).join(" "),
        start: words[0]!.start,
        end: words.at(-1)!.end + 0.3,
        words,
      });
    }
  // A line stays until the next one starts, never over it.
  return out.map((c, i) => ({ ...c, end: Math.min(c.end, out[i + 1]?.start ?? c.end) }));
}

/** Without a voice: each beat's script line, spread evenly over its part once the part has arrived. */
export function scriptCaptions(parts: Part[], edl: Edl, storyboard: Storyboard, script: Script): Caption[] {
  const where = beatParts(storyboard, edl);
  const fps = edl.fps;
  const out: Caption[] = [];
  for (const part of parts) {
    const text = storyboard.beats
      .filter((b) => where.get(b.id) === part.id)
      .map((b) => script.segments.find((s) => s.beatId === b.id)?.text ?? "")
      .join(" ")
      .trim();
    if (!text) continue;
    const chunks = lines(text.split(/\s+/).map((w) => ({ text: w })));
    const start = (part.from + part.enter.frames) / fps + 0.2;
    const length = (part.from + part.frames - part.exit.frames) / fps - 0.2 - start;
    chunks.forEach((words, i) => {
      out.push({
        text: words.map((w) => w.text).join(" "),
        start: start + (length * i) / chunks.length,
        end: start + (length * (i + 1)) / chunks.length,
      });
    });
  }
  return out;
}
