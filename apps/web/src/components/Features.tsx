"use client";

import { useRef } from "react";
import { DUR, EASE, MOTION_OK, gsap, useGSAP, settle } from "@/lib/motion";

// What a team gets, from the README's feature list. The heading holds on the left while the list
// scrolls past it; each row's title rises out of a mask as it arrives.
const features = [
  { title: "Real footage only", desc: "Every product pixel comes from a real browser session. Overlays annotate; they never fabricate." },
  { title: "It finds the flows itself", desc: "Parallel agents propose and try flows, and a scoring rubric picks the ones that show value." },
  { title: "No misclicks on camera", desc: "Elements are found by what people see, each step's outcome is checked, and a bad take is redone." },
  { title: "Every variant from one run", desc: "16:9 and 9:16, English and Hindi, each retimed to its own voiceover." },
  { title: "You stay in the loop", desc: "Review the flows, the script and a preview you can revise with a sentence. Or go on autopilot." },
  { title: "Re-run on every release", desc: "Saved flows and self-healing element lookups regenerate the video after a UI change." },
];

export default function Features() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo("[data-feature-head]", ...settle({
          autoAlpha: 0,
          y: 24,
          duration: DUR.reveal,
          ease: EASE.expo,
          scrollTrigger: { trigger: root.current, start: "top 85%", once: true },
        }));
        for (const row of gsap.utils.toArray<HTMLElement>("[data-feature]", root.current)) {
          const tl = gsap.timeline({ scrollTrigger: { trigger: row, start: "top 88%", once: true } });
          tl.fromTo(row.querySelector("[data-feature-title]"), ...settle({ yPercent: 110, duration: 0.9, ease: EASE.expo }))
            .fromTo(row.querySelector("[data-feature-desc]"), ...settle({ autoAlpha: 0, y: 12, duration: 0.6, ease: EASE.out }), 0.12)
            .fromTo(row.querySelector("[data-feature-rule]"), ...settle({ scaleX: 0, transformOrigin: "left center", duration: 1.1, ease: EASE.inOut }), 0);
        }
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="grid w-full gap-12 lg:grid-cols-[2fr_3fr]">
      <div data-feature-head className="lg:sticky lg:top-32 lg:self-start space-y-4">
        <h2 className="font-serif text-4xl font-normal tracking-tight text-white sm:text-5xl">
          A demo video that <span className="italic font-light">stays true</span>
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-white/60">
          AgentCast uses your product the way a person would, films it cleanly, and cuts it like an editor.
          Nothing on screen is generated except the captions and callouts.
        </p>
      </div>

      <ul className="space-y-0">
        {features.map((f) => (
          <li key={f.title} data-feature className="group relative py-7">
            <div data-feature-rule className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" aria-hidden />
            <h3 className="line-mask font-serif text-2xl text-white transition-colors group-hover:text-accent">
              <span data-feature-title className="inline-block">
                {f.title}
              </span>
            </h3>
            <p data-feature-desc className="mt-2 max-w-lg text-sm leading-relaxed text-white/60">
              {f.desc}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
