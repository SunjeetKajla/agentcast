"use client";

import { useRef, useState } from "react";
import { jobPaths, variantMatrix, type GateDecision, type Job } from "@agentcast/shared";
import VideoPlayer from "@/components/VideoPlayer";
import { fileUrl } from "@/lib/api";
import { EASE, MOTION_OK, gsap, useGSAP, settle } from "@/lib/motion";

// Gate 3 (PRD §5.1): watch the 540p preview, then approve it for every variant or ask for a change in
// plain words. A revision sends the director back to the edit with your note (PRD §9.7).

const EXAMPLES = ["Make the intro shorter", "Zoom harder on the main result", "Slower pace, more holds on each click"];

export default function PreviewReview({
  job,
  version,
  onDecide,
}: {
  job: Job;
  version: number | undefined;
  onDecide: (decision: GateDecision<"gate-preview">) => Promise<unknown>;
}) {
  const [revise, setRevise] = useState("");
  const [sending, setSending] = useState<"approve" | "revise">();
  const [problem, setProblem] = useState<string>();
  const root = useRef<HTMLElement>(null);
  const first = variantMatrix(job.config.variants)[0];
  const rounds = job.stages.direct.attempts;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo("[data-preview-part]", ...settle({ autoAlpha: 0, y: 24, duration: 0.8, ease: EASE.expo, stagger: 0.09 }));
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const send = async (decision: GateDecision<"gate-preview">) => {
    setSending(decision.action);
    setProblem(undefined);
    try {
      await onDecide(decision);
    } catch (err) {
      setProblem((err as Error).message);
      setSending(undefined);
    }
  };

  return (
    <section ref={root} className="space-y-6" aria-labelledby="preview-title">
      <div data-preview-part className="space-y-1">
        <h2 id="preview-title" className="font-serif text-3xl text-white">
          Watch the preview
        </h2>
        <p className="text-sm text-white/60">
          A quick 540p cut{first ? ` of the ${first.aspect === "16x9" ? "16:9" : "9:16"} ${first.lang.toUpperCase()} version` : ""}.
          {rounds > 1 ? ` Revision ${rounds - 1}.` : ""} Approve it to render every format at full quality.
        </p>
      </div>

      <div data-preview-part>
        <VideoPlayer
          key={version}
          src={fileUrl(job.id, jobPaths.preview, version)}
          format={first?.aspect === "9x16" ? "9:16" : "16:9"}
        />
      </div>

      <div data-preview-part className="rounded-2xl border border-white/10 bg-[#121215]/80 p-4 space-y-3">
        <label htmlFor="revise" className="text-sm font-medium text-white">
          Want something changed?
        </label>
        <textarea
          id="revise"
          value={revise}
          onChange={(e) => setRevise(e.target.value)}
          rows={2}
          placeholder="Make the intro shorter and zoom harder on the AI panel"
          className="w-full resize-y rounded-xl border border-white/[0.06] bg-black/30 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-accent/50"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setRevise(e)}
              className="rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1 text-xs text-white/60 transition-colors hover:bg-white/[0.09] hover:text-white"
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div data-preview-part className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => send({ action: "approve" })}
          disabled={Boolean(sending)}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-30"
        >
          {sending === "approve" ? "Approving…" : "Approve & render all formats"}
        </button>
        <button
          type="button"
          onClick={() => send({ action: "revise", revise: revise.trim() })}
          disabled={Boolean(sending) || !revise.trim()}
          className="rounded-full border border-white/15 bg-white/[0.05] px-5 py-2 text-sm font-medium text-white transition-all hover:bg-white/10 active:scale-[0.98] disabled:opacity-30"
        >
          {sending === "revise" ? "Sending…" : "Revise"}
        </button>
        {problem && <p className="text-sm text-red-400">{problem}</p>}
      </div>
    </section>
  );
}
