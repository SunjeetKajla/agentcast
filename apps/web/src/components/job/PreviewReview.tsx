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
    <section ref={root} className="pvw" aria-label="The preview">
      <div data-preview-part className="pvw-player" data-ui>
        <VideoPlayer
          key={version}
          src={fileUrl(job.id, jobPaths.preview, version)}
          format={first?.aspect === "9x16" ? "9:16" : "16:9"}
        />
      </div>
      <div data-preview-part className="pvw-side">
        <p className="pvw-what">
          A quick 540p cut{first ? ` of the ${first.aspect === "16x9" ? "16:9" : "9:16"} ${first.lang === "hi" ? "Hindi" : "English"} version` : ""}.
          {rounds > 1 ? ` Revision ${rounds - 1}.` : ""}
        </p>
        <label htmlFor="revise" className="pvw-label">Want something changed?</label>
        <textarea
          id="revise"
          value={revise}
          onChange={(e) => setRevise(e.target.value)}
          rows={3}
          placeholder="Make the intro shorter and zoom harder on the main panel"
        />
        <div className="pvw-ex">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setRevise(e)}>{e}</button>
          ))}
        </div>
        <div className="pvw-acts">
          <button type="button" className="ab ab-f2" onClick={() => send({ action: "revise", revise: revise.trim() })} disabled={Boolean(sending) || !revise.trim()}>
            {sending === "revise" ? "Sending…" : "Send to the director"}
          </button>
          <button type="button" className="ab ab-f" onClick={() => send({ action: "approve" })} disabled={Boolean(sending)}>
            {sending === "approve" ? "Approving…" : "Approve and render"} <span className="arr" aria-hidden="true">→</span>
          </button>
        </div>
        {problem && <p className="field-err" role="alert">{problem}</p>}
      </div>
    </section>
  );
}
