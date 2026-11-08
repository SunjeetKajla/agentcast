// Checkpoint C (docs/BRAND_MOTION_PLAN.md §9): Sarvam's layers, captured by hand-written code the real
// capture (§3–§4) will replace.
//   - the header logo: its SVG cleaned to shapes if it has one, else a 4× capture; its letters from the gaps
//   - the text-to-speech page's hero at 2×, for the brand's orbs
//   - the product's own output: the Tamil line from job_mw6o12r65ef81c's recording, generated once more on
//     the public playground, with the audio the page receives saved
//   pnpm --filter @agentcast/spikes brand-capture-sarvam
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { chromium, type Page } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "output", "brand-sarvam", "layers");
const job = join(process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast"), "jobs", "job_mw6o12r65ef81c");
const PAGE = "https://www.sarvam.ai/apis/text-to-speech";
await mkdir(out, { recursive: true });

/** The Tamil line the recording typed, and the language and voice it chose. */
const timeline = JSON.parse(await readFile(join(job, "record", "desktop", "timeline.json"), "utf8")) as { events: { kind: string; value?: unknown }[] };
const typed = timeline.events.find((e) => e.kind === "type" && typeof e.value === "string")!.value as string;
const [language, voice] = timeline.events.filter((e) => e.kind === "select").map((e) => String(e.value));

/** Closes the cookie notice, so it isn't in any capture. */
async function dismiss(page: Page) {
  const accept = page.getByRole("button", { name: /accept all/i }).first();
  if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => {});
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  // The logo, at 4×: as an SVG when the header's logo is one (inline, or an <img> of an .svg).
  const big = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 });
  await big.addInitScript("window.__name = (f) => f");
  await big.goto(PAGE, { waitUntil: "load" });
  await big.waitForTimeout(1500);
  await dismiss(big);
  const found = await big.evaluate(async () => {
    const candidates = [...document.querySelectorAll("header a img, header a svg, nav a img, nav a svg, a[href='/'] img, a[href='/'] svg")] as (HTMLImageElement | SVGSVGElement)[];
    const logo = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      return r.top < 90 && r.left < 400 && r.width >= 40 && r.width <= 300;
    });
    if (!logo) return undefined;
    const r = logo.getBoundingClientRect();
    let svg: SVGSVGElement | undefined;
    if (logo instanceof SVGSVGElement) svg = logo;
    else if (/\.svg(\?|$)/i.test(logo.currentSrc || logo.src)) {
      const text = await fetch(logo.currentSrc || logo.src).then((res) => res.text());
      const parsed = new DOMParser().parseFromString(text, "image/svg+xml").documentElement as unknown as SVGSVGElement;
      // In the page, out of sight, so its computed paints can be read.
      parsed.setAttribute("style", "position:fixed;left:-9999px;top:0;width:" + r.width + "px;height:" + r.height + "px");
      document.body.appendChild(parsed);
      svg = parsed;
    }
    const box = { x: r.left, y: r.top, w: r.width, h: r.height };
    if (!svg) return { box };
    const SHAPES = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);
    const ATTRS = ["d", "points", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "transform", "fill-rule", "clip-rule", "opacity"];
    const clean = (node: Element): string => {
      const tag = node.tagName.toLowerCase();
      if (!SHAPES.has(tag)) return "";
      const style = getComputedStyle(node);
      const attrs = ATTRS.filter((a) => node.hasAttribute(a)).map((a) => `${a}="${node.getAttribute(a)!.replace(/"/g, "")}"`);
      if (tag !== "svg" && tag !== "g") {
        attrs.push(`fill="${style.fill.startsWith("url(") ? "currentColor" : style.fill}"`);
        if (style.stroke && style.stroke !== "none") attrs.push(`stroke="${style.stroke}"`, `stroke-width="${style.strokeWidth}"`);
      }
      const inner = [...node.children].map(clean).join("");
      return tag === "svg" ? inner : `<${tag} ${attrs.join(" ")}>${inner}</${tag}>`;
    };
    const vb = svg.getAttribute("viewBox") ?? `0 0 ${r.width} ${r.height}`;
    return { box, viewBox: vb, body: clean(svg) };
  });
  if (!found) throw new Error("No logo in the header");
  if (found.body !== undefined) {
    if (/<script|on\w+=|href=|url\(/i.test(found.body)) throw new Error("The cleaned logo still has active markup");
    await writeFile(join(out, "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${found.viewBox}">${found.body}</svg>`);
  }
  // Always a 4× capture as well: the letters are found from it, and it stands in for a raster-only logo.
  await big.screenshot({ path: join(out, "logo.png"), clip: { x: found.box.x, y: found.box.y, width: found.box.w, height: found.box.h }, omitBackground: true });
  const png = (await readFile(join(out, "logo.png"))).toString("base64");
  const ink = await big.evaluate(async (src) => {
    const img = new Image();
    img.src = "data:image/png;base64," + src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // Ink is any pixel far from the page's white: dark letters, or a coloured highlight.
    const cols: boolean[] = [];
    for (let x = 0; x < c.width; x++) {
      let on = false;
      for (let y = 0; y < c.height && !on; y++) {
        const i = (y * c.width + x) * 4;
        on = d[i + 3]! > 40 && 765 - d[i]! - d[i + 1]! - d[i + 2]! > 90;
      }
      cols.push(on);
    }
    return { cols, w: c.width, h: c.height };
  }, png);
  const letters: number[][] = [];
  let start = -1;
  ink.cols.forEach((on, x) => {
    if (on && start < 0) start = x;
    if ((!on || x === ink.cols.length - 1) && start >= 0) {
      if (x - start > 2) letters.push([start / ink.w, 0, (x - start) / ink.w, 1]);
      start = -1;
    }
  });
  await writeFile(join(out, "logo.json"), JSON.stringify({ vector: found.body !== undefined, width: found.box.w, height: found.box.h, letters }, null, 2));
  console.log(`logo: ${found.body !== undefined ? "vector" : "raster"}, ${found.box.w.toFixed(0)}×${found.box.h.toFixed(0)}, ${letters.length} letters`);
  await big.close();

  // The hero, with the brand's orbs, and the playground: generate the recorded Tamil line once, keeping
  // the audio the page receives.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(PAGE, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  await dismiss(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, "hero.png") });
  console.log("hero: hero.png");

  let audio: Buffer | undefined;
  let audioType = "";
  page.on("response", async (res) => {
    const type = res.headers()["content-type"] ?? "";
    try {
      if (/^audio\//.test(type)) {
        audio = await res.body();
        audioType = type;
      } else if (/json/.test(type) && res.request().method() === "POST") {
        const body = (await res.json()) as { audios?: string[]; audio?: string };
        const b64 = body.audios?.[0] ?? body.audio;
        if (b64) {
          audio = Buffer.from(b64, "base64");
          audioType = "audio/wav";
        }
      }
    } catch {}
  });
  await page.goto(`${PAGE}#playground`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await dismiss(page);
  const selects = page.locator("select");
  for (let i = 0; i < (await selects.count()); i++) {
    const options = await selects.nth(i).locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    if (language && options.includes(language)) await selects.nth(i).selectOption(language);
  }
  await page.waitForTimeout(400);
  for (let i = 0; i < (await selects.count()); i++) {
    const options = await selects.nth(i).locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    if (voice && options.includes(voice)) await selects.nth(i).selectOption(voice);
  }
  await page.locator("textarea").first().fill(typed);
  await page.getByRole("button", { name: /generate/i }).first().click();
  for (let i = 0; i < 60 && !audio; i++) await page.waitForTimeout(500);
  if (!audio) throw new Error("The playground returned no audio");
  const ext = /mpeg|mp3/.test(audioType) ? "mp3" : /ogg/.test(audioType) ? "ogg" : "wav";
  await writeFile(join(out, `voice.${ext}`), audio);
  await writeFile(join(out, "voice.json"), JSON.stringify({ text: typed, language, voice, file: `voice.${ext}`, type: audioType }, null, 2));
  console.log(`voice: voice.${ext} (${audioType}, ${audio.length} bytes) for "${typed.slice(0, 30)}…"`);
} finally {
  await browser.close();
}
