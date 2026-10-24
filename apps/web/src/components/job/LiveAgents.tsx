"use client";

import { useRef } from "react";
import type { AgentView } from "@/lib/job-state";
import { EASE, MOTION_OK, gsap, useGSAP, settle } from "@/lib/motion";

// The TinyFish agents at work (PRD FR-22): each run's live browser view while it's running, then the
// steps it took.

const STATUS: Record<AgentView["status"], { label: string; cls: string }> = {
  started: { label: "Starting", cls: "text-accent" },
  step: { label: "Working", cls: "text-accent" },
  done: { label: "Done", cls: "text-green-400" },
  failed: { label: "Failed", cls: "text-red-400" },
  cancelled: { label: "Stopped", cls: "text-white/40" },
};

export default function LiveAgents({ agents }: { agents: AgentView[] }) {
  const root = useRef<HTMLElement>(null);
  const seen = useRef(new Set<string>());

  // A newly started agent's card opens into place.
  useGSAP(
    () => {
      const fresh = agents.filter((a) => !seen.current.has(a.agentId));
      for (const a of fresh) seen.current.add(a.agentId);
      if (!fresh.length) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const els = fresh
          .map((a) => root.current?.querySelector(`[data-agent="${CSS.escape(a.agentId)}"]`))
          .filter(Boolean) as Element[];
        gsap.fromTo(els, ...settle({ autoAlpha: 0, y: 24, scale: 0.98, duration: 0.8, ease: EASE.expo, stagger: 0.08 }));
      });
    },
    { scope: root, dependencies: [agents.length] },
  );

  if (!agents.length) return null;
  const live = agents.filter((a) => a.status === "started" || a.status === "step").length;

  return (
    <section ref={root} className="space-y-4" aria-labelledby="agents-title">
      <div className="flex items-baseline justify-between">
        <h2 id="agents-title" className="font-serif text-2xl text-white">
          Agents exploring
        </h2>
        <span className="text-xs text-white/50">{live ? `${live} running` : `${agents.length} finished`}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((a) => {
          const running = a.status === "started" || a.status === "step";
          return (
            <article key={a.agentId} data-agent={a.agentId} className="overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/80">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <h3 className="truncate text-sm font-medium text-white">{a.title}</h3>
                <span className={`flex shrink-0 items-center gap-1.5 text-xs ${STATUS[a.status].cls}`}>
                  {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
                  {STATUS[a.status].label}
                </span>
              </div>
              {running && a.streamingUrl ? (
                <iframe
                  src={a.streamingUrl}
                  title={`Live view: ${a.title}`}
                  className="aspect-video w-full border-0 bg-black"
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              {a.steps.length > 0 && (
                <ol className="space-y-1 border-t border-white/[0.05] px-4 py-3 text-xs text-white/60">
                  {a.steps.slice(-4).map((step, i) => (
                    <li key={`${i}-${step}`} className="truncate">
                      {step}
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
