"use client";

import { useEffect, useRef } from "react";
import { STAGES, type JobEvent } from "@agentcast/shared";

// Everything the worker reported, in order (PRD: activity log on the job page).

const label = (stage: string) => STAGES.find((s) => s.name === stage)?.label ?? stage;
const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function line(e: JobEvent): { text: string; tone?: "error" | "warn" | "good" } | undefined {
  switch (e.type) {
    case "job":
      return { text: `Job ${e.status}`, tone: e.status === "failed" ? "error" : e.status === "done" ? "good" : undefined };
    case "stage":
      if (e.status === "pending") return undefined;
      return {
        text: `${label(e.stage)}: ${e.status}${e.error ? ` — ${e.error.message}` : e.message ? ` — ${e.message}` : ""}`,
        tone: e.status === "failed" ? "error" : e.status === "done" ? "good" : e.status === "waiting" ? "warn" : undefined,
      };
    case "log":
      return { text: `${e.stage ? `${label(e.stage)}: ` : ""}${e.message}`, tone: e.level === "info" ? undefined : e.level === "warn" ? "warn" : "error" };
    case "llm":
      return { text: `${label(e.stage)} · ${e.text}`, tone: e.kind === "error" ? "error" : undefined };
    case "agent":
      return e.step ? { text: `${e.title}: ${e.step}` } : { text: `${e.title}: ${e.status}` };
    case "action":
      return { text: `${label(e.gate)} · ${e.name} ${e.status}${e.message ? ` — ${e.message}` : ""}`, tone: e.status === "failed" ? "error" : undefined };
    default:
      return undefined;
  }
}

const TONE = { error: "text-red-400", warn: "text-amber-400", good: "text-green-400" } as const;

export default function ActivityLog({ events }: { events: JobEvent[] }) {
  const box = useRef<HTMLOListElement>(null);
  const rows = events.flatMap((e) => {
    const l = line(e);
    return l ? [{ e, ...l }] : [];
  });

  // Follow the newest line unless the reader has scrolled up.
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    <details data-reveal className="group rounded-2xl border border-white/10 bg-[#121215]/60" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm text-white/80">
        <span>Activity</span>
        <span className="text-xs text-white/40">
          {rows.length} events <span className="inline-block transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <ol ref={box} className="max-h-72 space-y-1 overflow-y-auto border-t border-white/[0.05] px-5 py-3 font-mono text-xs">
        {rows.map(({ e, text, tone }) => (
          <li key={e.seq} className="flex gap-3">
            <span className="shrink-0 text-white/30">{time(e.at)}</span>
            <span className={tone ? TONE[tone] : "text-white/60"}>{text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
