"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { scrollToEl } from "./scroll";

/* ───────── Ways to film: a large table, one second of frames per mode ───────── */

const ROWS: [string, string, string, string][] = [
  ["How it films", "A screencast of a real browser on your machine", "Frame by frame, with time paused between frames", "State by state in a hosted browser"],
  ["Speed", "Real time", "Parallel chunks across workers", "About 300 ms per round trip"],
  ["When a page stalls", "Caught, then shot again automatically", "Can’t happen: the clock waits", "Each state is captured once settled"],
  ["Best for", "Every job, unless something below applies", "Heavy animation or a slow machine", "Sites a local browser can’t reach"],
  ["How you get it", "Every job uses it", "agentcast record --mode studio", "Used when local Chrome can’t film"],
];

export function Modes() {
  const strips = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = strips.current!;
    const all = Array.from(table.querySelectorAll<HTMLElement>(".fps")).map((el) => {
      const n = Number(el.dataset.fps);
      el.innerHTML = "<i></i>".repeat(n);
      return { n, ticks: Array.from(el.children) };
    });
    const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false, raf = 0, alive = true;
    const io = new IntersectionObserver((e) => { visible = Boolean(e[0]?.isIntersecting); });
    io.observe(table);
    const frame = (now: number) => {
      if (!alive) return;
      if (visible || RM) {
        const t = RM ? 0.999 : (now % 2000) / 2000;
        for (const s of all) { const k = Math.floor(t * s.n); s.ticks.forEach((tk, i) => tk.classList.toggle("on", i <= k)); }
      }
      if (!RM) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); io.disconnect(); };
  }, []);

  const head = [
    ["Live", "60 fps", "local Chromium · default", 60],
    ["Studio", "60 fps", "on our virtual clock · opt-in", 60],
    ["Fallback", "4–6 fps", "TinyFish remote browser", 5],
  ] as const;

  return (
    <section className="modes" id="modes" aria-labelledby="modes-h">
      <div className="wrap table-scroll">
        <table className="modes-t" ref={strips}>
          <thead>
            <tr>
              <th scope="col"><h2 id="modes-h">Ways to film</h2></th>
              {head.map(([n, fps, q, f], i) => (
                <th key={n} scope="col" className={i === 0 ? "is-pick" : ""}>
                  <span className="pn">{n}</span><span className="pp">{fps}</span><span className="pq">{q}</span>
                  <span className="fps" data-ui data-fps={f} aria-label={`${f} frames in one second`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, ...cells]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {cells.map((c, i) => <td key={i} className={i === 0 ? "is-pick" : ""}>{label === "How you get it" && i === 1 ? <code>{c}</code> : c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ───────── FAQ ───────── */

const QA: [string, string][] = [
  ["Do I need an API key for the AI?", "No. The writing and directing run through the Claude Code or Codex CLI you’re already logged into. The only keys are for TinyFish, which explores, and ElevenLabs, which speaks."],
  ["Which sites can it record?", "Sites you own or are allowed to demo. AgentCast doesn’t solve CAPTCHAs and won’t try to get past one."],
  ["What about pages behind a login?", "Turn on “It needs a login to show”. A normal Chrome window opens on the worker’s machine, you log in, then press “I’m signed in”. The recorder keeps a sealed session and the agents get their own profile."],
  ["Will passwords end up in the video?", "No. Anything typed into a secret field is stored as redacted and never reaches a prompt, a log, a caption or a frame of footage."],
  ["What happens when our UI changes?", "Run agentcast rerun on the job. It films the approved flows again, heals any locators that moved, reports what changed and carries the script, voice and edit over to the new footage."],
  ["Can I change the edit myself?", "At the preview gate, describe the change in plain words, like “hold longer on the dashboard”. The director revises the edit and checks it again before it renders."],
];

export function Faq() {
  return (
    <section className="faq" id="faq" aria-labelledby="faq-h">
      <div className="wrap">
        <h2 id="faq-h" data-rise>Before you paste a link</h2>
        <div className="faq-list">
          {QA.map(([q, a], i) => (
            <details key={q} data-rise open={i === 0}>
              <summary>{q}<span className="chev" aria-hidden="true" /></summary>
              <p className="ans">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────── Closing ───────── */

export function Cta() {
  return (
    <section className="cta wrap" id="start" aria-labelledby="cta-h">
      <h2 id="cta-h" className="cl" aria-label="Your link, or ours?"><span id="cl1" style={{ display: "inline-block" }}>Your link</span></h2>
      <div className="cta-mid">
        <svg className="cta-swish" aria-hidden="true" viewBox="0 0 1000 400" preserveAspectRatio="none">
          <path id="cta-path" d="M -40 110 C 120 50, 250 370, 500 345 S 870 60, 1040 130" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="cta-row">
          <button
            type="button"
            className="btn btn-go magnet"
            onClick={() => {
              scrollToEl(document.getElementById("top"));
              setTimeout(() => document.getElementById("hero-url")?.focus({ preventScroll: true }), 1200);
            }}
          >
            Make a video
          </button>
          <span className="or">or</span>
          <a href="#watch" className="btn btn-ink magnet">Watch a sample run</a>
        </div>
        <p>Making one opens its live job page. The sample plays a whole run in about a minute.</p>
      </div>
      <p className="cl" aria-hidden="true"><span id="cl2" style={{ display: "inline-block" }}>or ours?</span></p>
    </section>
  );
}

/* ───────── Footer curtain ───────── */

export function SiteFooter() {
  return (
    <footer className="foot wrap" id="foot">
      <div className="foot-cols">
        <div><h2>The page</h2><ul><li><a href="#how">How it works</a></li><li><a href="#try">Try a link</a></li><li><a href="#modes">Ways to film</a></li><li><a href="#faq">Questions</a></li></ul></div>
        <div><h2>Made with</h2><ul><li>TinyFish agents</li><li>Playwright and Chromium</li><li>Claude Code or Codex</li><li>ElevenLabs and HyperFrames</li></ul></div>
        <div><h2>Runs on</h2><ul><li>Your machine</li><li>Your logged-in coding agent</li><li>Node 22, Chrome and ffmpeg</li></ul></div>
        <div><h2>Your work</h2><ul><li><Link href="/jobs">Your videos</Link></li><li><a href="#top">Make a video</a></li></ul></div>
      </div>
      <div />
      <svg className="foot-mark" viewBox="0 0 1000 205" aria-label="AgentCast" role="img">
        <text x="-6" y="180" fontSize="262" textLength="1006" lengthAdjust="spacingAndGlyphs">AgentCast</text>
      </svg>
      <p className="foot-legal"><span>Only record sites you own or are allowed to demo.</span><span>AgentCast runs on your machine.</span></p>
    </footer>
  );
}
