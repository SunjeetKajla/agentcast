"use client";

import { STAGES, type Job, type JobEvent } from "@agentcast/shared";

// What the pipeline is doing right now, and, while the coding agent directs the edit, what it's doing
// step by step (Claude Code or Codex, whichever the worker uses).

const DESCRIBE: Record<string, string> = {
  understand: "Reading your product's pages and working out its brand and the video's plan.",
  auth: "Waiting for you to sign in, in the Chrome window on the worker's machine.",
  discover: "An agent is finding the real way into your app.",
  "flow-runs": "Agents are trying the flows worth showing, and each one is rehearsed in a fresh browser.",
  record: "Filming each approved flow in local Chrome. A bad take is redone.",
  script: "Writing the storyboard and the narration in each language.",
  voice: "Recording the voiceover, one clip per line.",
  direct: "The coding agent is editing: zooms, captions, callouts and pacing.",
  preview: "Rendering a quick preview.",
  render: "Rendering every format at full quality.",
};

export default function NowCard({ job, events }: { job: Job; events: JobEvent[] }) {
  const running = STAGES.filter((s) => job.stages[s.name].status === "running");
  if (!running.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#121215]/80 p-5 text-sm text-white/60">
        {job.status === "queued" ? "Starting…" : "Getting the next step ready…"}
      </div>
    );
  }
  const llm = events.filter((e): e is Extract<JobEvent, { type: "llm" }> => e.type === "llm" && job.stages[e.stage].status === "running").slice(-6);

  return (
    <div className="space-y-3">
      {running.map((info) => {
        const s = job.stages[info.name];
        return (
          <div key={info.name} data-now className="rounded-2xl border border-accent/30 bg-[#121215]/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-serif text-2xl text-white">{info.label}</h2>
              {s.attempts > 1 && <span className="text-xs text-amber-400">attempt {s.attempts}</span>}
            </div>
            <p className="mt-1 text-sm text-white/60">{s.message ?? DESCRIBE[info.name]}</p>
            <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
              {s.progress !== undefined ? (
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(s.progress * 100)}%` }} />
              ) : (
                <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-accent motion-reduce:animate-none" />
              )}
            </div>
            {llm.length > 0 && info.name === llm[0]!.stage && (
              <ol className="mt-4 space-y-1 font-mono text-xs text-white/55">
                {llm.map((e) => (
                  <li key={e.seq} className={`truncate ${e.kind === "error" ? "text-red-400" : e.kind === "done" ? "text-green-400" : ""}`}>
                    {e.kind === "tool_use" ? "→ " : ""}
                    {e.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
