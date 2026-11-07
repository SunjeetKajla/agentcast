"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VideoMode } from "@agentcast/shared";
import { gsap } from "@/lib/motion";
import { outputsOf, useComposer } from "./composer";

// "Try a link": the link set large, the shape of the plan the agents bring back (examples, clearly
// marked), and the button that starts the real job with these settings.

type Plan = { brief: string; flows: [string, number, number, boolean][]; generic?: boolean };
const PLANS: Record<string, Plan> = {
  "todomvc.com": {
    brief: "A to-do list app, built the same way in many frameworks.",
    flows: [["Add three todos and tick one off", 9, 92, true], ["Filter by Active, then Completed", 8, 88, true], ["Rename a todo in place", 7, 81, true], ["Read the framework list on the home page", 6, 34, false]],
  },
  "excalidraw.com": {
    brief: "A virtual whiteboard for sketching hand-drawn diagrams.",
    flows: [["Draw a box and an arrow", 12, 94, true], ["Label it in the hand-drawn font", 10, 86, true], ["Export the drawing as a PNG", 8, 79, true], ["Open the keyboard shortcuts", 5, 41, false]],
  },
  "localhost:3001": {
    brief: "Demoboard: a content workspace with templates, drafts and analytics.",
    flows: [["Sign in with the demo login", 7, 90, true], ["Start a project from a template", 12, 93, true], ["Generate a draft and edit it", 15, 89, true], ["Reset the workspace", 6, 22, false]],
  },
};
const EXAMPLES = ["todomvc.com", "excalidraw.com", "localhost:3001"];
const KINDS: { mode: VideoMode; label: string }[] = [
  { mode: "launch", label: "Launch" },
  { mode: "tutorial", label: "Tutorial" },
  { mode: "sales", label: "Sales demo" },
];

const clean = (v: string) => v.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function planFor(v: string): Plan & { host: string } {
  const host = clean(v) || "your-product.com";
  const known = PLANS[host.toLowerCase()];
  if (known) return { host, ...known };
  return {
    host, generic: true,
    brief: `What ${host} does, in one line, read from its landing page.`,
    flows: [["Sign up and reach the first screen", 11, 0, true], ["Make the first thing the product is for", 14, 0, true], ["Share or export the result", 9, 0, true], ["Change account settings", 6, 0, false]],
  };
}

