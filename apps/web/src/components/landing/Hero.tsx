"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { startHero } from "@/lib/particles";
import ComposerSettings from "./ComposerSettings";
import { useComposer } from "./composer";

export default function Hero() {
  const hero = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const swish = useRef<SVGPathElement>(null);
  const statement = useRef<HTMLHeadingElement>(null);
  const l1 = useRef<HTMLSpanElement>(null), l2 = useRef<HTMLSpanElement>(null);
  const w1 = useRef<HTMLSpanElement>(null), w2 = useRef<HTMLSpanElement>(null);
  const { start, busy, error, prompt } = useComposer();
  const [text, setText] = useState("");

  useEffect(
    () =>
      startHero({
        hero: hero.current!, canvas: canvas.current!, swish: swish.current!, statement: statement.current!,
        line1: l1.current!, line2: l2.current!, wrap1: w1.current!, wrap2: w2.current!,
      }),
    [],
  );

  return (
    <section ref={hero} className="hero" id="top" aria-labelledby="hero-h">
      <canvas ref={canvas} className="hero-canvas" aria-hidden="true" />
      <svg className="swish" aria-hidden="true"><path ref={swish} d="" /></svg>
      <div className="hero-in wrap">
        <header className="hero-top">
          <a className="wordmark" href="#top">AgentCast</a>
          <nav aria-label="Page">
            <a href="#how">How it works</a>
            <a href="#try">Try a link</a>
            <Link href="/jobs">Your videos</Link>
          </nav>
        </header>
        <h1 ref={statement} className="statement lines" id="hero-h">
          <span ref={w1} className="line l1"><span ref={l1} data-line style={{ ["--i" as string]: 0 }}>link in.</span></span>
          <span ref={w2} className="line l2"><span ref={l2} data-line style={{ ["--i" as string]: 1 }}>video out.</span></span>
        </h1>
        <div className="hero-foot">
          <p className="hero-sub">
            AgentCast turns your product’s link into a demo video. Web agents explore it, film the flows worth showing at 60
            fps and cut a narrated edit.
          </p>
          <div className="hero-act">
            <form
              className="hero-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void start(text, prompt.trim());
              }}
            >
              <label htmlFor="hero-url" className="sr">Your product’s link</label>
              <input
                id="hero-url"
                name="url"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="your-product.com"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn btn-ink magnet" type="submit" disabled={busy}>
                {busy ? "Starting…" : "Make the video"} <span className="arr" aria-hidden="true">→</span>
              </button>
            </form>
            <ComposerSettings promptId="hero-prompt" />
            {error && <p className="form-err" role="alert">{error}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
