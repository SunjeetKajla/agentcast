import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SfxPack } from "@agentcast/shared";
import type { Sound, SfxKind } from "./audio.ts";

// The sound effects (PRD §9.7.2): the licensed pack in assets/sfx when it has a kind, else our own,
// synthesised with ffmpeg in three takes (the same sound on every cut is the most common tell).
// Each recipe is an aevalsrc expression per stereo channel, then filters.

const exec = promisify(execFile);

/** The pack's folder: assets/sfx/ in the repo, or AGENTCAST_SFX_DIR. */
export const sfxDir = () => process.env.AGENTCAST_SFX_DIR ?? fileURLToPath(new URL("../../../assets/sfx/", import.meta.url));

/** The fallback's three takes differ in pitch; a whoosh's second take also travels the other way. */
const PITCH = [1, 1.09, 0.93];

type Recipe = { seconds: number; left: string; right: string; filters: string };

const RECIPES: Record<SfxKind, (pitch: number, take: number) => Recipe> = {
  // Air rushing past: up quickly, so it starts with the move, then trailing away.
  whoosh: (p, take) => {
    const rising = "(0.4+0.6*t/0.6)";
    const falling = "(1-0.6*t/0.6)";
    const shape = "min(t/0.12,1)^2*exp(-max(t-0.12,0)*6)";
    return {
      seconds: 0.6,
      left: `(random(0)*2-1)*${shape}*${take === 1 ? rising : falling}`,
      right: `(random(1)*2-1)*${shape}*${take === 1 ? falling : rising}`,
      filters: `bandpass=f=${Math.round(1400 * p)}:w=2200,volume=2.2`,
    };
  },
  // A soft interface tick.
  click: (p) => ({
    seconds: 0.06,
    left: `sin(2*PI*${Math.round(1900 * p)}*t)*exp(-t*120)*0.6+(random(0)*2-1)*exp(-t*500)*0.3`,
    right: `sin(2*PI*${Math.round(1900 * p)}*t)*exp(-t*120)*0.6+(random(1)*2-1)*exp(-t*500)*0.3`,
    filters: "highpass=f=700",
  }),
  // A rounded pop: a quick downward pitch bend.
  pop: (p) => {
    const tone = `sin(2*PI*(${Math.round(240 * p)}*t+${Math.round(700 * p)}*(1-exp(-t*30))/30))*exp(-t*18)`;
    return { seconds: 0.2, left: tone, right: tone, filters: "lowpass=f=4500" };
  },
  // A build into a reveal: noise and a rising tone, swelling, cut at the peak.
  riser: (p) => {
    const tone = `0.45*sin(2*PI*(${Math.round(150 * p)}*t+${Math.round(360 * p)}*t*t))`;
    return {
      seconds: 1.2,
      left: `((random(0)*2-1)*0.5+${tone})*(t/1.2)^2.4`,
      right: `((random(1)*2-1)*0.5+${tone})*(t/1.2)^2.4`,
      filters: "highpass=f=180,afade=t=out:st=1.1:d=0.1,volume=1.5",
    };
  },
  // A low impact with a short tail.
  hit: (p) => {
    const tone = `sin(2*PI*(${Math.round(50 * p)}*t+${Math.round(80 * p)}*(1-exp(-t*12))/12))*exp(-t*4)*0.9`;
    return {
      seconds: 1.2,
      left: `${tone}+(random(0)*2-1)*exp(-t*35)*0.4`,
      right: `${tone}+(random(1)*2-1)*exp(-t*35)*0.4`,
      filters: "lowpass=f=5000,aecho=0.8:0.5:60|120:0.25|0.12",
    };
  },
  // A soft key, quieter and shorter than a click.
  tick: (p) => ({
    seconds: 0.04,
    left: `sin(2*PI*${Math.round(3100 * p)}*t)*exp(-t*260)*0.35+(random(0)*2-1)*exp(-t*900)*0.25`,
    right: `sin(2*PI*${Math.round(3100 * p)}*t)*exp(-t*260)*0.35+(random(1)*2-1)*exp(-t*900)*0.25`,
    filters: "highpass=f=1200",
  }),
};

