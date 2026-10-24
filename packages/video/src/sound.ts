import { execFile } from "node:child_process";
import { access, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SfxKind } from "./audio.ts";

// The sound effects (PRD §9.7.2), synthesised with ffmpeg: our own, so there's no licence to track.
// Each is an aevalsrc expression per stereo channel, then filters.

const exec = promisify(execFile);

const RECIPES: Record<SfxKind, { seconds: number; left: string; right: string; filters: string }> = {
  // Air rushing past, travelling left to right.
  whoosh: {
    seconds: 0.6,
    left: "(random(0)*2-1)*sin(PI*t/0.6)^2*(1-0.6*t/0.6)",
    right: "(random(1)*2-1)*sin(PI*t/0.6)^2*(0.4+0.6*t/0.6)",
    filters: "bandpass=f=1400:w=2200,volume=2.2",
  },
  // A soft interface tick.
  click: {
    seconds: 0.06,
    left: "sin(2*PI*1900*t)*exp(-t*120)*0.6+(random(0)*2-1)*exp(-t*500)*0.3",
    right: "sin(2*PI*1900*t)*exp(-t*120)*0.6+(random(1)*2-1)*exp(-t*500)*0.3",
    filters: "highpass=f=700",
  },
  // A rounded pop: a quick downward pitch bend.
  pop: {
    seconds: 0.2,
    left: "sin(2*PI*(240*t+700*(1-exp(-t*30))/30))*exp(-t*18)",
    right: "sin(2*PI*(240*t+700*(1-exp(-t*30))/30))*exp(-t*18)",
    filters: "lowpass=f=4500",
  },
  // A build into a reveal: noise and a rising tone, swelling, cut at the peak.
  riser: {
    seconds: 1.2,
    left: "((random(0)*2-1)*0.5+0.45*sin(2*PI*(150*t+360*t*t)))*(t/1.2)^2.4",
    right: "((random(1)*2-1)*0.5+0.45*sin(2*PI*(150*t+360*t*t)))*(t/1.2)^2.4",
    filters: "highpass=f=180,afade=t=out:st=1.1:d=0.1,volume=1.5",
  },
  // A low impact with a short tail.
  hit: {
    seconds: 1.2,
    left: "sin(2*PI*(50*t+80*(1-exp(-t*12))/12))*exp(-t*4)*0.9+(random(0)*2-1)*exp(-t*35)*0.4",
    right: "sin(2*PI*(50*t+80*(1-exp(-t*12))/12))*exp(-t*4)*0.9+(random(1)*2-1)*exp(-t*35)*0.4",
    filters: "lowpass=f=5000,aecho=0.8:0.5:60|120:0.25|0.12",
  },
};

/** Bump when a recipe changes, so files made by an older one are made again. */
const VERSION = 1;

/**
 * Makes each effect once into `dir` (`<kind>.v<N>.wav`, 48 kHz stereo, peak-limited) and returns
 * the files. Two callers making the same file at once is harmless: each renames its own temp file.
 */
export async function ensureSfx(dir: string, signal?: AbortSignal): Promise<Record<SfxKind, string>> {
  await mkdir(dir, { recursive: true });
  const kinds = Object.keys(RECIPES) as SfxKind[];
  const files = await Promise.all(
    kinds.map(async (kind) => {
      const file = join(dir, `${kind}.v${VERSION}.wav`);
      if (
        await access(file).then(
          () => true,
          () => false,
        )
      )
        return file;
      const r = RECIPES[kind];
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
    }),
  );
  return Object.fromEntries(kinds.map((kind, i) => [kind, files[i]!])) as Record<SfxKind, string>;
}
