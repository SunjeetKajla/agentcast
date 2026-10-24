"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { STAGES, jobPaths, type JobEvent } from "@agentcast/shared";
import StageRail from "@/components/job/StageRail";
import NowCard from "@/components/job/NowCard";
import LiveAgents from "@/components/job/LiveAgents";
import FlowReview from "@/components/job/FlowReview";
import StoryboardReview from "@/components/job/StoryboardReview";
import PreviewReview from "@/components/job/PreviewReview";
import Outputs from "@/components/job/Outputs";
import PlanCard from "@/components/job/PlanCard";
import ActivityLog from "@/components/job/ActivityLog";
import { waitingGate } from "@/lib/job-state";
import { useJob } from "@/lib/useJob";
import { EASE, MOTION_OK, gsap, useGSAP, useReveal, settle } from "@/lib/motion";

// /jobs/[id]: one job, live (PRD §5.1 screens 2–7). The rail shows where the pipeline is; the main panel
// is whatever needs you now: a review, the agents at work, or the finished videos.

const STATUS_LABEL = {
  queued: "Starting",
  running: "Working",
  waiting: "Needs your review",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

export default function JobView({ id }: { id: string }) {
  const { view, error, live, decide, cancel } = useJob(id);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();
  const panel = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);

  const job = view?.job;
  const gate = job && waitingGate(job);
  const panelKey = !job
    ? "loading"
    : job.status === "done"
      ? "outputs"
      : job.status === "failed" || job.status === "cancelled"
        ? job.status
        : (gate ?? "working");

  // Each change of panel (a gate opening, the videos arriving) slides the new one in.
  useGSAP(
    () => {
      if (!panel.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(panel.current, ...settle({ autoAlpha: 0, y: 28, duration: 0.8, ease: EASE.expo }));
      });
      return () => mm.revert();
    },
    { dependencies: [panelKey] },
  );
  useReveal(page, [Boolean(job)]);

  if (error) {
    return (
      <div className="flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-serif text-3xl text-white">
          {error.status === 404 ? "No such job" : "Can't load this job"}
        </h1>
        <p className="text-sm text-white/60">{error.message}</p>
        <Link href="/" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">
          Back home
        </Link>
      </div>
    );
  }
  if (!view || !job) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-sm text-white/50">Loading the job…</p>
      </div>
    );
  }

  const host = new URL(job.config.url).hostname.replace(/^www\./, "");
  const finished = job.status === "done" || job.status === "failed" || job.status === "cancelled";
  const exploring = ["discover", "flow-runs"].some((s) => job.stages[s as "discover"].status === "running");
  const failed = STAGES.filter((s) => job.stages[s.name].status === "failed");

  return (
    <div ref={page} className="w-full max-w-6xl px-6 py-10 sm:py-14">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-white/50">
            <span
              className={`h-2 w-2 rounded-full ${live && !finished ? "animate-pulse bg-accent" : finished ? "bg-white/30" : "bg-amber-400"}`}
            />
            {STATUS_LABEL[job.status]}
            {!finished && !live && " · reconnecting"}
          </p>
          <h1 className="font-serif text-4xl font-normal text-white sm:text-5xl">{host}</h1>
          <a
            href={job.config.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-white/40 transition-colors hover:text-white/70"
          >
            {job.config.url}
          </a>
        </div>
        {!finished && (
          <button
            type="button"
            onClick={async () => {
              setCancelError(undefined);
              setCancelling(true);
              try { await cancel(); }
              catch (error) { setCancelError(error instanceof Error ? error.message : "Could not cancel the job. Try again."); }
              finally { setCancelling(false); }
            }}
            disabled={cancelling}
            className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            {cancelling ? "Cancelling…" : "Cancel job"}
          </button>
        )}
      </header>
      {cancelError && <p role="alert" className="mb-6 text-sm text-red-400">{cancelError}</p>}

      <div className="grid gap-10 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <StageRail job={job} />
        </aside>

        <div className="min-w-0 space-y-10">
          <div ref={panel} key={panelKey}>
            {gate === "gate-flows" ? (
              <FlowReview
                jobId={job.id}
                version={view.artifacts[jobPaths.flows]}
                action={
                  view.events.findLast((e) => e.type === "action" && e.gate === "gate-flows") as
                    Extract<JobEvent, { type: "action" }> | undefined
                }
                onApprove={(d) => decide("gate-flows", d)}
              />
            ) : gate === "gate-script" ? (
              <StoryboardReview
                jobId={job.id}
                langs={job.config.variants.langs}
                versions={view.artifacts}
                onApprove={(d) => decide("gate-script", d)}
              />
            ) : gate === "gate-preview" ? (
              <PreviewReview
                job={job}
                version={view.artifacts[jobPaths.preview]}
                onDecide={(d) => decide("gate-preview", d)}
              />
            ) : job.status === "done" ? (
              <Outputs job={job} versions={view.artifacts} />
            ) : job.status === "failed" ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-6 space-y-3">
                <h2 className="font-serif text-3xl text-white">Something went wrong</h2>
                {failed.map((s) => (
                  <p key={s.name} className="text-sm text-red-300">
                    <span className="text-white">{s.label}:</span> {job.stages[s.name].error?.message ?? "failed"}
                  </p>
                ))}
                <Link href="/#hero-input" className="inline-block pt-2 text-sm text-white/70 hover:text-white">
                  ← Start a new video
                </Link>
              </div>
            ) : job.status === "cancelled" ? (
              <div className="rounded-2xl border border-white/10 bg-[#121215]/80 p-6 space-y-2">
                <h2 className="font-serif text-3xl text-white">Stopped</h2>
                <p className="text-sm text-white/60">This job was cancelled. Its finished stages are kept.</p>
              </div>
            ) : (
              <NowCard job={job} events={view.events} />
            )}
          </div>

          {(exploring || (view.agents.length > 0 && !finished && job.stages["gate-flows"].status !== "done")) && (
            <LiveAgents agents={view.agents} />
          )}

          <PlanCard jobId={job.id} versions={view.artifacts} />
          <ActivityLog events={view.events} />
        </div>
      </div>
    </div>
  );
}
