import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Brand imagery (docs/BRAND_MOTION_PLAN.md §4): the brand's own objects (Sarvam's orbs, an illustration, a
// product render) cut out of its pages and the recording, and the brand's colours read from them. A brand whose
// CSS is black and white often carries all its colour in imagery like this.

export type Rgba = { rgba: Uint8Array; w: number; h: number };
export type Found = { box: [number, number, number, number]; area: number; fill: number; colour: string; round: boolean };

const hsv = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min) + 6) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
  }
  return { h: h * 60, s, v };
};

/** Whether a pixel is colour, not grey, white, black or UI: saturated and not too dark. */
const colourful = (r: number, g: number, b: number) => {
  const { s, v } = hsv(r, g, b);
  return s > 0.35 && v > 0.25;
};

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

/**
 * The colourful objects in an image: connected areas of colour that don't touch the edge (a background glow
 * does), cover between 0.3% and 15% of the image, fill at least half their box and aren't long and thin (type).
 * Holes inside an object (an orb's white highlight) belong to it.
 */
export function objectsIn(img: Rgba): Found[] {
  return components(img).objects;
}

/** The objects and, for each pixel, which object it belongs to (-1: none). */
function components(img: Rgba): { objects: (Found & { id: number })[]; seen: Int32Array } {
  const { rgba, w, h } = img;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (colourful(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)) mask[i] = 1;
  // Neighbours join only when their colours are close: steps inside a smooth gradient are small, steps across
  // the edge between two objects are usually large.
  const near = (a: number, b: number) => {
    const dr = rgba[a * 4]! - rgba[b * 4]!, dg = rgba[a * 4 + 1]! - rgba[b * 4 + 1]!, db = rgba[a * 4 + 2]! - rgba[b * 4 + 2]!;
    return dr * dr + dg * dg + db * db < 24 * 24;
  };
  const label = new Int32Array(w * h).fill(-1);
  const seen = new Int32Array(w * h).fill(-1);
  const objects: (Found & { id: number })[] = [];
  const stack: number[] = [];
  let comp = 0;
  let id = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]! >= 0) continue;
    const members: number[] = [];
    let edge = false;
    stack.push(start);
    label[start] = comp;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      members.push(p);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || Math.abs((q % w) - x) > 1) continue;
        if (mask[q] && label[q]! < 0 && near(p, q)) {
          label[q] = comp;
          stack.push(q);
        }
      }
    }
    comp++;
    // A background glow touches the edge; specks aren't objects.
    if (edge || members.length < w * h * 0.003) continue;
    for (const part of splitAll(members, w)) {
      const f = describe(img, part);
      // An object with the site's UI on it (a white play button in an orb) isn't clean art.
      if (!f || overlayShare(img, part, f.box) > 0.02) continue;
      for (const p of part) seen[p] = id;
      objects.push({ ...f, id });
      id++;
    }
  }
  return { objects: objects.sort((a, b) => b.area - a.area), seen };
}

/** Splits until nothing splits further: three orbs in a row come apart one at a time. */
function splitAll(members: number[], w: number, depth = 0): number[][] {
  const parts = splitTouching(members, w);
  if (parts.length < 2 || depth > 4) return parts;
  return parts.flatMap((p) => splitAll(p, w, depth + 1));
}

/**
 * Splits a component that is several objects touching (Sarvam's orbs overlap each other): its holes filled, the
 * pixels far enough from its edge fall into separate cores at some depth, and every pixel goes to the nearest
 * core. A single object (one core at every depth) comes back whole.
 */
