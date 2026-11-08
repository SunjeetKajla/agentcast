"use client";

import { useState } from "react";
import { STAGES, type JobEvent } from "@agentcast/shared";
import { mmss } from "@/lib/job-model";

// Everything the worker reported (PRD: activity log on the job page), newest first, timed from the
// start of the job. Six lines by default; the rest on request.

const label = (stage: string) => STAGES.find((s) => s.name === stage)?.label ?? stage;

export function line(e: JobEvent): { text: string; tone?: "bad" | "warn" | "good" } | undefined {
  switch (e.type) {
    case "job":
      return { text: e.status === "done" ? "Job finished" : `Job ${e.status}`, tone: e.status === "failed" ? "bad" : e.status === "done" ? "good" : undefined };
    case "stage":
      if (e.status === "pending") return undefined;
      return {
        text: `${label(e.stage)}: ${e.status}${e.error ? `. ${e.error.message}` : e.message ? `. ${e.message}` : ""}`,
        tone: e.status === "failed" ? "bad" : e.status === "done" ? "good" : e.status === "waiting" ? "warn" : undefined,
      };
    case "log":
      return { text: `${e.stage ? `${label(e.stage)}: ` : ""}${e.message}`, tone: e.level === "info" ? undefined : e.level === "warn" ? "warn" : "bad" };
    case "llm":
      return e.kind === "done" || !e.text.trim() ? undefined : { text: `${label(e.stage)} · ${e.text}`, tone: e.kind === "error" ? "bad" : undefined };
    case "agent":
      return e.step ? { text: `${e.title}: ${e.step}` } : { text: `${e.title}: ${e.status}`, tone: e.status === "failed" ? "bad" : undefined };
    case "action":
      return { text: `${label(e.gate)} · ${e.name} ${e.status}${e.message ? `. ${e.message}` : ""}`, tone: e.status === "failed" ? "bad" : undefined };
    default:
      return undefined;
  }
}

export default function ActivityLog({ events, startedAt }: { events: JobEvent[]; startedAt: string }) {
  const [all, setAll] = useState(false);
  const t0 = Date.parse(startedAt) / 1000;
  const rows = events
    .flatMap((e) => {
      const l = line(e);
      return l ? [{ e, ...l }] : [];
    })
    .reverse();
  const shown = all ? rows : rows.slice(0, 6);

  return (
    <section className="blk" aria-labelledby="activity-h">
      <div className="blk-h">
        <h2 id="activity-h">Activity</h2>
        <span>{rows.length} {rows.length === 1 ? "event" : "events"} · latest first</span>
      </div>
      {rows.length === 0 ? (
        <p className="blk-empty">Nothing yet. Events appear here as the worker reports them.</p>
      ) : (
        <ol className={`feed2 ${all ? "all" : ""}`}>
          {shown.map(({ e, text, tone }) => (
            <li key={e.seq} className={tone ?? ""}>
              <time dateTime={e.at}>{mmss(Date.parse(e.at) / 1000 - t0)}</time>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 6 && (
        <button type="button" className="blk-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show the latest 6" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
