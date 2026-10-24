"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef } from "react";
import { motion } from "framer-motion";
import { MOTION_OK, gsap, useGSAP, settle } from "@/lib/motion";

// The five cards that frame the hero. Each floats on its own loop (framer-motion), and a GSAP layer
// around it drifts at its own depth as the hero scrolls away, so the cards part like a camera pushing in.
const CARDS = [
  { src: "photo-1618005182384-a83a8bd57fbe", pos: "left-[8%] top-[10%]", box: "w-44 h-64 -rotate-12", float: -12, dur: 7, delay: 0, depth: 1.1, x: -60 },
  { src: "photo-1550745165-9bc0b252726f", pos: "left-[3%] top-[38%]", box: "w-60 h-36 -rotate-6", float: 10, dur: 6, delay: 1, depth: 0.6, x: -90 },
  { src: "photo-1507238691740-187a5b1d37b8", pos: "left-[10%] bottom-[12%]", box: "w-40 h-56 rotate-6", float: -8, dur: 8, delay: 0.5, depth: 0.9, x: -50 },
  { src: "photo-1555066931-4365d14bab8c", pos: "right-[8%] top-[12%]", box: "w-44 h-64 rotate-12", float: 12, dur: 7.5, delay: 1.5, depth: 1.2, x: 60 },
  { src: "photo-1558494949-ef010cbdcc31", pos: "right-[6%] bottom-[16%]", box: "w-64 h-40 -rotate-6", float: -10, dur: 6.5, delay: 2, depth: 0.7, x: 90 },
];

export default function FloatingPreviewCards() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const layers = gsap.utils.toArray<HTMLElement>("[data-depth]", root.current);
        // Arrive: each card settles from slightly further out, after the headline has started.
        gsap.fromTo(layers, ...settle({ autoAlpha: 0, scale: 0.92, duration: 1.2, ease: "expo.out", stagger: 0.08, delay: 0.3 }));
        // Scroll: locked to the scrollbar (no smoothing), each at its own depth.
        for (const layer of layers) {
          const depth = Number(layer.dataset.depth);
          gsap.to(layer, {
            yPercent: -60 * depth,
            x: Number(layer.dataset.x),
            rotate: Number(layer.dataset.x) > 0 ? 6 : -6,
            ease: "none",
            scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
          });
        }
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden lg:block select-none">
      {CARDS.map((card) => (
        <div key={card.src} data-depth={card.depth} data-x={card.x} className={`absolute ${card.pos}`}>
          <motion.div
            animate={{ y: [0, card.float, 0] }}
            transition={{ y: { duration: card.dur, repeat: Infinity, ease: "easeInOut", delay: card.delay } }}
            className={`pointer-events-auto relative overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/80 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md transition-all duration-500 hover:rotate-0 hover:scale-105 ${card.box}`}
          >
            <img
              src={`https://images.unsplash.com/${card.src}?q=80&w=600&auto=format&fit=crop`}
              alt=""
              className="h-full w-full object-cover filter brightness-75 contrast-125"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          </motion.div>
        </div>
      ))}
    </div>
  );
}