export function splitTouching(members: number[], w: number): number[][] {
  let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
  for (const p of members) {
    const x = p % w, y = (p - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const W = x1 - x0 + 3, H = y1 - y0 + 3; // a pixel of margin all round
  const at = (p: number) => { const x = p % w; return ((p - x) / w - y0 + 1) * W + (x - x0 + 1); };
  const inside = new Uint8Array(W * H);
  for (const p of members) inside[at(p)] = 1;
  // Holes: whatever the margin can't reach.
  const out = new Uint8Array(W * H);
  const stack = [0];
  while (stack.length) {
    const p = stack.pop()!;
    if (out[p] || inside[p]) continue;
    out[p] = 1;
    const x = p % W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (p >= W) stack.push(p - W);
    if (p < W * (H - 1)) stack.push(p + W);
  }
  // Distance to the outside (chessboard, two passes).
  const d = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = out[i] ? 0 : 1 << 20;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (d[i]) d[i] = Math.min(d[i]!, d[i - 1]! + 1, d[i - W]! + 1, d[i - W - 1]! + 1, d[i - W + 1]! + 1);
  }
  for (let y = H - 2; y > 0; y--) for (let x = W - 2; x > 0; x--) {
    const i = y * W + x;
    if (d[i]) d[i] = Math.min(d[i]!, d[i + 1]! + 1, d[i + W]! + 1, d[i + W + 1]! + 1, d[i + W - 1]! + 1);
  }
  let deepest = 0;
  for (let i = 0; i < W * H; i++) if (d[i]! > deepest) deepest = d[i]!;
  const minCore = Math.max(20, members.length * 0.002);
  let seeds: Int32Array | undefined;
  for (let depth = 3; depth < deepest; depth++) {
    const core = new Int32Array(W * H).fill(-1);
    let n = 0;
    for (let i = 0; i < W * H; i++) {
      if (d[i]! <= depth || core[i]! >= 0) continue;
      const part: number[] = [];
      stack.push(i);
      core[i] = n;
      while (stack.length) {
        const p = stack.pop()!;
        part.push(p);
        for (const q of [p - 1, p + 1, p - W, p + W]) if (d[q]! > depth && core[q]! < 0) { core[q] = n; stack.push(q); }
      }
      if (part.length >= minCore) n++;
      else for (const p of part) core[p] = -2;
    }
    if (n >= 2) {
      seeds = core;
      break;
    }
    if (n === 0) break;
  }
  if (!seeds) return [members];
  // Grow the cores back over the object, breadth first, so each pixel joins the nearest one.
  let queue: number[] = [];
  for (let i = 0; i < W * H; i++) if (seeds[i]! < 0) seeds[i] = -1; else queue.push(i);
  while (queue.length) {
    const next: number[] = [];
    for (const p of queue) for (const q of [p - 1, p + 1, p - W, p + W]) if (!out[q] && seeds[q]! < 0) { seeds[q] = seeds[p]!; next.push(q); }
    queue = next;
  }
  const parts = new Map<number, number[]>();
  for (const p of members) {
    const k = seeds[at(p)]!;
    if (k < 0) continue;
    const list = parts.get(k);
    if (list) list.push(p);
    else parts.set(k, [p]);
  }
  return [...parts.values()];
}

/** How much of an object is near-white shapes enclosed by it (a play button): its share of the object's area. */
function overlayShare(img: Rgba, part: number[], box: [number, number, number, number]): number {
  const [x0, y0, bw, bh] = box;
  const W = bw + 2, H = bh + 2;
  const inside = new Uint8Array(W * H);
  for (const p of part) {
    const x = p % img.w, y = (p - x) / img.w;
    inside[(y - y0 + 1) * W + (x - x0 + 1)] = 1;
  }
  const out = new Uint8Array(W * H);
  const stack = [0];
  while (stack.length) {
    const p = stack.pop()!;
    if (out[p] || inside[p]) continue;
    out[p] = 1;
    const x = p % W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (p >= W) stack.push(p - W);
    if (p < W * (H - 1)) stack.push(p + W);
  }
  let grey = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (inside[i] || out[i]) continue;
      const q = ((y0 + y - 1) * img.w + x0 + x - 1) * 4;
      // Near white: a button or a badge laid over the art, not the art's own lighter lettering or highlights.
      if (Math.min(img.rgba[q]!, img.rgba[q + 1]!, img.rgba[q + 2]!) > 225) grey++;
    }
  return grey / Math.max(1, part.length + grey);
}

/**
 * What an object is, or nothing if it isn't one: between 0.3% and 15% of the picture, filling at least half its
 * box, not long and thin (type), and not cut off by a straight edge (an orb a card clips, a photo's frame).
 */
