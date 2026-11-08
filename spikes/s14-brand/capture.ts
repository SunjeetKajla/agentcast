// Checkpoint B (docs/BRAND_MOTION_PLAN.md §9), step 1: the layers, captured by hand-written code the
// real capture (§3–§4) will replace.
//   - linear.app's logo as a cleaned SVG, with its mark and letters located
//   - viewport captures of linear.app's own pages, for the wall
//   - the board's columns and cards, read from a still of job_e2eled0001's recording
//   pnpm --filter @agentcast/spikes brand-capture
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { pixelColumns } from "@agentcast/video";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "output", "brand-checkpoint", "layers");
const job = join(here, "..", "output", "e2e", "jobs", "job_e2eled0001");
const SITE = "https://linear.app";
await mkdir(join(out, "pages"), { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // tsx names inner functions with a helper that doesn't exist in the page.
  await page.addInitScript("window.__name = (f) => f");
  await page.goto(SITE, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  // The logo: the header's home-link SVG, rebuilt from an allowlist of shape elements and attributes,
  // with every paint resolved to the colour the page computed. Nothing else of the page's markup survives.
  const logo = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll("header svg, nav svg, a[href='/'] svg")] as SVGSVGElement[];
    const svg = svgs.find((s) => {
      const r = s.getBoundingClientRect();
      return r.top < 90 && r.left < 400 && r.width >= 40 && r.width <= 300;
    });
    if (!svg) return undefined;
    const SHAPES = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);
    const ATTRS = ["d", "points", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "transform", "fill-rule", "clip-rule", "opacity"];
    const box = svg.getBoundingClientRect();
    const viewBox = svg.getAttribute("viewBox") ?? `0 0 ${box.width} ${box.height}`;
    const [, , vw] = viewBox.split(/[\s,]+/).map(Number);
    const unit = (vw ?? box.width) / box.width;
    const parts: { tag: string; box: number[] }[] = [];
    const clean = (node: Element): string => {
      const tag = node.tagName.toLowerCase();
      if (!SHAPES.has(tag)) return "";
      const style = getComputedStyle(node);
      const attrs = ATTRS.filter((a) => node.hasAttribute(a)).map((a) => `${a}="${node.getAttribute(a)!.replace(/"/g, "")}"`);
      if (tag !== "svg" && tag !== "g") {
        const fill = style.fill;
        attrs.push(`fill="${fill.startsWith("url(") ? "currentColor" : fill}"`);
        if (style.stroke && style.stroke !== "none") attrs.push(`stroke="${style.stroke}"`, `stroke-width="${style.strokeWidth}"`);
        const r = node.getBoundingClientRect();
        parts.push({ tag, box: [(r.left - box.left) * unit, (r.top - box.top) * unit, r.width * unit, r.height * unit] });
      }
      const inner = [...node.children].map(clean).join("");
      return tag === "svg" ? inner : `<${tag} ${attrs.join(" ")}>${inner}</${tag}>`;
    };
    const body = clean(svg);
    return { viewBox, width: box.width, height: box.height, body, parts };
  });
  if (!logo) throw new Error("No logo SVG in linear.app's header");
  if (/<script|on\w+=|href=|url\(/i.test(logo.body)) throw new Error("The cleaned logo still has active markup");
  // The mark is the parts left of the largest horizontal gap; the letters are the rest, left to right.
  const sorted = [...logo.parts].sort((a, b) => a.box[0]! - b.box[0]!);
  let split = 0;
  let widest = -Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.box[0]! - Math.max(...sorted.slice(0, i).map((p) => p.box[0]! + p.box[2]!));
    if (gap > widest) [widest, split] = [gap, i];
  }
  const union = (parts: { box: number[] }[]) => {
    const x0 = Math.min(...parts.map((p) => p.box[0]!));
    const y0 = Math.min(...parts.map((p) => p.box[1]!));
    return [x0, y0, Math.max(...parts.map((p) => p.box[0]! + p.box[2]!)) - x0, Math.max(...parts.map((p) => p.box[1]! + p.box[3]!)) - y0];
  };
  const mark = union(sorted.slice(0, split));
  // The letters: the wordmark is often one path, and cutting a path into its subpaths breaks the holes in
  // "e" and "a". So render the logo and find the columns with no ink, as a raster logo would need anyway.
  const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logo.viewBox}">${logo.body}</svg>`;
  const vbw = Number(logo.viewBox.split(/[\s,]+/)[2]);
  const ink = await page.evaluate(async ({ svg, from }) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = Math.round((1600 * img.naturalHeight) / img.naturalWidth) || 400;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, c.width, c.height);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const cols: boolean[] = [];
    for (let x = 0; x < c.width; x++) {
      let on = false;
      for (let y = 0; y < c.height && !on; y++) on = data[(y * c.width + x) * 4 + 3]! > 40;
      cols.push(on && x >= from * c.width);
    }
    return cols;
  }, { svg: cleanSvg, from: (mark[0]! + mark[2]!) / vbw });
  const letters: number[][] = [];
  let start = -1;
  ink.forEach((on, x) => {
    if (on && start < 0) start = x;
    if ((!on || x === ink.length - 1) && start >= 0) {
      letters.push([(start / ink.length) * vbw, 0, ((x - start) / ink.length) * vbw, Number(logo.viewBox.split(/[\s,]+/)[3])]);
      start = -1;
    }
  });
  await writeFile(join(out, "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logo.viewBox}">${logo.body}</svg>`);
  await writeFile(join(out, "logo.json"), JSON.stringify({ viewBox: logo.viewBox, width: logo.width, height: logo.height, mark, letters, parts: logo.parts.length }, null, 2));
  console.log(`logo: ${logo.parts.length} shapes, mark ${mark.map(Math.round)}, ${letters.length} letter shapes`);

  // The wall: the site's own pages, from its header and footer links.
  const links = await page.evaluate((site) => {
    const seen = new Set<string>();
    return [...document.querySelectorAll("header a[href], footer a[href]")]
      .map((a) => new URL((a as HTMLAnchorElement).href, site))
      .filter((u) => u.origin === new URL(site).origin && !/login|signup|sign-up|contact|legal|privacy|terms|security|dpa|careers|brand|download|docs/i.test(u.pathname))
      .map((u) => u.origin + u.pathname.replace(/\/$/, ""))
      .filter((u) => !seen.has(u) && (seen.add(u), true));
  }, SITE);
  const pages = [SITE, ...links.filter((u) => u !== SITE)].slice(0, 14);
  const shot: string[] = [];
  for (const [i, url] of pages.entries()) {
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(1800);
      const file = `pages/${String(i + 1).padStart(2, "0")}.jpg`;
      await page.screenshot({ path: join(out, file), type: "jpeg", quality: 82 });
      shot.push(file);
      console.log(`page ${file}: ${url}`);
    } catch (error) {
      console.log(`skipped ${url}: ${(error as Error).message.slice(0, 80)}`);
    }
  }
  await writeFile(join(out, "pages.json"), JSON.stringify(shot, null, 2));
} finally {
  await browser.close();
}

// The board, at 8.0 s of the recording: a still at full resolution, and its columns and cards read from
// the pixels (the board is drawn as an image, so the DOM doesn't have them).
const recording = join(job, "record", "desktop", "recording.mp4");
await exec("ffmpeg", ["-v", "error", "-y", "-ss", "8.0", "-i", recording, "-frames:v", "1", join(out, "board.png")]);
const W = 720;
const H = 450;
const { stdout } = await exec("ffmpeg", ["-v", "error", "-ss", "8.0", "-i", recording, "-frames:v", "1", "-vf", `scale=${W}:${H}:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { encoding: "buffer", maxBuffer: 1 << 24 });
const found = pixelColumns(new Uint8Array(stdout), W, H);
if (!found) throw new Error("No board columns found at 8.0 s");
const css = (r: number[]) => [Math.round(r[0]! * 1440), Math.round(r[1]! * 900), Math.round(r[2]! * 1440), Math.round(r[3]! * 900)];
const board = { columns: found.columns.map(css), cards: found.cards.map(css) };
await writeFile(join(out, "board.json"), JSON.stringify(board, null, 2));
console.log(`board: ${board.columns.length} columns, ${board.cards.length} cards`);
