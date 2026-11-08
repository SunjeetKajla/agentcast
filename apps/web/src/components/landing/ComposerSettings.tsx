"use client";

import { useId, useState } from "react";
import type { VideoMode } from "@agentcast/shared";
import type { ComposerChoices } from "@/lib/compose";
import { useComposer } from "./composer";

// Everything a job can be asked for, under the hero's link box: the video prompt in plain sight, and the
// rest behind one line that reads the plan back ("A launch video, 16:9 and 9:16 in English…"). The same
// choices drive "Try a link" and the switch bands further down.

type Opt<T> = { value: T; label: string };
const KINDS: Opt<VideoMode>[] = [
  { value: "launch", label: "Launch" },
  { value: "tutorial", label: "Tutorial" },
  { value: "sales", label: "Sales demo" },
];

function Seg<T extends string | boolean>({
  label, options, isOn, onPick, hint,
}: { label: string; options: Opt<T>[]; isOn: (v: T) => boolean; onPick: (v: T) => void; hint?: string }) {
  return (
    <div className="cmp-row" role="group" aria-label={label}>
      <span className="cmp-l">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={isOn(o.value)} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="cmp-hint">{hint}</p>}
    </div>
  );
}

const KIND_NAME: Record<VideoMode, string> = { launch: "Launch video", tutorial: "Tutorial", sales: "Sales demo" };

/** Every setting, stated: "Launch video · music-led · 16:9 and 9:16 · English · public site · you approve each gate". */
export function summary(c: ComposerChoices): string[] {
  return [
    KIND_NAME[c.mode],
    c.voiceover ? "voiceover" : "music-led, no voice",
    c.aspects.map((a) => (a === "16x9" ? "16:9" : "9:16")).join(" and "),
    c.langs.map((l) => (l === "hi" ? "Hindi" : "English")).join(" and "),
    c.auth === "sign-in-once" ? "sign in once" : "public site",
    c.autopilot ? "autopilot" : "you approve each gate",
  ];
}

/** Toggle one value in a list that must keep at least one. */
function toggle<T>(list: T[], v: T): T[] {
  if (list.includes(v)) return list.length > 1 ? list.filter((x) => x !== v) : list;
  return [...list, v];
}

export default function ComposerSettings({ promptId }: { promptId: string }) {
  const { choices: c, set, prompt, setPrompt, focus, setFocus } = useComposer();
  const [open, setOpen] = useState(false);
  const panel = useId();
  const pick = (patch: Partial<ComposerChoices>) => set(patch);

  return (
    <div className="cmp">
      <label htmlFor={promptId} className="sr">Describe the video (optional)</label>
      <input
        id={promptId}
        className="cmp-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the video (optional): punchy, 30 s, for developers"
      />
      <button type="button" className="cmp-sum" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        <span className="cmp-chips">
          {summary(c).map((t) => <span key={t}>{t}</span>)}
        </span>
        <b>{open ? "Done" : "Settings"}</b>
      </button>
      {open && (
        <div className="cmp-panel" id={panel}>
          <Seg
            label="Kind"
            options={KINDS}
            isOn={(v) => c.mode === v}
            onPick={(v) => pick({ mode: v, voiceover: v === "tutorial" })}
          />
          <Seg
            label="Sound"
            options={[{ value: true, label: "Voiceover" }, { value: false, label: "Music-led, no voice" }]}
            isOn={(v) => c.voiceover === v}
            onPick={(v) => pick({ voiceover: v })}
            hint={c.voiceover ? "ElevenLabs reads a script; captions light up word by word." : "The track’s beats set every cut; big type carries the words."}
          />
          <Seg
            label="Sizes"
            options={[{ value: "16x9", label: "16:9" }, { value: "9x16", label: "9:16" }]}
            isOn={(v) => c.aspects.includes(v as "16x9")}
            onPick={(v) => pick({ aspects: toggle(c.aspects, v as "16x9" | "9x16") })}
          />
          <Seg
            label="Languages"
            options={[{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }]}
            isOn={(v) => c.langs.includes(v as "en")}
            onPick={(v) => pick({ langs: toggle(c.langs, v as "en" | "hi") })}
          />
          <Seg
            label="Sign-in"
            options={[{ value: "public", label: "Public site" }, { value: "sign-in-once", label: "Sign in once" }]}
            isOn={(v) => c.auth === v}
            onPick={(v) => pick({ auth: v as "public" | "sign-in-once" })}
            hint={
              c.auth === "sign-in-once"
                ? "When the job starts, a Chrome window opens on the worker’s machine. Sign in there, then press “I’m signed in” on the job page. Your password stays in Chrome."
                : undefined
            }
          />
          <Seg
            label="Review"
            options={[{ value: false, label: "I approve each gate" }, { value: true, label: "Autopilot" }]}
            isOn={(v) => c.autopilot === v}
            onPick={(v) => pick({ autopilot: v })}
            hint={c.autopilot ? "Flows, script and preview are approved for you." : "You approve the flows, the script and the preview."}
          />
          <div className="cmp-row">
            <label className="cmp-l" htmlFor={`${promptId}-focus`}>Focus</label>
            <input
              id={`${promptId}-focus`}
              className="cmp-focus"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Optional: the feature to show off, like “the analytics dashboard”"
            />
          </div>
        </div>
      )}
    </div>
  );
}
