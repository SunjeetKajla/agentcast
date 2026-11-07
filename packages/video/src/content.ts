import { spawn } from "node:child_process";
import type { Rect, Storyboard, Timeline } from "@agentcast/shared";
import type { ShotContent } from "./template.ts";

// What's actually on a page's screen, measured from the footage: marketing pages and sparse apps have
// large empty stretches, and a shot framed on one looks broken.

const W = 144;
const H = 90;
/** How far from the background a pixel must be to count as content, and the top band a site's nav sits in. */
const THRESHOLD = 14;
const NAV = 0.09;

/**
 * The tightest box around the largest connected stretch of content in a W×H greyscale frame, as shares
 * of the frame, and the share of the frame that is content.
 */
export function contentBox(gray: Uint8Array, w: number, h: number): { box: Rect; fill: number } {
  const sorted = [...gray].sort((a, b) => a - b);
  const background = sorted[sorted.length >> 1]!;
  const top = Math.ceil(h * NAV);
  const rows = new Array<number>(h).fill(0);
  const cols = new Array<number>(w).fill(0);
  let active = 0;
  for (let y = top; y < h; y++)
    for (let x = 0; x < w; x++)
      if (Math.abs(gray[y * w + x]! - background) > THRESHOLD) {
        rows[y]!++;
        cols[x]!++;
        active++;
      }
  /** The widest run of values over `floor`, bridging gaps of at most `gap`. */
  const band = (values: number[], floor: number, gap: number): [number, number] => {
    let best: [number, number] = [0, 0];
    let start = -1;
    let last = -1;
    values.forEach((v, i) => {
      if (v <= floor) return;
      if (start < 0 || i - last > gap) start = i;
      last = i;
      if (last - start > best[1] - best[0]) best = [start, last];
    });
    return best;
  };
  const [y0, y1] = band(rows, w * 0.01, Math.round(h * 0.14));
  const [x0, x1] = band(cols, h * 0.01, Math.round(w * 0.1));
  return { box: [x0 / w, y0 / h, (x1 - x0 + 1) / w, (y1 - y0 + 1) / h], fill: active / (w * (h - top)) };
}

/** Pixels this far from the background count when looking for columns: mock-ups on dark pages are faint. */
const FAINT = 7;

/** The runs of `active` at least `least` long, separated by gaps of at least `gap`. */
function runs(active: boolean[], gap: number, least: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let last = -1;
  active.forEach((on, i) => {
    if (!on) return;
    if (start >= 0 && i - last > gap) {
      out.push([start, last]);
      start = i;
    }
    if (start < 0) start = i;
    last = i;
  });
  if (start >= 0) out.push([start, last]);
  return out.filter(([a, b]) => b - a + 1 >= least);
}

/**
 * Columns found in the pixels, for pages whose structure isn't in the DOM (a mock-up drawn as an image or
 * a canvas): 3–6 tall stretches of similar width with clear gutters, and the cards in each. Shares of the frame.
 */