export default function TryLink() {
  const { link, setLink, prompt, setPrompt, choices, set, start, busy, error } = useComposer();
  const [shown, setShown] = useState(link || "todomvc.com");
  const mirror = useRef<HTMLSpanElement>(null), caret = useRef<HTMLSpanElement>(null), input = useRef<HTMLInputElement>(null);
  const cut = useRef<HTMLDivElement>(null);
  const typing = useRef(0);

  // The hero hands its link over: type it into the line.
  useEffect(() => {
    if (link && clean(link) !== clean(shown)) void typeInto(link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  useLayoutEffect(() => {
    if (!mirror.current || !caret.current || !input.current) return;
    mirror.current.textContent = shown || " ";
    const w = Math.min(mirror.current.getBoundingClientRect().width, input.current.clientWidth - 4);
    caret.current.style.left = `${w + 6}px`;
  }, [shown]);

  const p = planFor(shown);
  const picked = p.flows.filter((f) => f[3]);
  const music = !choices.voiceover;
  const beats: [string, number, boolean][] = music
    ? [["Hook", 3, true], ...picked.map((f): [string, number, boolean] => [f[0], Math.round(f[1] * 0.7), false]), ["Logo", 3, true]]
    : [["Title", 4, true], ...picked.map((f): [string, number, boolean] => [f[0], f[1] + 3, false]), ["End card", 4, true]];
  const total = beats.reduce((a, b) => a + b[1], 0);
  const outs = outputsOf(choices);
  const stem = p.host.split(/[.:]/)[0];
  const planKey = `${p.host}|${music}|${choices.mode}`;

  useEffect(() => {
    if (!cut.current || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    gsap.from(cut.current.children, { scaleX: 0, duration: 0.7, ease: "expo.out", stagger: 0.05 });
  }, [planKey]);

  async function typeInto(text: string) {
    const me = ++typing.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setShown(text); return; }
    let cur = input.current?.value ?? "";
    while (cur.length) { if (me !== typing.current) return; cur = cur.slice(0, -1); setShown(cur); await new Promise((r) => setTimeout(r, 22)); }
    for (const ch of text) { if (me !== typing.current) return; cur += ch; setShown(cur); await new Promise((r) => setTimeout(r, 48)); }
  }

  return (
    <section className="try" id="try" aria-labelledby="try-h">
      <div className="wrap">
        <div className="try-head">
          <h2 className="head" id="try-h" data-rise>Try a link</h2>
          <p data-rise>
            Type your product’s address. Below is the shape of the plan the agents bring back; the example plans are only
            examples. Press the button and a real run explores your site.
          </p>
        </div>
        <div className="try-line" data-ui data-rise>
          <label htmlFor="try-url" className="sr">Product link</label>
          <input
            ref={input}
            id="try-url"
            type="text"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            value={shown}
            onChange={(e) => { typing.current++; setShown(e.target.value); }}
            onBlur={() => setLink(shown)}
          />
          <span ref={caret} className="caret" aria-hidden="true" />
          <span ref={mirror} className="mirror" aria-hidden="true" />
        </div>
        <div className="try-ex" data-rise>
          <span>Or try</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => void typeInto(ex)}>{ex}</button>
          ))}
        </div>

        <div className="plan" data-ui data-rise aria-live="polite">
          <div>
            <h3>Product brief · {p.host}</h3>
            <p className="brief">{p.brief}</p>
            <ol className="flows">
              {p.flows.map((f) => (
                <li key={f[0]} className={`flow ${f[3] ? "" : "is-out"}`}>
                  <span className="tick" aria-hidden="true"><i className="ck" /></span>
                  <span>
                    {f[0]}
                    <small>{f[3] ? (p.generic ? "Would be tried by an agent" : `Judge score ${f[2]}`) : p.generic ? "Usually left out" : `Left out · judge score ${f[2]}`}</small>
                  </span>
                  <span className="t">{fmt(f[1])}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3>The cut · {music ? "music-led" : "narrated"} · {fmt(total)}</h3>
            <div className="cut" ref={cut} key={planKey}>
              {beats.map((b) => (
                <div key={b[0]} className={b[2] ? "c-card" : ""} style={{ flex: b[1] }}>{b[0]}</div>
              ))}
            </div>
            <h3 style={{ marginTop: 24 }}>{outs.length} {outs.length === 1 ? "video" : "videos"}, recorded in Live</h3>
            <ul className="outs">
              {outs.map((o) => (
                <li key={o.id}><span>{stem}-{o.size.replace(":", "x")}-{o.lang.slice(0, 2).toLowerCase()}.mp4</span><span>{o.dims} · {o.lang}</span></li>
              ))}
            </ul>
            <p className="plan-note">{p.generic ? "A typical plan. The agents find the real flows on your site." : "An example plan. Real runs differ by site and by day."}</p>
          </div>
        </div>

        <form
          className="try-go"
          data-rise
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setLink(shown);
            void start(shown, prompt.trim());
          }}
        >
          <fieldset className="kinds">
            <legend className="sr">Kind of video</legend>
            {KINDS.map((k) => (
              <button
                key={k.mode}
                type="button"
                aria-pressed={choices.mode === k.mode}
                onClick={() => set({ mode: k.mode, voiceover: k.mode === "tutorial" })}
              >
                {k.label}
              </button>
            ))}
          </fieldset>
          <label htmlFor="try-prompt" className="sr">Anything about the video</label>
          <input
            id="try-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Anything about the video? Like “punchy, 30 s, for developers”"
          />
          <button type="submit" className="btn btn-dark magnet" disabled={busy}>
            {busy ? "Starting…" : "Make this video"} <span className="arr" aria-hidden="true">→</span>
          </button>
          {error && <p className="form-err" role="alert">{error}</p>}
        </form>
      </div>
    </section>
  );
}