function describe(img: Rgba, part: number[]): Found | undefined {
  const { rgba, w, h } = img;
  let x0 = w, y0 = h, x1 = 0, y1 = 0, r = 0, g = 0, b = 0;
  for (const p of part) {
    const x = p % w, y = (p - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    r += rgba[p * 4]!;
    g += rgba[p * 4 + 1]!;
    b += rgba[p * 4 + 2]!;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = part.length;
  const share = n / (w * h);
  // Filled as its outline encloses it (each row from its first pixel to its last), so an orb's texture and
  // highlight don't count as holes.
  const first = new Int32Array(bh).fill(w), last = new Int32Array(bh).fill(-1);
  for (const p of part) {
    const x = p % w, y = (p - x) / w - y0;
    if (x < first[y]!) first[y] = x;
    if (x > last[y]!) last[y] = x;
  }
  let solid = 0;
  for (let y = 0; y < bh; y++) if (last[y]! >= 0) solid += last[y]! - first[y]! + 1;
  const fill = solid / (bw * bh);
  const aspect = bw / bh;
  if (share < 0.003 || share > 0.15 || fill < 0.5 || aspect < 0.33 || aspect > 3) return undefined;
  // A curved outline touches its box in short runs; a straight cut runs along a side.
  const top = new Uint16Array(bw), bottom = new Uint16Array(bw), left = new Uint16Array(bh), right = new Uint16Array(bh);
  for (const p of part) {
    const x = p % w, y = (p - x) / w;
    if (y === y0) top[x - x0] = 1;
    if (y === y1) bottom[x - x0] = 1;
    if (x === x0) left[y - y0] = 1;
    if (x === x1) right[y - y0] = 1;
  }
  const sum = (a: Uint16Array) => a.reduce((s, v) => s + v, 0) / a.length;
  if (Math.max(sum(top), sum(bottom), sum(left), sum(right)) > 0.35) return undefined;
  // A square-ish box filled less than a circle fills it (π/4) is a circle with a bite out of it: an orb behind
  // another one. Cut out, it looks broken.
  const squarish = aspect > 0.8 && aspect < 1.25;
  if (squarish && fill > 0.55 && fill < 0.74) return undefined;
  return { box: [x0, y0, bw, bh], area: n, fill, colour: hex(r / n, g / n, b / n), round: squarish && fill >= 0.74 && fill < 0.86 };
}

/**
 * The brand's colours: the hues of every colourful pixel (glows included), in twelve bins, the strongest up to
 * four, each as the average colour of its bin. Empty for a brand with no colour.
 */
export function brandColours(img: Rgba, max = 4): string[] {
  const { rgba, w, h } = img;
  const bins = Array.from({ length: 12 }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  for (let i = 0; i < w * h; i += 3) {
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!;
    if (!colourful(r, g, b)) continue;
    const bin = bins[Math.floor(hsv(r, g, b).h / 30) % 12]!;
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    total++;
  }
  if (total < (w * h) / 3 / 400) return [];
  return bins
    .filter((x) => x.n >= total * 0.06)
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((x) => hex(x.r / x.n, x.g / x.n, x.b / x.n));
}

function decode(file: string, at?: number, signal?: AbortSignal, maxWidth = 960): Promise<Rgba> {
  return new Promise((done, fail) => {
    const probe = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { ...(signal ? { signal } : {}) });
    let size = "";
    probe.stdout.on("data", (c) => (size += c));
    probe.on("error", fail);
    probe.on("close", () => {
      const [w0, h0] = size.trim().split(",").map(Number);
      if (!w0 || !h0) return fail(new Error(`ffprobe couldn't read ${file}`));
      // Analysed at most 960 px wide: enough for objects, quick enough for a stage. Cut-outs read it whole.
      const k = Math.min(1, maxWidth / w0);
      const w = Math.round(w0 * k);
      const h = Math.round(h0 * k);
      const args = ["-v", "error", ...(at !== undefined ? ["-ss", String(at)] : []), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"];
      const child = spawn("ffmpeg", args, { ...(signal ? { signal } : {}) });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.on("error", fail);
      child.on("close", (code) => (code === 0 ? done({ rgba: new Uint8Array(Buffer.concat(chunks)), w, h }) : fail(new Error(`ffmpeg couldn't read ${file}`))));
    });
  });
}

/**
 * One object cut out as a PNG: its own pixels and the holes inside them (anything the box's edge can't reach
 * without crossing it), found on the analysed picture and cut from the full-resolution one, the mask smoothed up.
 */
async function cutObject(img: Rgba, full: Rgba, f: Found & { id: number }, seen: Int32Array, out: string, signal?: AbortSignal) {
  const [x0, y0, bw, bh] = f.box;
  const pad = 2;
  const X = Math.max(0, x0 - pad), Y = Math.max(0, y0 - pad);
  const W = Math.min(img.w - X, bw + pad * 2), H = Math.min(img.h - Y, bh + pad * 2);
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) inside[y * W + x] = seen[(Y + y) * img.w + X + x] === f.id ? 1 : 0;
  // Flood the background in from the edge; whatever it can't reach is the object.
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (outside[p] || inside[p]) continue;
    outside[p] = 1;
    const x = p % W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (p >= W) stack.push(p - W);
    if (p < W * (H - 1)) stack.push(p + W);
  }
  // The mask, read at full resolution by bilinear sampling (smooth edges), the colour from the full picture.
  const k = full.w / img.w;
  const FX = Math.round(X * k), FY = Math.round(Y * k);
  const FW = Math.min(full.w - FX, Math.round(W * k)), FH = Math.min(full.h - FY, Math.round(H * k));
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : outside[y * W + x] ? 0 : 1);
  const px = Buffer.alloc(FW * FH * 4);
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const sx = (x + 0.5) / k - 0.5, sy = (y + 0.5) / k - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const a = alpha(ix, iy) * (1 - fx) * (1 - fy) + alpha(ix + 1, iy) * fx * (1 - fy) + alpha(ix, iy + 1) * (1 - fx) * fy + alpha(ix + 1, iy + 1) * fx * fy;
      const p = ((FY + y) * full.w + FX + x) * 4;
      const q = (y * FW + x) * 4;
      px[q] = full.rgba[p]!;
      px[q + 1] = full.rgba[p + 1]!;
      px[q + 2] = full.rgba[p + 2]!;
      // A smooth ramp across the upscaled edge, so it doesn't step.
      const e = Math.min(1, Math.max(0, (a - 0.1) / 0.8));
      px[q + 3] = Math.round(255 * e * e * (3 - 2 * e));
    }
  await new Promise<void>((done, fail) => {
    // The mask's steps (it was found at the analysed size) blurred away at full size.
    const smooth = `split[c][m];[m]alphaextract,gblur=sigma=${Math.max(0.6, k * 0.9).toFixed(2)}[a];[c][a]alphamerge`;
    const child = spawn("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${FW}x${FH}`, "-i", "-", "-filter_complex", smooth, out], { stdio: ["pipe", "ignore", "pipe"], ...(signal ? { signal } : {}) });
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error("ffmpeg couldn't write the cut-out"))));
    child.stdin.end(px);
  });
  return { w: FW, h: FH };
}

