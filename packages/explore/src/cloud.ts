/// <reference lib="dom" />
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrandKit } from "@agentcast/shared";
import type { RecorderBrowser } from "@agentcast/recorder";
import { evaluateInPage } from "./evaluate";
import { cutOut } from "./logokit";

// The logo cloud (docs/BRAND_MOTION_PLAN.md §3): other companies' logos the site shows in a row, an
// "Integrates with" or "Trusted by" strip. They're other companies' marks, so a film uses them only when the
// person allows it (JobConfig.thirdPartyLogos); capturing them costs nothing and decides nothing.

type Found = { boxes: { x: number; y: number; w: number; h: number }[]; kind: "integrations" | "customers" | "unknown" };

/** In the page: the best row of five or more similar logos, and what the text around it says they are. */
function findCloud(): Found | undefined {
  const items = [...document.querySelectorAll("img, svg")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 24 && r.width <= 260 && r.height >= 12 && r.height <= 90 && !el.closest("header, nav, footer, button, a[href='/']");
  });
  const rows = new Map<number, Element[]>();
  for (const el of items) {
    const r = el.getBoundingClientRect();
    const key = Math.round((r.top + window.scrollY + r.height / 2) / 24);
    rows.set(key, [...(rows.get(key) ?? []), el]);
  }
  let best: Element[] = [];
  for (const row of rows.values()) {
    const heights = row.map((el) => el.getBoundingClientRect().height).sort((a, b) => a - b);
    const median = heights[heights.length >> 1] ?? 0;
    const alike = row.filter((el) => Math.abs(el.getBoundingClientRect().height - median) <= median * 0.6);
    if (alike.length > best.length) best = alike;
  }
  if (best.length < 5) return undefined;
  const section = best[0]!.closest("section, div[class*=logo], div[class*=customer], div[class*=integration]") ?? best[0]!.parentElement?.parentElement;
  const text = (section?.textContent ?? "").toLowerCase().slice(0, 600);
  const kind = /integrat|connect|works with|plugs into|apps you use/.test(text) ? "integrations" : /trusted|customers|used by|loved by|companies|teams at|powering/.test(text) ? "customers" : "unknown";
  return {
    kind,
    boxes: best.slice(0, 12).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    }),
  };
}

/** Captures the page's logo cloud, each logo at 3×: brief/logos/NN.png. Empty when the page has none. */
export async function captureCloud(page: RecorderBrowser["page"], dir: string): Promise<BrandKit["cloud"]> {
  const found = await evaluateInPage(page, findCloud);
  if (!found) return [];
  await mkdir(join(dir, "brief", "logos"), { recursive: true });
  const session = await page.context().newCDPSession(page);
  const out: BrandKit["cloud"] = [];
  try {
    for (const [i, b] of found.boxes.entries()) {
      try {
        const shot = (await session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          // With a margin of the page around it, so its background can be read and keyed out.
          clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.w + 16, height: b.h + 16, scale: 3 },
        })) as { data: string };
        const file = `brief/logos/${String(i + 1).padStart(2, "0")}.png`;
        await writeFile(join(dir, file), Buffer.from(shot.data, "base64"));
        // Keyed off the page colour it sat on, so it reads on any tile.
        if (await cutOut(join(dir, file), join(dir, `${file}.cut.png`)).catch(() => false)) await rename(join(dir, `${file}.cut.png`), join(dir, file));
        out.push({ file, kind: found.kind });
      } catch {
        // A logo that won't capture is left out.
      }
    }
  } finally {
    await session.detach().catch(() => {});
  }
  return out;
}
