"use client";

import type { ComposerChoices } from "@/lib/compose";
import { outputsOf, sayOutputs, useComposer } from "./composer";

// "Choose what comes out": every band is a real job setting, and the plan above and the job you start
// follow them.

type Band = {
  id: string;
  sentence: string;
  consequence: string;
  color: string;
  ink: string;
  on: (c: ComposerChoices) => boolean;
  toggle: (c: ComposerChoices) => Partial<ComposerChoices>;
};

const BANDS: Band[] = [
  {
    id: "hindi", sentence: "Narrate it in Hindi as well.", consequence: "2 languages. A script, voice and captions for each, timed word by word.",
    color: "var(--pink)", ink: "var(--black)",
    on: (c) => c.langs.includes("hi"),
    toggle: (c) => ({ langs: c.langs.includes("hi") ? ["en"] : ["en", "hi"] }),
  },
  {
    id: "vertical", sentence: "Cut a vertical 9:16 for Reels.", consequence: "Every language also renders at 1080 × 1920, reframed around the action.",
    color: "var(--yellow)", ink: "var(--black)",
    on: (c) => c.aspects.includes("9x16"),
    toggle: (c) => ({ aspects: c.aspects.includes("9x16") ? ["16x9"] : ["16x9", "9x16"] }),
  },
  {
    id: "music", sentence: "Let the music set the pace.", consequence: "No voice. The track’s beats set every cut and big type carries the words.",
    color: "var(--blue)", ink: "var(--white)",
    on: (c) => !c.voiceover,
    toggle: (c) => ({ voiceover: !c.voiceover }),
  },
  {
    id: "studio", sentence: "Film it frame by frame.", consequence: "An even 30 fps on slow or busy sites. Slower to record.",
    color: "var(--yellow)", ink: "var(--black)",
    on: (c) => c.studio,
    toggle: (c) => ({ studio: !c.studio }),
  },
  {
    id: "gates", sentence: "Let me approve each gate.", consequence: "3 gates: the flows, the script, the preview. Off runs on autopilot.",
    color: "var(--white)", ink: "var(--black)",
    on: (c) => !c.autopilot,
    toggle: (c) => ({ autopilot: !c.autopilot }),
  },
  {
    id: "login", sentence: "It needs a login to show.", consequence: "A Chrome window opens on the worker’s machine. Sign in once; your password stays in Chrome.",
    color: "var(--blue-soft)", ink: "var(--black)",
    on: (c) => c.auth === "sign-in-once",
    toggle: (c) => ({ auth: c.auth === "sign-in-once" ? "public" : "sign-in-once" }),
  },
];

export default function Switches() {
  const { choices, set } = useComposer();
  const outs = outputsOf(choices);

  return (
    <section className="switches" id="outputs" aria-labelledby="sw-h">
      <div className="wrap">
        <h2 className="head" id="sw-h" data-rise>Choose what comes out</h2>
        <p data-rise>Every switch here is a real job setting. The plan above and the video you start follow them.</p>
      </div>
      {BANDS.map((b) => {
        const on = b.on(choices);
        return (
          <div key={b.id} className={`band ${on ? "is-on" : ""}`} style={{ ["--band" as string]: b.color, ["--band-ink" as string]: b.ink }}>
            <div className="wrap band-in">
              <div>
                <p className="band-s" id={`sw-${b.id}`}>{b.sentence}</p>
                <p className="band-c">{b.consequence}</p>
              </div>
              <button
                type="button"
                className="sw"
                role="switch"
                aria-checked={on}
                aria-labelledby={`sw-${b.id}`}
                onClick={() => set(b.toggle(choices))}
              >
                <span className="knob" />
              </button>
            </div>
          </div>
        );
      })}
      <p className="wrap sw-sum" aria-live="polite">
        This setup renders <b>{outs.length} {outs.length === 1 ? "video" : "videos"}</b>: {sayOutputs(choices)}.{" "}
        {choices.autopilot ? "It runs start to finish on autopilot." : "You approve the flows, the script and the preview."}
      </p>
    </section>
  );
}
