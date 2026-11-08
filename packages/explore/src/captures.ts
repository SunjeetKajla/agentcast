/// <reference lib="dom" />
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RecorderBrowser } from "@agentcast/recorder";
import { evaluateInPage } from "./evaluate";

// Page captures (docs/BRAND_MOTION_PLAN.md §3): viewport screenshots of the site's own pages, for walls of pages
// and mockup screens. Only pages on the site the person authorised, found from its header, nav and footer.

/** Paths not worth a frame: accounts, legal, jobs, downloads. */
const SKIP = /login|log-in|signin|sign-in|signup|sign-up|register|account|logout|legal|privacy|terms|cookie|security|dpa|careers|jobs|download|status|unsubscribe|contact|docs|documentation|help|support|community|developers|api-reference|reference|forum|press|brand/i;

/** Same-origin pages linked from the page's header, nav and footer, in page order, without repeats. */
export function pagesToCapture(links: string[], from: string, max = 8): string[] {
  const origin = new URL(from).origin;
  const seen = new Set<string>([new URL(from).origin + new URL(from).pathname.replace(/\/$/, "")]);
  const out: string[] = [];
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link, from);
    } catch {
      continue;
    }
    if (url.origin !== origin || SKIP.test(url.pathname) || /\.(pdf|zip|png|jpe?g|svg|mp4)$/i.test(url.pathname)) continue;
    const key = url.origin + url.pathname.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

/** Captures the page as it is, then up to `max` more of the site's pages: brief/captures/NN.jpg. */
export async function capturePages(
  page: RecorderBrowser["page"],
  dir: string,
  o: { max?: number; budgetMs?: number; signal?: AbortSignal } = {},
): Promise<{ file: string; url: string }[]> {
  await mkdir(join(dir, "brief", "captures"), { recursive: true });
  const start = page.url();
  const links = await evaluateInPage(page, () =>
    [...document.querySelectorAll<HTMLAnchorElement>("header a[href], nav a[href], footer a[href]")].map((a) => a.href),
  );
  const urls = [start, ...pagesToCapture(links, start, o.max ?? 8)];
  const deadline = Date.now() + (o.budgetMs ?? 60_000);
  const out: { file: string; url: string }[] = [];
  for (const [i, url] of urls.entries()) {
    if (Date.now() > deadline || o.signal?.aborted) break;
    try {
      if (i) await page.goto(url, { waitUntil: "load", timeout: 15_000 });
      await page.waitForTimeout(1200);
      await hideConsent(page).catch(() => undefined);
      const file = `brief/captures/${String(i + 1).padStart(2, "0")}.jpg`;
      await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 80, mask: [page.locator("input,textarea,[contenteditable=true]")] });
      out.push({ file, url: page.url() });
    } catch {
      // A page that won't load is left out; the others still count.
    }
  }
  return out;
}

/** Hides cookie and consent banners (pinned, about cookies or consent, with buttons, small) so they aren't in the frame. */
export function hideConsent(page: RecorderBrowser["page"]) {
  return evaluateInPage(page, () => {
    const consent = /\bcookies?\b|\bconsent\b|value your privacy/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hidden = new Set<Element>();
    while (walker.nextNode()) {
      if (!consent.test(walker.currentNode.textContent ?? "")) continue;
      let el: Element | null = walker.currentNode.parentElement;
      for (let depth = 0; el && el !== document.body && depth < 10; depth++, el = el.parentElement) {
        const position = getComputedStyle(el).position;
        if (position !== "fixed" && position !== "sticky") continue;
        if ((el.textContent ?? "").length < 1500 && el.querySelector("button,[role=button],a[href]")) hidden.add(el);
        break;
      }
    }
    for (const el of hidden) (el as HTMLElement).style.setProperty("display", "none", "important");
    return hidden.size;
  });
}
