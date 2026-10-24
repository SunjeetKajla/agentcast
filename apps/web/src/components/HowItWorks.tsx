"use client";

import { useRef } from "react";
import { DUR, EASE, MOTION_OK, gsap, useGSAP, settle } from "@/lib/motion";

// The real pipeline (PRD §0), in the four moves a visitor needs. On wide screens the section holds
// while the scroll plays the pipeline step by step; elsewhere the steps simply arrive in order.
const steps = [
  { icon: "🔗", title: "Paste your link", desc: "Your product's URL, plus what kind of video you want, if you know." },
  { icon: "🤖", title: "Agents explore it", desc: "TinyFish web agents find the flows that show its value. You approve them." },
  { icon: "🎥", title: "Clean takes, filmed", desc: "Local Chrome replays each flow at 60 fps. A misclick means a retake." },
  { icon: "🎬", title: "Directed and rendered", desc: "Script, English and Hindi voice, Claude Code's edit, every format." },
];

export default function HowItWorks() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      const cards = gsap.utils.toArray<HTMLElement>("[data-step]", root.current);

      // Wide screens: a held stage. Each step lights up as the scroll reaches it, with the bar
      // across the top filling like a render, one screen per step at most.
      mm.add(`${MOTION_OK} and (min-width: 1024px)`, () => {
        gsap.set(cards, { autoAlpha: 0.25, scale: 0.96 });
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: { trigger: root.current, start: "center center", end: "+=140%", pin: true, scrub: true },
        });
        tl.fromTo("[data-step-bar]", ...settle({ scaleX: 0, transformOrigin: "left center", duration: cards.length }), 0);
        cards.forEach((card, i) => {
          tl.to(card, { autoAlpha: 1, scale: 1, borderColor: "rgba(139,92,246,0.5)", duration: 0.6 }, i);
          if (i > 0) tl.to(cards[i - 1]!, { borderColor: "rgba(255,255,255,0.08)", duration: 0.4 }, i);
        });
        gsap.fromTo("[data-step-head]", ...settle({
          autoAlpha: 0,
          y: 24,
          duration: DUR.reveal,
          ease: EASE.expo,
          scrollTrigger: { trigger: root.current, start: "top 85%", once: true },
        }));
      });

      // Narrow screens: the heading, then each step, as they enter.
      mm.add(`${MOTION_OK} and (max-width: 1023px)`, () => {
        for (const el of gsap.utils.toArray<HTMLElement>("[data-step-head], [data-step]", root.current)) {
          gsap.fromTo(el, ...settle({
            autoAlpha: 0,
            y: 24,
            duration: DUR.reveal,
            ease: EASE.expo,
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          }));
        }
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="mx-auto w-full max-w-5xl space-y-10">
      <div data-step-head className="text-center space-y-2">
        <h2 className="font-serif text-4xl font-normal tracking-tight text-white sm:text-5xl">How it works</h2>
        <p className="text-sm text-white/60">From a link to a finished, narrated video, with you approving each stage.</p>
      </div>

      <div className="relative">
        <div className="mb-6 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
          <div data-step-bar className="h-full w-full rounded-full bg-accent" />
        </div>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <li
              key={step.title}
              data-step
              className="group relative flex flex-col items-center rounded-2xl border border-border/80 bg-card/60 p-6 text-center backdrop-blur-md transition-colors hover:border-accent/50 hover:bg-card"
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/80 bg-gradient-to-br from-muted to-muted/30 text-3xl shadow-inner transition-transform duration-300 group-hover:scale-110">
                {step.icon}
              </div>
              <h3 className="mb-1 text-sm font-semibold text-foreground">{step.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{step.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
