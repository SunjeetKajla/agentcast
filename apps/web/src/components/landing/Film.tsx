"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, ScrollTrigger } from "@/lib/motion";
import { startFilm } from "@/lib/particles";
import { scrollToY } from "./scroll";

// "How a link becomes a video": the section holds still while you scroll through five chapters, and the
// particles take each stage's shape.

const CHAPTERS = [
  { h: "Understand", lead: "It reads your site first.", body: "TinyFish Fetch reads the landing page and docs. AgentCast writes a product brief and a creative brief: who the video is for and what it has to prove.", cap: "Landing page and docs read · product and creative brief written" },
  { h: "Explore", lead: "Agents walk the product.", body: "Up to three TinyFish agents try flows side by side. Every flow they report is rehearsed in a local Chrome before you see it, and a judge picks the ones worth showing.", cap: "Up to 3 agents at once · every flow rehearsed locally · judged" },
  { h: "Record", lead: "Filmed at 60 fps, for real.", body: "A Playwright recorder replays each approved flow in a local Chromium. When a button moves, its locator heals; when a page stalls, the take is shot again.", cap: "60 fps · 1920 × 1080 · locators heal, stalled takes are redone" },
  { h: "Direct", lead: "A coding agent cuts it.", body: "Claude Code writes the script, times every cut to the voice and checks the edit with a motion lint. Ask for a change in plain words and it revises.", cap: "Cuts timed to the voice or the beat · motion lint · revisions in plain words" },
  { h: "Render", lead: "Every size, every language.", body: "HyperFrames renders 16:9 and 9:16 in English and Hindi, with captions that light up word by word as the voice speaks them.", cap: "16:9 and 9:16 · English and Hindi · captions word by word" },
];

export default function Film() {
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const chapters = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const film = useRef<ReturnType<typeof startFilm> | null>(null);
  const trigger = useRef<ScrollTrigger | null>(null);

  useEffect(() => {
    film.current = startFilm(section.current!, canvas.current!);
    trigger.current = ScrollTrigger.create({
      trigger: section.current!,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (s) => setI(Math.min(4, Math.floor(s.progress * 5 * 0.999))),
    });
    return () => {
      film.current?.stop();
      trigger.current?.kill();
    };
  }, []);

  useEffect(() => {
    film.current?.show(i);
    const art = chapters.current?.children[i];
    if (art && matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      gsap.fromTo(art.children, { y: 36, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, ease: "expo.out", stagger: 0.07, overwrite: true });
    }
  }, [i]);

  const go = (k: number) => {
    const t = trigger.current;
    if (t) scrollToY(t.start + (t.end - t.start) * ((k + 0.5) / 5));
    else setI(k);
  };

  return (
    <section ref={section} className="film" id="how" aria-labelledby="film-h">
      <div className="film-stage wrap">
        <div className="film-copy">
          <h2 id="film-h">How a link becomes a video</h2>
          <div className="chapters" ref={chapters}>
            {CHAPTERS.map((c, k) => (
              <article key={c.h} className={`chapter ${k === i ? "is-on" : ""}`}>
                <h3>{c.h}</h3>
                <p className="lead">{c.lead}</p>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
          <ol className="ch-nav" aria-label="Pipeline stages">
            {CHAPTERS.map((c, k) => (
              <li key={c.h}>
                <button type="button" aria-current={k === i ? "step" : undefined} onClick={() => go(k)}>{c.h}</button>
              </li>
            ))}
          </ol>
        </div>
        <figure className="film-art">
          <canvas ref={canvas} aria-hidden="true" />
          <figcaption className="film-cap">{CHAPTERS[i]!.cap}</figcaption>
        </figure>
      </div>
    </section>
  );
}
