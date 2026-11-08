/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Brand } from "@agentcast/shared";
import type { RecorderBrowser } from "@agentcast/recorder";
import { pickLogo } from "./brand";
import { evaluateInPage } from "./evaluate";
import { svgProblems } from "./logokit";

/** Render the chosen mark as pixels, preserving computed SVG paints without saving active markup. */
export async function captureLogo(
  page: RecorderBrowser["page"],
  dir: string,
): Promise<Brand["logo"]> {
  const candidates = await evaluateInPage(page, () => {
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
      await sharpLogo(page, box, join(dir, "brief/logo.png")).catch(() =>
        element.screenshot({
          path: join(dir, "brief/logo.png"),
          animations: "disabled",
        }),
      );
      // The vector as well, when the logo is one: cleaned in the page to shapes and gradients, with every
      // paint resolved, then checked again here. Nothing else of the page's markup survives.
      if (candidate.from === "inline-svg" || /\.svg(\?|$)/i.test(candidate.src)) {
        const svg = await element
          .evaluate((node) => node.setAttribute("data-agentcast-logo", "1"))
          .then(() => evaluateInPage(page, cleanLogoSvg))
          .catch(() => undefined);
        if (svg && !svgProblems(svg).length) await writeFile(join(dir, "brief/logo.svg"), svg);
      }
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

/** The logo at four times its size, since end cards show it big, whatever the page's pixel density. */
async function sharpLogo(page: RecorderBrowser["page"], box: { x: number; y: number; width: number; height: number }, file: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const shot = (await session.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 4 },
    })) as { data: string };
    await writeFile(file, Buffer.from(shot.data, "base64"));
  } finally {
    await session.detach().catch(() => {});
  }
}

/**
 * In the page: the marked logo (an inline <svg>, or an <img> of an .svg file) rebuilt from an allowlist of
 * shape and gradient elements and attributes, with fills and strokes resolved to the colours the page computed.
 */
async function cleanLogoSvg(): Promise<string | undefined> {
  const marked = document.querySelector("[data-agentcast-logo]");
  if (!marked) return undefined;
  marked.removeAttribute("data-agentcast-logo");
  const box = marked.getBoundingClientRect();
  let svg: SVGSVGElement | undefined;
  let detached: Element | undefined;
  if (marked instanceof SVGSVGElement) svg = marked;
  else if (marked instanceof HTMLImageElement) {
    const text = await fetch(marked.currentSrc || marked.src).then((r) => r.text());
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    if (!(parsed instanceof SVGSVGElement)) return undefined;
    parsed.setAttribute("style", `position:fixed;left:-9999px;top:0;width:${box.width}px;height:${box.height}px`);
    document.body.appendChild(parsed);
    svg = parsed;
    detached = parsed;
  }
  if (!svg) return undefined;
  const SHAPES = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "defs", "lineargradient", "radialgradient", "stop"]);
  const ATTRS = ["id", "d", "points", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "fx", "fy", "transform", "fill-rule", "clip-rule", "opacity", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform"];
  const clean = (node: Element): string => {
    const tag = node.tagName.toLowerCase();
    if (!SHAPES.has(tag)) return "";
    const attrs = ATTRS.filter((a) => node.hasAttribute(a)).map((a) => `${a}="${node.getAttribute(a)!.replace(/[^\w\s.,#%()+-]/g, "")}"`);
    if (!["svg", "g", "defs", "lineargradient", "radialgradient", "stop"].includes(tag)) {
      const style = getComputedStyle(node);
      // A gradient fill keeps its reference to a gradient inside the logo; anything else is resolved.
      attrs.push(`fill="${/^url\(["']?#/.test(style.fill) ? style.fill.replace(/["']/g, "") : style.fill}"`);
      if (style.stroke && style.stroke !== "none") attrs.push(`stroke="${style.stroke}"`, `stroke-width="${style.strokeWidth}"`);
    }
    const inner = [...node.children].map(clean).join("");
    const name = tag === "lineargradient" ? "linearGradient" : tag === "radialgradient" ? "radialGradient" : tag;
    return tag === "svg" ? inner : `<${name} ${attrs.join(" ")}>${inner}</${name}>`;
  };
  const viewBox = (svg.getAttribute("viewBox") ?? `0 0 ${box.width} ${box.height}`).replace(/[^\d\s.,-]/g, "");
  const body = clean(svg);
  detached?.remove();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
}