export function pixelColumns(gray: Uint8Array, w: number, h: number): { columns: Rect[]; cards: Rect[] } | undefined {
  const sorted = [...gray].sort((a, b) => a - b);
  const background = sorted[sorted.length >> 1]!;
  const on = (x: number, y: number) => Math.abs(gray[y * w + x]! - background) > FAINT;
  const top = Math.ceil(h * NAV);
  const rowsOn: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    if (y >= top) for (let x = 0; x < w; x++) if (on(x, y)) n++;
    rowsOn.push(n > w * 0.04);
  }
  const bands = runs(rowsOn, Math.round(h * 0.05), Math.round(h * 0.25));
  const band = bands.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  if (!band) return undefined;
  const colsOn: boolean[] = [];
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = band[0]; y <= band[1]; y++) if (on(x, y)) n++;
    colsOn.push(n > (band[1] - band[0] + 1) * 0.25);
  }
  // Evenly spaced gutters are the sign of a board. Its outer columns may fade into the page, so the
  // spacing, not their visible width, says where they are.
  const parts = runs(colsOn, 1, Math.round(w * 0.04));
  if (parts.length < 3) return undefined;
  const gutters = parts.slice(1).map(([a], i) => [parts[i]![1], a] as const);
  const centres = gutters.map(([a, b]) => (a + b) / 2);
  const gaps = centres.slice(1).map((c, i) => c - centres[i]!);
  const pitch = gaps.length ? gaps.reduce((sum, g) => sum + g, 0) / gaps.length : 0;
  if (!gaps.length || pitch < w * 0.12 || gaps.some((g) => Math.abs(g - pitch) > pitch * 0.06)) return undefined;
  const half = (gutters[0]![1] - gutters[0]![0]) / 2;
  const xs: [number, number][] = [];
  for (let i = 0; i <= centres.length; i++) {
    const from = (i ? centres[i - 1]! : centres[0]! - pitch) + half;
    const to = (i < centres.length ? centres[i]! : centres.at(-1)! + pitch) - half;
    if (from >= 0 && to < w) xs.push([Math.round(from), Math.round(to)]);
  }
  if (xs.length < 3 || xs.length > 6) return undefined;
  // How far down the columns themselves run: the band can include text above them.
  const inner = xs.slice(1, -1);
  const below: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    let of = 0;
    if (y >= band[0] && y <= band[1])
      for (const [a, b] of inner)
        for (let x = a; x <= b; x++) {
          of++;
          if (on(x, y)) n++;
        }
    below.push(of > 0 && n > of * 0.1);
  }
  const extent = runs(below, Math.round(h * 0.025), Math.round(h * 0.2)).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  if (!extent) return undefined;
  const share = (x0: number, y0: number, x1: number, y1: number): Rect => [x0 / w, y0 / h, (x1 - x0 + 1) / w, (y1 - y0 + 1) / h];
  const cards: Rect[] = [];
  for (const [a, b] of inner) {
    const lines: boolean[] = [];
    for (let y = 0; y < h; y++) {
      let n = 0;
      if (y >= extent[0] && y <= extent[1]) for (let x = a; x <= b; x++) if (on(x, y)) n++;
      lines.push(n > (b - a + 1) * 0.5);
    }
    for (const [y0, y1] of runs(lines, 1, Math.round(h * 0.06)))
      if (y1 - y0 + 1 <= h * 0.28) cards.push(share(a, y0, b, y1));
  }
  return { columns: xs.map(([a, b]) => share(a, extent[0], b, extent[1])), cards };
}

function frameAt(file: string, t: number, signal?: AbortSignal, size: [number, number] = [W, H]): Promise<Uint8Array> {
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${size[0]}:${size[1]}:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
      stdio: ["ignore", "pipe", "ignore"],
      ...(signal ? { signal } : {}),
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done(new Uint8Array(Buffer.concat(chunks))) : fail(new Error(`ffmpeg couldn't read ${file}`))));
  });
}

/** What each footage beat's page shows, as it last settled inside the beat. */
export async function shotContent(file: string, storyboard: Storyboard, timeline: Timeline, signal?: AbortSignal): Promise<Record<string, ShotContent>> {
  const out: Record<string, ShotContent> = {};
  const view = timeline.viewport;
  for (const beat of storyboard.beats) {
    if (beat.flowId === undefined || beat.in === undefined || beat.out === undefined) continue;
    const settled = timeline.events.filter((e) => e.kind === "settled" && e.flowId === beat.flowId && e.t >= beat.in! && e.t <= beat.out!).at(-1);
    const t = settled?.t ?? (beat.in + beat.out) / 2;
    const { box, fill } = contentBox(await frameAt(file, t, signal), W, H);
    const toView = (r: Rect): Rect => [Math.round(r[0] * view.w), Math.round(r[1] * view.h), Math.round(r[2] * view.w), Math.round(r[3] * view.h)];
    out[beat.id] = { t, box: toView(box), fill };
    // A page with no structure in its DOM, just before each action: is it a drawn board?
    const moments = timeline.events.filter((e) => e.flowId === beat.flowId && e.t >= beat.in! && e.t <= beat.out! && e.layout && !e.layout.panel && !e.layout.groups.some((g) => g.kind !== "rows"));
    for (const event of moments) {
      const at = event.layout!.at ?? event.t;
      const found = pixelColumns(await frameAt(file, at, signal, [W * 5, H * 5]), W * 5, H * 5);
      if (found) {
        out[beat.id]!.board = { t: at, columns: found.columns.map(toView), cards: found.cards.map(toView) };
        break;
      }
    }
  }
  return out;
}
