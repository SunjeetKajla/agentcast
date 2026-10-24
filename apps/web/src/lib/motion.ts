"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

gsap.registerPlugin(ScrollTrigger, Flip, useGSAP);
// Selectors that match nothing yet (a section still loading) are expected here, not mistakes.
gsap.config({ nullTargetWarn: false });

export { Flip, gsap, ScrollTrigger, useGSAP };

// Motion tokens (taste skill, references/motion.md §4): strong ease-outs for arrivals, in-out for
// things that travel while visible, durations by how often something is seen.
export const EASE = {
  /** Entrances and UI moves under 600 ms (quint out). */
  out: "power4.out",
  /** Reveals of 800 ms and longer, line rises, openings. */
  expo: "expo.out",
  /** Wipes and things that travel while visible. */
  inOut: "power4.inOut",
} as const;

export const DUR = { press: 0.14, ui: 0.24, reveal: 0.8, open: 1.2 } as const;
export const STAGGER = { line: 0.09, item: 0.07 } as const;

// Where every entrance ends: fully visible and in place.
const SETTLED: Record<string, number> = { autoAlpha: 1, opacity: 1, x: 0, y: 0, xPercent: 0, yPercent: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 };

/**
 * from() vars → explicit [from, to] for gsap.fromTo(). from() reads its end state from the DOM, so if an
 * effect runs twice (React Strict Mode, a re-render) it can capture the hidden start state and animate
 * hidden → hidden. With explicit ends, an entrance always finishes visible.
 */
export function settle(vars: gsap.TweenVars): [gsap.TweenVars, gsap.TweenVars] {
  const from: gsap.TweenVars = {};
  const to: gsap.TweenVars = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key in SETTLED) {
      from[key] = value;
      to[key] = SETTLED[key];
    } else if (key === "transformOrigin") {
      from[key] = value;
      to[key] = value;
    } else {
      to[key] = value;
    }
  }
  return [from, to];
}

/** Everything that moves only moves under this query; the finished state is the reduced-motion state. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

/**
 * Children marked data-reveal rise into place as they enter (top at 88% of the viewport), once,
 * staggered in reading order. With reduced motion they are simply there.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      if (!scope.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-reveal]", scope.current);
        if (!items.length) return;
        gsap.set(items, { autoAlpha: 0, y: 24 });
        ScrollTrigger.batch(items, {
          start: "top 88%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { autoAlpha: 1, y: 0, duration: DUR.reveal, ease: EASE.expo, stagger: STAGGER.item, overwrite: true }),
        });
      });
      return () => mm.revert();
    },
    // No `scope` here: the ref can still be empty (a page loading), and the selector is scoped above.
    { dependencies: deps, revertOnUpdate: true },
  );
}
