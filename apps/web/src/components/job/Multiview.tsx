"use client";
/* eslint-disable @next/next/no-img-element */

import { fileUrl } from "@/lib/api";
import type { AgentView } from "@/lib/job-state";

// The TinyFish agents at work (PRD FR-22), as a broadcast multiview: one monitor per agent with a tally
// light, its live browser while it runs (or its latest frame), and its last few steps.

const TALLY: Record<AgentView["status"], { cls: string; text: string }> = {
  started: { cls: "live", text: "live · starting" },
  step: { cls: "live", text: "live" },
  done: { cls: "ok", text: "done" },
  failed: { cls: "bad", text: "failed" },
  cancelled: { cls: "", text: "stopped" },
};

const frameSrc = (jobId: string, shot?: string) => (!shot ? undefined : /^https?:\/\//.test(shot) ? shot : fileUrl(jobId, shot));

export default function Multiview({ jobId, agents }: { jobId: string; agents: AgentView[] }) {
  const running = (a: AgentView) => a.status === "started" || a.status === "step";
  // Running ones first, then the most recent; three monitors at most.
  const order = [...agents].reverse().sort((a, b) => Number(running(b)) - Number(running(a)));
  const shown = order.slice(0, 3);
  const more = agents.length - shown.length;

  return (
    <div className="mv-wrap">
      <div className={`mv n${shown.length}`}>
        {shown.map((a, i) => {
          const live = running(a);
          const src = frameSrc(jobId, a.screenshot);
          const tally = TALLY[a.status];
          return (
            <article key={a.agentId} className="mon">
              <div className="mon-h">
                <b>Agent {agents.indexOf(a) + 1}</b>
                <span className={`tally ${tally.cls}`}>
                  <i />
                  <span>{a.status === "step" ? `live · step ${a.steps.length}` : tally.text}</span>
                </span>
              </div>
              <p className="goal">{a.title}</p>
              <div className={`mon-media ${(live && a.streamingUrl) || src ? "" : "empty"}`} data-ui>
                {live && a.streamingUrl ? (
                  <iframe
                    src={a.streamingUrl}
                    title={`Live view: ${a.title}`}
                    sandbox="allow-scripts allow-same-origin"
                    referrerPolicy="no-referrer"
                    loading={i === 0 ? "eager" : "lazy"}
                  />
                ) : src ? (
                  <img src={src} alt={`Latest frame: ${a.title}`} loading="lazy" />
                ) : (
                  <span className="mon-empty">{live ? "Waiting for the first frame…" : "No frames from this agent"}</span>
                )}
              </div>
              <ol className="alog">
                {a.steps.length === 0 && <li>{live ? "Starting the browser…" : "No steps reported"}</li>}
                {a.steps.slice(-5).map((s, k) => (
                  <li key={`${k}-${s}`}>{s}</li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>
      {more > 0 && <p className="mv-more">{more} more {more === 1 ? "agent" : "agents"} earlier in this run, in the activity below.</p>}
    </div>
  );
}
