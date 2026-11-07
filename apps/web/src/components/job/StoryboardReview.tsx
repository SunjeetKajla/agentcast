"use client";

import { useEffect, useRef, useState } from "react";
import { Script, Storyboard, jobPaths, type GateDecision } from "@agentcast/shared";
import { readArtifact } from "@/lib/api";
import { useArtifact } from "@/lib/useArtifact";
import { EASE, MOTION_OK, STAGGER, gsap, useGSAP, settle } from "@/lib/motion";

// Gate 2 (PRD §5.1, FR-53): every beat with its on-screen text, motion note and narration in each
// language, editable. A meter shows each line against its time budget.

/** Words per second the voice speaks (PRD §9.4, launch pace). */
const RATE: Record<string, number> = { en: 2.8, hi: 2.55 };
const LANG_NAME: Record<string, string> = { en: "English", hi: "Hindi · हिन्दी" };
const ROLE: Record<string, string> = {
  hook: "Hook",
  problem: "Problem",
  setup: "Setup",
  core: "Core",
  payoff: "Payoff",
  cta: "Call to action",
  headline: "Headline",
};

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

function Budget({ text, lang, maxSeconds }: { text: string; lang: string; maxSeconds: number }) {
  const budget = Math.max(1, Math.floor(maxSeconds * (RATE[lang] ?? 2.7)));
  const used = words(text);
  const ratio = used / budget;
  const tone = ratio > 1.25 ? "over" : ratio > 1 ? "tight" : "";
  return (
    <div className={`budget ${tone}`}>
      <span className="budget-bar"><i style={{ transform: `scaleX(${Math.min(1, ratio)})` }} /></span>
      <span>
        {used} of {budget} words · {maxSeconds.toFixed(1)} s{ratio > 1 ? " · too long for its shot" : ""}
      </span>
    </div>
  );
}

export default function StoryboardReview({
  jobId,
  langs,
  versions,
  onApprove,
}: {
  jobId: string;
  langs: string[];
  versions: Record<string, number>;
  onApprove: (decision: GateDecision<"gate-script">) => Promise<unknown>;
}) {
  const storyboard = useArtifact(jobId, jobPaths.storyboard, Storyboard, versions[jobPaths.storyboard]);
  const [scripts, setScripts] = useState<Record<string, Script>>();
  const [lines, setLines] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const root = useRef<HTMLElement>(null);
  const scriptVersions = langs.map((l) => versions[jobPaths.script(l)] ?? 0).join();

  useEffect(() => {
    let stale = false;
    Promise.all(langs.map((l) => readArtifact(jobId, jobPaths.script(l), Script, versions[jobPaths.script(l)])))
      .then((loaded) => {
        if (stale) return;
        const byLang = Object.fromEntries(loaded.map((s) => [s.lang, s]));
        setScripts(byLang);
        setLines(Object.fromEntries(loaded.flatMap((s) => s.segments.map((seg) => [`${s.lang}:${seg.beatId}`, seg.text]))));
      })
      .catch((err: Error) => !stale && setProblem(`Couldn't load the scripts: ${err.message}`));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, scriptVersions]);

  const ready = Boolean(storyboard.data && scripts);
  useGSAP(
    () => {
      if (!ready) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo("[data-beat]", ...settle({ autoAlpha: 0, y: 20, duration: 0.7, ease: EASE.expo, stagger: STAGGER.item }));
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [ready] },
  );

  if (storyboard.error) return <p className="field-err">Couldn’t load the storyboard: {storyboard.error}</p>;
  if (!storyboard.data || !scripts) return <p className="field-wait">{problem ?? "Loading the storyboard and the scripts…"}</p>;

  const approve = async () => {
    const edits = Object.entries(lines)
      .map(([key, text]) => {
        const [lang, beatId] = key.split(":") as [string, string];
        const original = scripts[lang]?.segments.find((s) => s.beatId === beatId)?.text;
        return { lang, beatId, text: text.trim(), changed: original !== undefined && original !== text.trim() };
      })
      .filter((e) => e.changed && e.text)
      .map(({ lang, beatId, text }) => ({ lang, beatId, text }));
    setSending(true);
    setProblem(undefined);
    try {
      await onApprove({ action: "approve", edits: edits.length ? edits : undefined });
    } catch (err) {
      setProblem((err as Error).message);
      setSending(false);
    }
  };

  const edited = Object.entries(lines).filter(([key, text]) => {
    const [lang, beatId] = key.split(":");
    return scripts[lang!]?.segments.find((s) => s.beatId === beatId)?.text !== text;
  }).length;

  return (
    <section ref={root} className="sb" aria-label="The script">
      <ol className="sb-list">
        {storyboard.data.beats.map((beat) => (
          <li key={beat.id} data-beat className="sb-beat">
            <div className="sb-head">
              <b>{ROLE[beat.role] ?? beat.role}</b>
              <span>{beat.motion.kind} · {beat.motion.emotion} · up to {beat.maxSeconds.toFixed(1)} s</span>
              {beat.onScreen.map((o) => <q key={o.text} className="sb-onscreen">{o.text}</q>)}
            </div>
            <div className={`sb-langs ${langs.length > 1 ? "two" : ""}`}>
              {langs.map((lang) => {
                const key = `${lang}:${beat.id}`;
                // A music-led film has no narration to read: its beats are their on-screen text.
                if (!lines[key]) return null;
                return (
                  <label key={lang} className="sb-line">
                    <span className="sb-lang">{LANG_NAME[lang] ?? lang}</span>
                    <textarea value={lines[key]} onChange={(e) => setLines({ ...lines, [key]: e.target.value })} rows={2} lang={lang} />
                    <Budget text={lines[key]!} lang={lang} maxSeconds={beat.maxSeconds} />
                  </label>
                );
              })}
            </div>
            <p className="sb-intent">{beat.intent}</p>
          </li>
        ))}
      </ol>
      <div className="rv-foot">
        <span className="rv-note">{edited ? `${edited} ${edited === 1 ? "line" : "lines"} edited` : "Edit any line, or approve it as it is."}</span>
        <span className="spacer" />
        <button type="button" className="ab ab-f" onClick={approve} disabled={sending}>
          {sending ? "Approving…" : edited ? `Approve with ${edited} ${edited === 1 ? "edit" : "edits"}` : "Approve the script"} <span className="arr" aria-hidden="true">→</span>
        </button>
      </div>
      {problem && <p className="field-err" role="alert">{problem}</p>}
    </section>
  );
}