/** Bump when a recipe changes, so files made by an older one are made again. */
const VERSION = 3;

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** The pack's files that are there, by kind. No pack, no files. */
async function packFiles(dir: string): Promise<Partial<Record<SfxKind, string[]>>> {
  const text = await readFile(join(dir, "tags.json"), "utf8").catch(() => undefined);
  if (!text) return {};
  const out: Partial<Record<SfxKind, string[]>> = {};
  for (const sound of SfxPack.parse(JSON.parse(text)).sounds) {
    const file = join(dir, sound.file);
    if (await exists(file)) (out[sound.kind] ??= []).push(file);
  }
  return out;
}

async function synthesise(file: string, r: Recipe, signal?: AbortSignal) {
  if (await exists(file)) return file;
  const temp = `${file}.${process.pid}.tmp.wav`;
  // Commas in an expression would split the filter graph.
  const expr = `${r.left}|${r.right}`.replace(/,/g, "\\,");
  await exec(
    "ffmpeg",
    [
      ...["-v", "error", "-y", "-f", "lavfi"],
      ...["-i", `aevalsrc=${expr}:s=48000:d=${r.seconds}`],
      ...["-af", `${r.filters},alimiter=limit=0.7`, "-ar", "48000", temp],
    ],
    { signal },
  );
  await rename(temp, file);
  return file;
}

/**
 * Each effect's takes. The pack's where it has the kind; otherwise made once into `dir`
 * (`<kind>.v<N>.<take>.wav`, 48 kHz stereo, peak-limited). Two callers making the same file at once
 * is harmless: each renames its own temp file.
 */
export async function ensureSfx(dir: string, signal?: AbortSignal, pack = sfxDir()): Promise<Record<SfxKind, string[]>> {
  await mkdir(dir, { recursive: true });
  const chosen = await packFiles(pack);
  const kinds = Object.keys(RECIPES) as SfxKind[];
  const takes = await Promise.all(
    kinds.map(async (kind) => {
      const own = chosen[kind];
      if (own?.length) return own;
      return Promise.all(PITCH.map((p, take) => synthesise(join(dir, `${kind}.v${VERSION}.${take + 1}.wav`), RECIPES[kind](p, take), signal)));
    }),
  );
  return Object.fromEntries(kinds.map((kind, i) => [kind, takes[i]!])) as Record<SfxKind, string[]>;
}

/** A peak's window, and a level's: 400 ms, the window momentary loudness uses, to compare with the bed's LUFS. */
const WINDOW = { peak: 0.01, level: 0.4 };

/** Where mono samples peak (a 10 ms window's middle) and their loudest 400 ms in dB. */
export function shapeOf(samples: Float32Array, rate: number): Sound & { seconds: number } {
  const loudest = (span: number) => {
    const size = Math.max(1, Math.round(span * rate));
    let sum = 0;
    let best = 0;
    let at = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i]! * samples[i]!;
      if (i >= size) sum -= samples[i - size]! * samples[i - size]!;
      const start = Math.max(0, i - size + 1);
      if (sum > best) {
        best = sum;
        at = start;
      }
    }
    // Over the whole window even when the sound is shorter: a short sound is heard as quieter.
    return { at, rms: Math.sqrt(best / size) };
  };
  const peak = loudest(WINDOW.peak);
  const level = loudest(WINDOW.level);
  return {
    seconds: samples.length / rate,
    peak: (peak.at + (WINDOW.peak * rate) / 2) / rate,
    levelDb: 20 * Math.log10(Math.max(level.rms, 1e-6)),
  };
}

/** A sound file's shape, measured from its decoded samples. */
export function soundShape(file: string, signal?: AbortSignal): Promise<Sound & { seconds: number }> {
  const rate = 48000;
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], {
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });
    const chunks: Buffer[] = [];
    let errors = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c) => (errors += c));
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) return fail(new Error(`ffmpeg couldn't read ${file}: ${errors.trim().slice(-200)}`));
      const bytes = Buffer.concat(chunks);
      done(shapeOf(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4)).slice(), rate));
    });
  });
}