export type ImageryObject = { file: string; w: number; h: number; colour: string; round: boolean };

const rgbOf = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
/** Whether two found objects are the same thing seen twice: close in colour and size. */
export function sameObject(a: { colour: string; w: number; h: number }, b: { colour: string; w: number; h: number }) {
  const [r1, g1, b1] = rgbOf(a.colour);
  const [r2, g2, b2] = rgbOf(b.colour);
  const d = Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  const size = Math.max(a.w, b.w) / Math.min(a.w, b.w);
  return d < 40 && size < 1.5;
}

/** Merges colour lists from several pictures: each colour once (close ones count as one), the most common first. */
export function mergeColours(lists: string[][], max = 4): string[] {
  const out: { c: string; n: number }[] = [];
  for (const list of lists)
    for (const c of list) {
      const hit = out.find((o) => {
        const [r1, g1, b1] = rgbOf(o.c);
        const [r2, g2, b2] = rgbOf(c);
        return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 48;
      });
      if (hit) hit.n++;
      else out.push({ c, n: 1 });
    }
  return out.sort((a, b) => b.n - a.n).slice(0, max).map((o) => o.c);
}

/**
 * The brand imagery in one or more pictures (a page capture, or frames of a recording at `at`): its objects,
 * each cut out once however many frames show it, the biggest first, and the colours of the whole set.
 */
