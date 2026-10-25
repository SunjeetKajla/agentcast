import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { hyperframes } from "./cli.ts";

// Rendering, stills and checks of a compiled composition through the pinned CLI (PRD §9.8).

/** Runs ffmpeg/ffprobe, resolving with stderr+stdout; rejects on a non-zero exit. */
export function run(cmd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    const kill = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", fail);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) fail(signal.reason);
      else if (code === 0) done(out);
      else fail(new Error(`${cmd} exited ${code}: ${out.trim().split("\n").slice(-4).join(" | ")}`));
    });
  });
}

let nvenc: Promise<boolean> | undefined;
/** Whether ffmpeg here can encode H.264 on an NVIDIA GPU (checked once per process). */
const hasNvenc = () =>
  (nvenc ??= run("ffmpeg", ["-hide_banner", "-encoders"]).then(
    (out) => out.includes("h264_nvenc"),
    () => false,
  ));

/**
 * Renders the composition in `dir` to `out` (.mp4), then normalises loudness to −14 LUFS / −1.5 dBTP
 * with the picture copied (FR-81). `draft` for previews.
 */
export async function renderComposition(o: {
  dir: string;
  out: string;
  draft?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<{ seconds: number }> {
  const started = performance.now();
  const raw = `${o.out}.raw.mp4`;
  await hyperframes(
    // JPEG source frames: PNG extraction tripled the render time for no visible gain (spike, Oct 25).
    ["render", o.dir, "-o", raw, "--quality", o.draft ? "draft" : "standard", "--strict", ...((await hasNvenc()) ? ["--gpu"] : [])],
    {
      cwd: o.dir,
      ...(o.signal ? { signal: o.signal } : {}),
      onLine: (line) => {
        const pct = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(line);
        if (pct) o.onProgress?.(Math.min(0.97, Number(pct[1]) / 100));
      },
    },
  );
  try {
    const probe = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", raw], o.signal);
    if (probe.trim())
      await run(
        "ffmpeg",
        ["-v", "error", "-y", "-i", raw, "-map", "0", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.84:level=false", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", o.out],
        o.signal,
      );
    else await rename(raw, o.out);
  } finally {
    await rm(raw, { force: true });
  }
  o.onProgress?.(1);
  return { seconds: (performance.now() - started) / 1000 };
}

/**
 * Frames of the composition at `times` (seconds) as PNGs in `outDir`, in the order asked. No model
 * describes them (`--describe false`).
 */
export async function snapshotComposition(o: {
  dir: string;
  outDir: string;
  times: number[];
  signal?: AbortSignal;
}): Promise<string[]> {
  await rm(o.outDir, { recursive: true, force: true });
  await mkdir(o.outDir, { recursive: true });
  await hyperframes(
    ["snapshot", o.dir, "--at", o.times.map((t) => t.toFixed(3)).join(","), "--no-end", "--describe", "false", "-o", o.outDir],
    { cwd: o.dir, ...(o.signal ? { signal: o.signal } : {}) },
  );
  const files = (await readdir(o.outDir)).filter((f) => /^frame-\d+/.test(f)).sort();
  return files.map((f) => join(o.outDir, f));
}

export type CheckFinding = { section: string; code: string; severity: string; message: string; file?: string; selector?: string; at?: number };

/** `hyperframes check --json`: lint, runtime, layout, motion, contrast and craft findings. */
export async function checkComposition(dir: string, signal?: AbortSignal): Promise<{ ok: boolean; findings: CheckFinding[] }> {
  const { stdout } = await hyperframes(["check", dir, "--json"], { cwd: dir, allowFailure: true, ...(signal ? { signal } : {}) });
  const json = JSON.parse(stdout.slice(stdout.indexOf("{"))) as Record<string, unknown> & { ok?: boolean };
  const findings: CheckFinding[] = [];
  for (const [section, value] of Object.entries(json)) {
    const list = (value as { findings?: Record<string, unknown>[] } | undefined)?.findings;
    if (!Array.isArray(list)) continue;
    for (const f of list)
      findings.push({
        section,
        code: String(f.code ?? f.rule ?? "unknown"),
        severity: String(f.severity ?? "error"),
        message: String(f.message ?? ""),
        ...(f.file ? { file: String(f.file) } : {}),
        ...(f.selector ? { selector: String(f.selector) } : {}),
        ...(typeof f.time === "number" ? { at: f.time } : typeof f.sampleTime === "number" ? { at: f.sampleTime } : {}),
      });
  }
  return { ok: Boolean(json.ok), findings };
}
