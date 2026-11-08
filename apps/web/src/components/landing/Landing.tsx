"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { gsap, ScrollTrigger } from "@/lib/motion";
import { ComposerProvider } from "./composer";
import Hero from "./Hero";
import Film from "./Film";
import TryLink from "./TryLink";
import Switches from "./Switches";
import Watch from "./Watch";
import { Cta, Faq, Modes, SiteFooter } from "./Sections";
import { scrollToEl, setLenis } from "./scroll";

// The landing page: smooth scroll (Lenis) driving GSAP's ScrollTrigger, and the motion layer that
// brings each section in. Every section still reads complete with motion off.

export default function Landing() {
  useEffect(() => {
    const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lenis: Lenis | null = null;
    const tick = (t: number) => lenis?.raf(t * 1000);
    if (!RM) {
      lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      setLenis(lenis);
    }

    // In-page anchors glide through Lenis.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='#']");
      if (!a) return;
      const el = document.getElementById(a.getAttribute("href")!.slice(1));
      if (el) { e.preventDefault(); scrollToEl(el); history.replaceState(null, "", a.getAttribute("href")); }
    };
    document.addEventListener("click", onClick);

    const ctx = gsap.context(() => {
      if (RM) return;
      gsap.utils.toArray<HTMLElement>(".page > section").forEach((sec) => {
        const parts = sec.querySelectorAll("[data-rise]");
        if (parts.length) gsap.from(parts, { y: 28, autoAlpha: 0, duration: 0.9, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: sec, start: "top 78%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>(".band").forEach((b, i) =>
        gsap.from(b.querySelector(".band-in"), { x: i % 2 ? 60 : -60, autoAlpha: 0, duration: 1, ease: "expo.out", scrollTrigger: { trigger: b, start: "top 88%", once: true } }),
      );
      gsap.from(".modes-t tbody tr", { y: 24, autoAlpha: 0, duration: 0.8, ease: "expo.out", stagger: 0.07, scrollTrigger: { trigger: "#modes", start: "top 70%", once: true } });
      gsap.fromTo("#cl1", { xPercent: -28 }, { xPercent: 0, ease: "none", scrollTrigger: { trigger: "#start", start: "top bottom", end: "top 20%", scrub: 1 } });
      gsap.fromTo("#cl2", { xPercent: 28 }, { xPercent: 0, ease: "none", scrollTrigger: { trigger: "#start", start: "top bottom", end: "top 20%", scrub: 1 } });
      const cp = document.querySelector<SVGPathElement>("#cta-path");
      if (cp) {
        const l = cp.getTotalLength();
        gsap.fromTo(cp, { strokeDasharray: l, strokeDashoffset: l }, { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: "#start", start: "top 70%", end: "top top", scrub: 1 } });
      }
      gsap.to(".statement", { yPercent: -18, ease: "none", scrollTrigger: { trigger: "#top", start: "top top", end: "bottom top", scrub: true } });
      gsap.from(".foot-mark", { yPercent: 40, ease: "none", scrollTrigger: { trigger: "#start", start: "bottom bottom", end: "bottom top", scrub: true } });
      document.querySelectorAll<HTMLElement>(".magnet").forEach((m) => {
        const xTo = gsap.quickTo(m, "x", { duration: 0.5, ease: "power3.out" }), yTo = gsap.quickTo(m, "y", { duration: 0.5, ease: "power3.out" });
        m.addEventListener("pointermove", (e) => { const r = m.getBoundingClientRect(); xTo((e.clientX - r.left - r.width / 2) * 0.22); yTo((e.clientY - r.top - r.height / 2) * 0.3); });
        m.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
      });
    });

    // Arriving at /#something: go there once the layout has settled.
    const hash = location.hash.slice(1);
    const settle = setTimeout(() => {
      ScrollTrigger.refresh();
      if (hash && hash !== "top") scrollToEl(document.getElementById(hash), true);
    }, 300);

    return () => {
      clearTimeout(settle);
      document.removeEventListener("click", onClick);
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis?.destroy();
      setLenis(null);
    };
  }, []);

  return (
    <ComposerProvider>
      <div className="page" id="landing">
        <Hero />
        <Film />
        <TryLink />
        <Switches />
        <Watch />
        <Modes />
        <Faq />
        <Cta />
      </div>
      <SiteFooter />
    </ComposerProvider>
  );
}
