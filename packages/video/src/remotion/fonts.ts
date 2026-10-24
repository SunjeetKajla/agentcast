import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

// The brand's own fonts (PRD §9.7.3), loaded from Google Fonts while a frame renders.

/** A CSS font stack that starts with the brand's family; Devanagari covers Hindi. */
export const fontStack = (family: string) =>
  `"${family}", Inter, "Noto Sans", "Noto Sans Devanagari", "Helvetica Neue", Arial, sans-serif`;

const loading = new Map<string, Promise<void>>();

/**
 * Adds a Google Fonts family to the page (weights 400–800, or whatever it has) and waits until the
 * browser has its faces. Gives up after 10 s, so a family Google doesn't serve falls back to the stack.
 */
function loadFamily(family: string): Promise<void> {
  let promise = loading.get(family);
  if (!promise) {
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    const css = (query: string) =>
      fetch(`https://fonts.googleapis.com/css2?family=${name}${query}&display=block`).then((r) =>
        r.ok ? r.text() : Promise.reject(new Error(`Google Fonts: ${r.status}`)),
      );
    promise = Promise.race([
      css(":wght@400;500;600;700;800")
        .catch(() => css(""))
        .then(async (text) => {
          const style = document.createElement("style");
          style.textContent = text;
          document.head.appendChild(style);
          await Promise.all(
            ["400", "600", "700"].map((w) => document.fonts.load(`${w} 32px "${family}"`).catch(() => [])),
          );
        }),
      new Promise<void>((done) => setTimeout(done, 10_000)),
    ]).catch(() => undefined);
    loading.set(family, promise);
  }
  return promise;
}

/** Holds the frame until the families have loaded (or given up). */
export function useFonts(families: string[]) {
  const [handle] = useState(() => delayRender(`fonts: ${families.join(", ")}`, { timeoutInMilliseconds: 30_000 }));
  useEffect(() => {
    void Promise.all([...new Set(families)].map(loadFamily)).finally(() => continueRender(handle));
    // Loaded once per page; the families don't change during a render.
  }, []);
}
