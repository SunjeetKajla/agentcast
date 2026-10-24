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
const LANG_NAME: Record<string, string> = { en: "English", hi: "हिन्दी" };
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
  const color = ratio > 1.25 ? "bg-red-400" : ratio > 1 ? "bg-amber-400" : "bg-accent";
  return (
    <div className="flex items-center gap-2 text-[11px] text-white/45">
      <div className="h-1 w-24 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${color} transition-[width] duration-300`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <span className={ratio > 1 ? "text-amber-400" : ""}>
        {used}/{budget} words · {maxSeconds.toFixed(1)} s
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

  if (storyboard.error) return <p className="text-sm text-red-400">Couldn&apos;t load the storyboard: {storyboard.error}</p>;
  if (!storyboard.data || !scripts) return <p className="text-sm text-white/50">{problem ?? "Loading the storyboard and scripts…"}</p>;

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
    <section ref={root} className="space-y-6" aria-labelledby="script-title">
      <div className="space-y-1">
        <h2 id="script-title" className="font-serif text-3xl text-white">
          Read the script
        </h2>
        <p className="text-sm text-white/60">
          One storyboard, narrated natively in each language. Edit any line; the meter shows whether it still fits its
          shot.
        </p>
      </div>

      <ol className="space-y-3">
        {storyboard.data.beats.map((beat) => (
          <li key={beat.id} data-beat className="rounded-2xl border border-white/10 bg-[#121215]/80 p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent">{ROLE[beat.role] ?? beat.role}</span>
              <span className="text-white/45">
                {beat.motion.kind} · {beat.motion.emotion}
              </span>
              {beat.onScreen.map((o) => (
                <span key={o.text} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/70">
                  “{o.text}”
                </span>
              ))}
            </div>
            <div className={`grid gap-4 ${langs.length > 1 ? "md:grid-cols-2" : ""}`}>
              {langs.map((lang) => {
                const key = `${lang}:${beat.id}`;
                if (lines[key] === undefined) return null;
                return (
                  <label key={lang} className="block space-y-1.5">
                    <span className="text-[11px] text-white/40">{LANG_NAME[lang] ?? lang}</span>
                    <textarea
                      value={lines[key]}
                      onChange={(e) => setLines({ ...lines, [key]: e.target.value })}
                      rows={2}
                      lang={lang}
                      className="w-full resize-y rounded-xl border border-white/[0.06] bg-black/30 p-3 text-sm leading-relaxed text-white outline-none transition-colors focus:border-accent/50"
                    />
                    <Budget text={lines[key]!} lang={lang} maxSeconds={beat.maxSeconds} />
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-white/40">{beat.intent}</p>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={approve}
          disabled={sending}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-30"
        >
          {sending ? "Approving…" : edited ? `Approve with ${edited} edit${edited === 1 ? "" : "s"}` : "Approve script"}
        </button>
        {problem && <p className="text-sm text-red-400">{problem}</p>}
      </div>
    </section>
  );
}
