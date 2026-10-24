"use client";

import { useRef } from "react";
import { STAGES, type Job, type StageState } from "@agentcast/shared";
import { overallProgress } from "@/lib/job-state";
import { DUR, EASE, MOTION_OK, gsap, useGSAP, settle } from "@/lib/motion";

// The pipeline, live (PRD §5.1 "Stage rail"). A rail on the left on wide screens, a strip on phones.

const seconds = (s: StageState) => {
  if (!s.startedAt) return "";
  const end = s.finishedAt ? Date.parse(s.finishedAt) : Date.now();
  const total = Math.max(0, Math.round((end - Date.parse(s.startedAt)) / 1000));
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
};

function Dot({ status }: { status: StageState["status"] }) {
  switch (status) {
    case "done":
      return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/20 text-xs text-green-400">✓</span>;
    case "running":
      return (
        <span className="relative flex h-6 w-6 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/40" />
          <span className="relative h-3 w-3 rounded-full bg-accent" />
        </span>
      );
    case "waiting":
      return (
        <span className="relative flex h-6 w-6 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-amber-400/30" />
          <span className="relative h-3 w-3 rounded-full bg-amber-400" />
        </span>
      );
    case "failed":
      return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 text-xs text-red-400">✕</span>;
    case "skipped":
      return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-xs text-white/30">–</span>;
    case "cancelled":
      return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-xs text-white/40">⏹</span>;
    default:
      return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10" />;
  }
}

export default function StageRail({ job }: { job: Job }) {
  const root = useRef<HTMLDivElement>(null);
  const progress = overallProgress(job);
  const signature = STAGES.map((s) => job.stages[s.name].status).join();

  // First paint: the rows arrive top to bottom. Then the fill follows the pipeline.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo("[data-rail-row]", ...settle({ autoAlpha: 0, x: -12, duration: 0.6, ease: EASE.out, stagger: 0.04 }));
      });
      return () => mm.revert();
    },
    { scope: root },
  );
  useGSAP(
    () => {
      gsap.to("[data-rail-fill]", { scaleY: progress, duration: DUR.reveal, ease: EASE.expo });
      // Phones: keep the current stage in view in the strip.
      const strip = root.current?.querySelector<HTMLElement>("[data-strip]");
      const current = strip?.querySelector<HTMLElement>('[data-status="running"], [data-status="waiting"], [data-status="failed"]');
      if (strip && current) strip.scrollTo({ left: current.offsetLeft - strip.clientWidth / 2 + current.clientWidth / 2, behavior: "smooth" });
      gsap.to("[data-strip-fill]", { scaleX: progress, duration: DUR.reveal, ease: EASE.expo });
      // A stage that just changed state gives a small nod.
      gsap.fromTo(
        '[data-rail-row][data-status="running"] [data-dot], [data-rail-row][data-status="waiting"] [data-dot]',
        { scale: 0.6 },
        { scale: 1, duration: 0.5, ease: "back.out(2)" },
      );
    },
    { scope: root, dependencies: [signature, progress] },
  );

  return (
    <nav ref={root} aria-label="Pipeline">
      {/* Phones: a strip with the current stage */}
      <div className="lg:hidden space-y-2">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div data-strip-fill className="h-full w-full origin-left scale-x-0 rounded-full bg-accent" />
        </div>
        <ol data-strip className="relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {STAGES.map((info) => {
            const s = job.stages[info.name];
            return (
              <li
                key={info.name}
                data-status={s.status}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  s.status === "running" || s.status === "waiting"
                    ? "border-accent/50 bg-accent/10 text-white"
                    : s.status === "done"
                      ? "border-white/10 text-white/60"
                      : "border-white/[0.06] text-white/35"
                }`}
              >
                {info.label}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Wide screens: the rail */}
      <div className="relative hidden lg:block">
        <div className="absolute left-[11px] top-3 bottom-3 w-[2px] rounded-full bg-white/[0.06]" aria-hidden>
          <div data-rail-fill className="h-full w-full origin-top scale-y-0 rounded-full bg-accent/70" />
        </div>
        <ol className="relative space-y-1">
        {STAGES.map((info) => {
          const s = job.stages[info.name];
          const active = s.status === "running" || s.status === "waiting";
          return (
            <li key={info.name} data-rail-row data-status={s.status} className="relative flex items-start gap-3 py-1.5">
              <span data-dot className="relative z-10 bg-[#050505]">
                <Dot status={s.status} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm ${active ? "font-medium text-white" : s.status === "done" ? "text-white/75" : "text-white/40"}`}>
                    {info.label}
                    {info.gate && s.status === "waiting" && <span className="ml-2 text-xs text-amber-400">your turn</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-white/35">{seconds(s)}</span>
                </div>
                {(active || s.status === "failed") && (s.error?.message ?? s.message) && (
                  <p className={`mt-0.5 line-clamp-2 text-xs ${s.status === "failed" ? "text-red-400" : "text-white/50"}`}>
                    {s.error?.message ?? s.message}
                  </p>
                )}
                {s.status === "running" && s.progress !== undefined && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
        </ol>
      </div>
    </nav>
  );
}
