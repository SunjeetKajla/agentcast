import { spawn } from "node:child_process";
import type { BrandKit } from "@agentcast/shared";

// The logo's parts (docs/BRAND_MOTION_PLAN.md §4), read from its 4× capture so it works for any logo, vector or
// not: where the symbol is, and where each letter of the name is, so a film can reveal it piece by piece.

type Logo = NonNullable<BrandKit["logo"]>;

/**
 * The runs of columns with ink in an RGBA image: a pixel is ink when it's opaque and far from the background it
 * was captured on, read from the image's border (the commonest colour can be the letters, on a gradient).
 */
export function inkSpans(rgba: Uint8Array, w: number, h: number): [number, number][] {
  const border: number[][] = [[], [], []];
  const take = (x: number, y: number) => [0, 1, 2].forEach((c) => border[c]!.push(rgba[(y * w + x) * 4 + c]!));
  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    take(0, y);
    take(w - 1, y);
  }
  const bg = border.map((values) => values.sort((a, b) => a - b)[values.length >> 1] ?? 255);
  const spans: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    let on = false;
    for (let y = 0; x < w && y < h && !on; y++) {
      const i = (y * w + x) * 4;
      on = rgba[i + 3]! > 40 && Math.abs(rgba[i]! - bg[0]!) + Math.abs(rgba[i + 1]! - bg[1]!) + Math.abs(rgba[i + 2]! - bg[2]!) > 90;
    }
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      spans.push([start, x]);
      start = -1;
    }
  }
  return spans;
}

/**
 * A logo's kind and parts from its ink spans. A symbol is the spans left of a gap much wider than the gaps
 * between letters, when they're about as wide as the logo is tall. Specks narrower than 2% of the height join
 * their neighbour.
 */
export function splitLogo(found: [number, number][], w: number, h: number): Pick<Logo, "kind" | "mark" | "letters"> {
  const spans: [number, number][] = [];
  for (const s of found) {
    const last = spans.at(-1);
    if (last && (s[1] - s[0] < h * 0.02 || s[0] - last[1] <= 1)) last[1] = s[1];
    else spans.push([s[0], s[1]]);
  }
  const share = ([a, b]: [number, number]): [number, number] => [Math.round((a / w) * 1e4) / 1e4, Math.round((b / w) * 1e4) / 1e4];
  if (!spans.length) return { kind: "wordmark", letters: [] };
  if (spans.length === 1) return spans[0]![1] - spans[0]![0] <= h * 1.6 ? { kind: "mark", mark: share(spans[0]!), letters: [] } : { kind: "wordmark", letters: [share(spans[0]!)] };
  const gaps = spans.slice(1).map((s, i) => s[0] - spans[i]![1]);
  const widest = gaps.indexOf(Math.max(...gaps));
  const others = gaps.filter((_, i) => i !== widest).sort((a, b) => a - b);
  const typical = others.length ? others[others.length >> 1]! : 0;
  const left: [number, number] = [spans[0]![0], spans[widest]![1]];
  const isMark = gaps[widest]! >= Math.max(typical * 1.8, h * 0.12) && left[1] - left[0] <= h * 1.6;
  if (!isMark) return { kind: "wordmark", letters: spans.map(share) };
  return { kind: "mark+wordmark", mark: share(left), letters: spans.slice(widest + 1).map(share) };
}

/** Problems that keep a cleaned SVG out of a film: anything active or external. Empty means it's safe to use. */
export function svgProblems(svg: string): string[] {
  const problems: string[] = [];
  if (!/^<svg[\s>]/.test(svg.trim())) problems.push("isn't an <svg> document");
  if (/<script|<foreignObject|<iframe|<image|<use/i.test(svg)) problems.push("has an element outside the allowlist");
  if (/\son\w+\s*=/i.test(svg)) problems.push("has an event handler");
  if (/(?:href|src)\s*=|url\(\s*["']?(?!#)/i.test(svg)) problems.push("refers to something outside itself");
  if (svg.length > 200_000) problems.push("is too large for a logo");
  return problems;
}

/** A PNG's pixels, through ffmpeg. */
function pixels(file: string, signal?: AbortSignal): Promise<{ rgba: Uint8Array; w: number; h: number }> {
  return new Promise((done, fail) => {
    const probe = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { ...(signal ? { signal } : {}) });
    let size = "";
    probe.stdout.on("data", (c) => (size += c));
    probe.on("error", fail);
    probe.on("close", (code) => {
      const [w, h] = size.trim().split(",").map(Number);
      if (code !== 0 || !w || !h) return fail(new Error(`ffprobe couldn't read ${file}`));
      const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { ...(signal ? { signal } : {}) });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.on("error", fail);
      child.on("close", (status) => (status === 0 ? done({ rgba: new Uint8Array(Buffer.concat(chunks)), w, h }) : fail(new Error(`ffmpeg couldn't read ${file}`))));
    });
  });
}

/** The background a capture sat on, as #rrggbb (the median of its border), and how far the border strays from it. */
export function borderColour(rgba: Uint8Array, w: number, h: number): string {
  return border(rgba, w, h).colour;
}

function border(rgba: Uint8Array, w: number, h: number) {
  const values: number[][] = [[], [], []];
  const take = (x: number, y: number) => [0, 1, 2].forEach((c) => values[c]!.push(rgba[(y * w + x) * 4 + c]!));
  for (let x = 0; x < w; x++) (take(x, 0), take(x, h - 1));
  for (let y = 0; y < h; y++) (take(0, y), take(w - 1, y));
  const median = values.map((v) => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 255);
  // The mean distance of border pixels from that colour: high when the crop cuts through the ink.
  const spread = values[0]!.reduce((sum, _, i) => sum + Math.abs(values[0]![i]! - median[0]!) + Math.abs(values[1]![i]! - median[1]!) + Math.abs(values[2]![i]! - median[2]!), 0) / values[0]!.length;
  return { colour: "#" + median.map((v) => v.toString(16).padStart(2, "0")).join(""), spread };
}

/**
 * The capture with its background keyed out, so it sits on any ground: `out`, a PNG with alpha. Skipped (false)
 * when the capture already has transparency.
 */
export async function cutOut(png: string, out: string, signal?: AbortSignal): Promise<boolean> {
  const { rgba, w, h } = await pixels(png, signal);
  for (let i = 3; i < rgba.length; i += 4 * 17) if (rgba[i]! < 250) return false;
  const edge = border(rgba, w, h);
  // A border that isn't one even colour means the crop runs through the logo: keying it would eat the ink.
  if (edge.spread > 30) return false;
  const colour = edge.colour.slice(1);
  await new Promise<void>((done, fail) => {
    const child = spawn("ffmpeg", ["-v", "error", "-y", "-i", png, "-vf", `format=rgba,colorkey=0x${colour}:0.16:0.1`, out], { ...(signal ? { signal } : {}) });
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg couldn't key ${png}`))));
  });
  return true;
}

/** The logo kit's parts, read from the 4× capture. */
export async function logoParts(png: string, signal?: AbortSignal): Promise<Pick<Logo, "kind" | "mark" | "letters">> {
  const { rgba, w, h } = await pixels(png, signal);
  return splitLogo(inkSpans(rgba, w, h), w, h);
}
