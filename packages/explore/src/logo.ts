/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Brand } from "@agentcast/shared";
import type { RecorderBrowser } from "@agentcast/recorder";
import { pickLogo } from "./brand";

/** Render the chosen mark as pixels, preserving computed SVG paints without saving active markup. */
export async function captureLogo(
  page: RecorderBrowser["page"],
  dir: string,
): Promise<Brand["logo"]> {
  const candidates = await page.evaluate(() => {
    const shown = (element: Element) =>
      element.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      }) && element.getBoundingClientRect().width > 4;
    const details = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        named: /logo|brand/i.test(
          [
            element.getAttribute("src"),
            element.getAttribute("alt"),
            element.getAttribute("class"),
            element.id,
            element.getAttribute("aria-label"),
            element.querySelector("title")?.textContent,
            element.closest("a")?.getAttribute("aria-label"),
          ].join(" "),
        ),
        top:
          Boolean(element.closest("header,nav,[role=banner]")) ||
          rect.top < 160,
      };
    };
    const result: Array<{
      from: "img" | "inline-svg" | "background" | "apple-touch-icon" | "icon";
      src: string;
      width: number;
      height: number;
      named: boolean;
      top: boolean;
      index: number;
    }> = [];
    [...document.images].forEach((element, index) => {
      if (shown(element))
        result.push({
          ...details(element),
          from: "img",
          src: element.currentSrc || element.src,
          index,
        });
    });
    [...document.querySelectorAll("svg")].forEach((element, index) => {
      const info = details(element);
      if (
        shown(element) &&
        (info.named || info.top) &&
        info.width >= 24 &&
        info.height >= 12
      )
        result.push({
          ...info,
          from: "inline-svg",
          src: `inline-${index}.svg`,
          index,
        });
    });
    [...document.querySelectorAll("[class*=logo], [id*=logo]")].forEach(
      (element, index) => {
        if (!shown(element)) return;
        const match = /url\(["']?([^"')]+)["']?\)/.exec(
          getComputedStyle(element).backgroundImage,
        );
        if (match)
          result.push({
            ...details(element),
            from: "background",
            src: new URL(match[1]!, location.href).href,
            index,
          });
      },
    );
    [
      ...document.querySelectorAll<HTMLLinkElement>(
        'link[rel~="apple-touch-icon"],link[rel~="icon"]',
      ),
    ].forEach((element, index) => {
      const touch = element.rel.includes("apple");
      const size =
        Number(element.sizes.value.split("x")[0]) ||
        (touch ? 180 : /\.svg(\?|$)/i.test(element.href) ? 64 : 0);
      result.push({
        from: touch ? "apple-touch-icon" : "icon",
        src: element.href,
        width: size,
        height: size,
        named: false,
        top: false,
        index,
      });
    });
    return result.slice(0, 150);
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const picked = pickLogo(candidates);
    if (!picked) return undefined;
    const candidate = candidates.find((value) => value === picked)!;
    candidates.splice(candidates.indexOf(candidate), 1);
    let temporary: string | undefined;
    try {
      let element;
      if (candidate.from === "img")
        element = page.locator("img").nth(candidate.index);
      else if (candidate.from === "inline-svg")
        element = page.locator("svg").nth(candidate.index);
      else if (candidate.from === "background")
        element = page
          .locator("[class*=logo], [id*=logo]")
          .nth(candidate.index);
      else {
        if (!/^https?:|^data:image\//i.test(candidate.src)) continue;
        temporary = `agentcast-logo-${randomUUID()}`;
        await page.evaluate(
          ({ src, id }) => {
            const image = document.createElement("img");
            image.id = id;
            image.src = src;
            image.style.cssText =
              "position:fixed;top:0;left:0;max-width:300px;max-height:200px;z-index:2147483647;pointer-events:none";
            document.body.append(image);
          },
          { src: candidate.src, id: temporary },
        );
        element = page.locator(`#${temporary}`);
        await element.waitFor({ state: "visible", timeout: 5000 });
        if (
          !(await element.evaluate(
            (node) =>
              (node as HTMLImageElement).complete &&
              (node as HTMLImageElement).naturalWidth > 0,
          ))
        ) {
          await element.evaluate(async (node) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                (node as HTMLImageElement).decode(),
                new Promise((_, reject) => {
                  timer = setTimeout(
                    () => reject(new Error("Logo load timeout")),
                    4000,
                  );
                }),
              ]);
            } finally {
              if (timer) clearTimeout(timer);
            }
          });
        }
      }
      const box = await element.boundingBox();
      if (!box || box.width < 4 || box.height < 4) continue;
      await element.screenshot({
        path: join(dir, "brief/logo.png"),
        animations: "disabled",
      });
      return {
        file: "brief/logo.png",
        width: box.width,
        height: box.height,
        from: candidate.from,
        plate:
          candidate.from === "apple-touch-icon" || candidate.from === "icon",
      };
    } catch {
      /* A failed asset does not prevent trying the next available mark. */
    } finally {
      if (temporary)
        await page
          .locator(`#${temporary}`)
          .evaluate((node) => node.remove())
          .catch(() => {});
    }
  }
  return undefined;
}