export async function imageryOf(o: { file: string; at?: number | number[]; dir: string; rel: string; prefix: string; max?: number; signal?: AbortSignal }): Promise<{ objects: ImageryObject[]; colours: string[] }> {
  await mkdir(o.dir, { recursive: true });
  const times = Array.isArray(o.at) ? o.at : [o.at];
  const found: { img: Rgba; f: Found & { id: number }; seen: Int32Array; at: number | undefined }[] = [];
  const colours: string[][] = [];
  for (const at of times) {
    if (o.signal?.aborted) break;
    let img: Rgba;
    try {
      img = await decode(o.file, at, o.signal);
    } catch {
      continue; // past the end, or a frame that won't decode
    }
    const { objects, seen } = components(img);
    colours.push(brandColours(img));
    for (const f of objects) {
      const me = { colour: f.colour, w: f.box[2], h: f.box[3] };
      const twin = found.findIndex((x) => sameObject(me, { colour: x.f.colour, w: x.f.box[2], h: x.f.box[3] }));
      if (twin < 0) found.push({ img, f, seen, at });
      else if (found[twin]!.f.area < f.area) found[twin] = { img, f, seen, at }; // the fuller view of it
    }
  }
  const keep = found.sort((a, b) => b.f.area - a.f.area).slice(0, o.max ?? 5);
  const out: ImageryObject[] = [];
  const fulls = new Map<number | undefined, Rgba>();
  for (const { img, f, seen, at } of keep) {
    if (o.signal?.aborted) break;
    if (!fulls.has(at)) fulls.set(at, await decode(o.file, at, o.signal, Infinity));
    const full = fulls.get(at)!;
    // Too few real pixels to be enlarged on a 1080p frame without going soft.
    if (f.box[2] * (full.w / img.w) < 120) continue;
    const name = `${o.prefix}-${out.length + 1}.png`;
    const size = await cutObject(img, full, f, seen, join(o.dir, name), o.signal);
    out.push({ file: `${o.rel}/${name}`, w: size.w, h: size.h, colour: f.colour, round: f.round });
  }
  return { objects: out, colours: mergeColours(colours) };
}

/**
 * The brand kit's imagery from several sources (page captures, the hero, recording frames): each object once,
 * whole round ones first, then the biggest, and the colours of them all. Earlier kit imagery is kept first.
 */
export async function collectImagery(o: {
  sources: { file: string; at?: number | number[]; from: "page" | "recording" }[];
  dir: string;
  rel: string;
  max?: number;
  have?: { imagery: (ImageryObject & { from: "page" | "recording" })[]; colours: string[] };
  signal?: AbortSignal;
}): Promise<{ imagery: (ImageryObject & { from: "page" | "recording" })[]; colours: string[] }> {
  const found: (ImageryObject & { from: "page" | "recording" })[] = [...(o.have?.imagery ?? [])];
  const colours: string[][] = o.have?.colours.length ? [o.have.colours] : [];
  for (const [i, s] of o.sources.entries()) {
    if (o.signal?.aborted) break;
    try {
      const r = await imageryOf({ file: s.file, ...(s.at !== undefined ? { at: s.at } : {}), dir: o.dir, rel: o.rel, prefix: `${s.from}-${String(i + 1).padStart(2, "0")}`, max: 6, ...(o.signal ? { signal: o.signal } : {}) });
      colours.push(r.colours);
      for (const obj of r.objects) if (!found.some((f) => sameObject(f, obj))) found.push({ ...obj, from: s.from });
    } catch {
      // A source that won't decode adds nothing.
    }
  }
  const ranked = found.sort((a, b) => Number(b.round) - Number(a.round) || b.w * b.h - a.w * a.h).slice(0, o.max ?? 6);
  // The objects' own colours lead (they're what the film shows), then the pictures' strongest.
  const own = mergeColours([ranked.map((r) => r.colour)]);
  return { imagery: ranked, colours: mergeColours([own, own, ...colours]) };
}
