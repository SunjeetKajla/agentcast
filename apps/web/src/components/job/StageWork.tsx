"use client";

import type { Job, JobEvent, StageName } from "@agentcast/shared";
import SignInCompletion from "./SignInCompletion";

// The field's body while a stage works: how far along it is, what the coding agent is doing (Claude Code
// or Codex, whichever the worker uses), and the stage's latest log lines.

type Llm = Extract<JobEvent, { type: "llm" }>;
type Log = Extract<JobEvent, { type: "log" }>;

export default function StageWork({ job, stage, events }: { job: Job; stage: StageName; events: JobEvent[] }) {
  const s = job.stages[stage];
  const llm = events.filter((e): e is Llm => e.type === "llm" && e.stage === stage && e.kind !== "done" && e.text.trim() !== "").slice(-6);
  const logs = events.filter((e): e is Log => e.type === "log" && e.stage === stage).slice(-4);
  const pct = s.progress !== undefined ? Math.round(s.progress * 100) : undefined;
  const signIn =
    stage === "auth" && job.config.auth.mode !== "public" && (s.progress ?? 0) >= 0.1 && (s.progress ?? 0) < 0.5;

  return (
    <div className={`work ${llm.length || logs.length ? "two" : ""}`}>
      <div className="work-main">
        <div className="prog-big" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${stage} progress`}>
          {pct !== undefined ? <i style={{ transform: `scaleX(${s.progress})` }} /> : <i className="indet" />}
        </div>
        <p className="work-pct">
          <b>{pct !== undefined ? `${pct}%` : "Working"}</b>
          {s.attempts > 1 && <span>attempt {s.attempts}</span>}
        </p>
        {signIn && <SignInCompletion key={`${job.id}/${s.attempts}`} jobId={job.id} attempt={s.attempts} />}
      </div>
      {(llm.length > 0 || logs.length > 0) && (
        <div className="work-side">
          <h3>{llm.length ? "What the coding agent is doing" : "Latest from this stage"}</h3>
          <ol className="notes">
            {(llm.length ? llm : logs).map((e) => (
              <li key={e.seq} className={("kind" in e && e.kind === "error") || ("level" in e && e.level !== "info") ? "bad" : ""}>
                <span>{"kind" in e && e.kind === "tool_use" ? `→ ${e.text}` : "text" in e ? e.text : e.message}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
