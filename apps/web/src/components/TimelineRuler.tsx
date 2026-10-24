"use client";

import { useRef } from "react";
import { MOTION_OK, ScrollTrigger, gsap, useGSAP, settle } from "@/lib/motion";

// An editor's ruler under the hero. Its playhead and timecode are locked to the scroll: scrolling the
// hero away plays the first minute of the timeline.
const SECONDS = 60;

const timecode = (s: number) => `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function TimelineRuler() {
  const ticks = Array.from({ length: 80 });
  const root = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const hero = root.current?.closest("section");
        if (!hero || !head.current) return;
        const state = { p: 0 };
        const render = () => {
          // Inset 2% at each end so the timecode label never hangs off the ruler.
          gsap.set(head.current, { left: `${2 + state.p * 96}%` });
          if (code.current) code.current.textContent = timecode(state.p * SECONDS);
        };
        gsap.to(state, {
          p: 1,
          ease: "none",
          onUpdate: render,
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true },
        });
        // Ticks brighten in sequence once, as if the clip just loaded.
        gsap.fromTo("[data-tick]", ...settle({ opacity: 0, duration: 0.4, stagger: 0.008, ease: "power4.out", delay: 0.6 }));
        ScrollTrigger.refresh();
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="w-full overflow-x-clip pt-8 pb-3 select-none pointer-events-none">
      <div className="relative mx-auto max-w-6xl px-4">
        <div className="relative flex items-end justify-between opacity-30 [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
          {ticks.map((_, i) => {
            const isMajor = i % 10 === 0;
            const isMedium = i % 5 === 0 && !isMajor;
            return (
              <div
                key={i}
                data-tick
                className={`w-[1px] bg-white ${isMajor ? "h-4 opacity-70" : isMedium ? "h-2.5 opacity-40" : "h-1.5 opacity-20"}`}
              />
            );
          })}
        </div>
        {/* Playhead: hidden until the scroll drives it (motion off: it never appears). */}
        <div ref={head} className="absolute bottom-0 left-[2%] hidden motion-safe:block" aria-hidden>
          <div className="relative -translate-x-1/2">
            <span ref={code} className="absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-accent/80">
              {timecode(0)}
            </span>
            <div className="mx-auto h-5 w-[2px] rounded-full bg-accent shadow-[0_0_10px_rgba(139,92,246,0.7)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
