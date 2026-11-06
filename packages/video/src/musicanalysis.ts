import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { z } from "zod";
import { hyperframes } from "./hyperframes/cli.ts";

// A track's grid, loudness and strong bars, measured once when it joins the library, so renders never
// run an analyser. The beat tracker follows onsets and jitters, so its beats are fitted to one tempo.

const BEATS_PER_BAR = 4;
/** A beat this close to the grid counts as on it, in seconds. */
const ON_GRID = 0.04;

/** The tempo and phase that fit `beats` best, and the share of beats on that grid. */
export function regularGrid(beats: number[], bpm: number): { bpm: number; firstBeat: number; fit: number } {
  if (beats.length < 8) return { bpm, firstBeat: beats[0] ?? 0, fit: 0 };
  let period = 60 / bpm;
  let phase = beats[0]!;
  const wrapped = (x: number, p: number) => ((x % p) + p) % p;
  const inliers = (p: number, at: number) => beats.filter((t) => Math.abs(wrapped(t - at + p / 2, p) - p / 2) <= ON_GRID);
  // The phase most beats agree with, for the tracker's own tempo.
  for (const t of beats.slice(0, 64)) if (inliers(period, t).length > inliers(period, phase).length) phase = t;
  // Then refine the tempo on those beats alone: a least-squares line through (beat number, time).
  for (let round = 0; round < 3; round++) {
    const on = inliers(period, phase);
    if (on.length < 8) break;
    const xs = on.map((t) => Math.round((t - phase) / period));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = on.reduce((a, b) => a + b, 0) / on.length;
    const den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
    if (!den) break;
    period = xs.reduce((sum, x, i) => sum + (x - mx) * (on[i]! - my), 0) / den;
    phase = my - period * mx;
  }
  const first = ((phase % period) + period) % period;
  return { bpm: 60 / period, firstBeat: first, fit: inliers(period, phase).length / beats.length };
}

/** Moves a grid's phase to the bar line the tracked downbeats agree with. */
export function alignBars(firstBeat: number, bpm: number, downbeats: number[]): number {
  const beat = 60 / bpm;
  const bar = beat * BEATS_PER_BAR;
  let best = firstBeat;
  let most = -1;
  for (let k = 0; k < BEATS_PER_BAR; k++) {
    const at = firstBeat + k * beat;
    const hits = downbeats.filter((t) => Math.abs((((t - at + bar / 2) % bar) + bar) % bar - bar / 2) <= beat / 4).length;
    if (hits > most) {
      most = hits;
      best = at;
    }
  }
  return best;
}

/** The bars of a grid inside `seconds`. */
export function barStarts(firstBeat: number, bpm: number, seconds: number): number[] {
  const bar = (60 / bpm) * BEATS_PER_BAR;
  const out: number[] = [];
  for (let t = firstBeat; t < seconds; t += bar) out.push(Math.round(t * 1000) / 1000);
  return out;
}

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]!;

/**
 * Bars to enter at: section starts (moved to the nearest bar) with the whole of the next `hold` bars
 * near the track's full level, so a film doesn't open on a quiet intro. Any strong stretch if no
 * section start qualifies; the first bar if nothing does.
 */
export function entriesOf(bars: number[], barDb: number[], sections: number[], hold = 8): number[] {
  const full = percentile(barDb, 0.75);
  const strong = (i: number) => {
    const next = barDb.slice(i, i + hold);
    return next.length === hold && next.every((db) => db >= full - 3);
  };
  const nearest = (t: number) => bars.reduce((best, b, i) => (Math.abs(b - t) < Math.abs(bars[best]! - t) ? i : best), 0);
  const fromSections = [...new Set(sections.map(nearest))].filter(strong).map((i) => bars[i]!);
  if (fromSections.length) return fromSections;
  const any = bars.filter((_, i) => strong(i));
  return any.length ? any.slice(0, 8) : [bars[0]!];
}

const Measured = z.object({
  items: z
    .array(
      z.object({
        duration: z.number().positive(),
        beats: z.object({ times: z.array(z.number()) }),
        downbeats: z.object({ times: z.array(z.number()), confidence: z.string().optional() }),
        bpm: z.object({ value: z.number().positive() }),
        sections: z.object({ spans: z.array(z.object({ start: z.number() })) }),
        moments: z.object({ tailEnd: z.number().nullable().optional() }),
        loudness: z.object({ lufsIntegrated: z.number(), truePeakDb: z.number() }),
      }),
    )
    .length(1),
});

/** Mono samples of a file. */
function decode(file: string, rate: number, signal?: AbortSignal): Promise<Float32Array> {
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], {
      stdio: ["ignore", "pipe", "ignore"],
      ...(signal ? { signal } : {}),
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) return fail(new Error(`ffmpeg couldn't read ${file}`));
      const bytes = Buffer.concat(chunks);
      done(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4)).slice());
    });
  });
}

/** Everything the library keeps about a track, measured locally: nothing is uploaded. */
export async function analyzeTrack(file: string, signal?: AbortSignal) {
  const { stdout } = await hyperframes(["audio", file, "--only", "beats,downbeats,bpm,sections,moments,loudness", "--quality", "local", "--json"], {
    cwd: dirname(file),
    ...(signal ? { signal } : {}),
  });
  const item = Measured.parse(JSON.parse(stdout)).items[0]!;
  const grid = regularGrid(item.beats.times, item.bpm.value);
  const firstBeat = alignBars(grid.firstBeat, grid.bpm, item.downbeats.times);
  const bars = barStarts(firstBeat, grid.bpm, item.duration);
  const rate = 8000;
  const samples = await decode(file, rate, signal);
  const barSeconds = (60 / grid.bpm) * BEATS_PER_BAR;
  const barDb = bars.map((b) => {
    const from = Math.floor(b * rate);
    const to = Math.min(samples.length, Math.floor((b + barSeconds) * rate));
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    return 10 * Math.log10(Math.max(sum / Math.max(1, to - from), 1e-9));
  });
  const confidence = grid.fit >= 0.8 && item.downbeats.confidence !== "low" ? "high" : grid.fit >= 0.6 ? "medium" : "low";
  return {
    bpm: Math.round(grid.bpm * 100) / 100,
    firstBeat: Math.round(firstBeat * 1000) / 1000,
    seconds: item.duration,
    lufs: item.loudness.lufsIntegrated,
    truePeak: item.loudness.truePeakDb,
    analysis: {
      confidence: confidence as "high" | "medium" | "low",
      entries: entriesOf(bars, barDb, item.sections.spans.map((s) => s.start)),
      tailEnd: item.moments.tailEnd ?? item.duration,
    },
  };
}
