"use client";

import type Lenis from "lenis";

// The landing page's smooth scroll, shared so anchors and buttons go through Lenis when it runs.

let lenis: Lenis | null = null;
export const setLenis = (l: Lenis | null) => {
  lenis = l;
};
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function scrollToEl(el: HTMLElement | null, immediate = false) {
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.4, immediate });
  else el.scrollIntoView({ behavior: immediate || reduced() ? "auto" : "smooth" });
}

export function scrollToY(y: number) {
  if (lenis) lenis.scrollTo(y, { duration: 1.2 });
  else scrollTo({ top: y, behavior: reduced() ? "auto" : "smooth" });
}
