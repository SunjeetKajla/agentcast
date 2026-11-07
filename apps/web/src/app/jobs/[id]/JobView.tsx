"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlowsFile, STAGES, jobPaths, variantMatrix, voiced, type JobEvent } from "@agentcast/shared";
import AppShell, { type Connection } from "@/components/app/AppShell";
import Field from "@/components/app/Field";
import RunTimeline from "@/components/app/RunTimeline";
import ActivityLog from "@/components/job/ActivityLog";
import FlowReview from "@/components/job/FlowReview";
import Multiview from "@/components/job/Multiview";
import Outputs from "@/components/job/Outputs";
import PreviewReview from "@/components/job/PreviewReview";
import StageWork from "@/components/job/StageWork";
import StoryboardReview from "@/components/job/StoryboardReview";
import {
  STAGE_LEAD, STAGE_TITLE, currentStage, elapsed, facts, fieldState, finding, finished, hostOf, mmss, modeName, took,
} from "@/lib/job-model";
import { waitingGate } from "@/lib/job-state";
import { useArtifact } from "@/lib/useArtifact";
import { useJob } from "@/lib/useJob";

// /jobs/[id]: one job, live from the worker (GET /jobs/:id, then its SSE event stream). The field shows
// what needs attention now: the agents at work, a review gate, or the finished videos. Below it, the run
// as an edit timeline, the activity, and what was asked for.

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function JobView({ id }: { id: string }) {
  const { view, error, live, decide, cancel } = useJob(id);
  const now = useNow();
  const [sure, setSure] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();
  const flowsFile = useArtifact(id, jobPaths.flows, FlowsFile, view?.artifacts[jobPaths.flows]);

  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(t);
  }, [sure]);

  const job = view?.job;
  useEffect(() => {
    if (job) document.title = `${hostOf(job.config.url)} · AgentCast`;
  }, [job]);

  if (error || !view || !job) {
    const missing = error?.status === 404;
    return (
      <AppShell current="job" connection={error ? { tone: "off", text: "Can’t reach the worker" } : { tone: "idle", text: "Connecting…" }}>
        <div className="ttl"><div className="ttl-l"><p className="crumb"><Link href="/jobs">Videos</Link> / {id}</p><h1 className="jt">{error ? (missing ? "No such job" : "Can’t load this job") : "Loading…"}</h1></div></div>
        <Field
          state={error ? "fail" : "run"}
          title={error ? (missing ? "Not found" : "Offline") : "Loading"}
          lead={error ? error.message : "Fetching the job and joining its live event stream."}
        >
          {error && <Link className="ab ab-f" href="/jobs">See all your videos <span className="arr" aria-hidden="true">→</span></Link>}
        </Field>
      </AppShell>
    );
  }

  const gate = waitingGate(job);
  const stage = currentStage(job);
  const state = fieldState(job);
  const over = finished(job);
  const flows = flowsFile.data
    ? { total: flowsFile.data.flows.length, selected: flowsFile.data.flows.filter((f) => f.selected).length }
    : undefined;
  const n = variantMatrix(job.config.variants).length;
  const st = stage ? job.stages[stage] : undefined;
  const inStage = st?.startedAt ? Math.max(0, now / 1000 - Date.parse(st.startedAt) / 1000) : 0;
  const stageIndex = stage ? STAGES.findIndex((s) => s.name === stage) + 1 : 0;
  const agents = view.agents.filter((a) => a.stage === "discover" || a.stage === "flow-runs");

  const connection: Connection = over
    ? { tone: "idle", text: job.status === "done" ? "Finished" : job.status === "failed" ? "Stopped with an error" : "Cancelled" }
    : live
      ? { tone: "live", text: "Live from the worker" }
      : { tone: "wait", text: "Reconnecting to the worker…" };

  // What the field says and holds.
  let title: string, lead: string, clock: string | undefined, sub: string | undefined, body: React.ReactNode = null;
  if (job.status === "done") {
    title = "Ready";
    lead = "Filmed on the real product and cut from the approved edit. Watch them here or download them.";
    clock = mmss(elapsed(job, now)); sub = "start to finish";
    body = <Outputs job={job} versions={view.artifacts} />;
  } else if (job.status === "failed") {
    title = "Stopped";
    lead = finding(job);
    clock = mmss(elapsed(job, now)); sub = stage ? `in ${STAGE_TITLE[stage].toLowerCase()}` : undefined;
    body = (
      <div className="fail-body">
        {STAGES.filter((s) => job.stages[s.name].status === "failed").map((s) => (
          <p key={s.name}><b>{s.label}</b>{job.stages[s.name].error?.code ? ` (${job.stages[s.name].error!.code})` : ""}: {job.stages[s.name].error?.message ?? "failed"}</p>
        ))}
        <Link className="ab ab-f" href="/#top">Start a new video <span className="arr" aria-hidden="true">→</span></Link>
      </div>
    );
  } else if (job.status === "cancelled") {
    title = "Cancelled";
    lead = "Nothing more will be filmed. The stages that finished are kept with the job.";
    clock = mmss(elapsed(job, now)); sub = "total time";
    body = <Link className="ab ab-f" href="/#top">Start a new video <span className="arr" aria-hidden="true">→</span></Link>;
  } else if (gate) {
    title = STAGE_TITLE[gate];
    lead = STAGE_LEAD[gate];
    clock = mmss(inStage); sub = "waiting on you";
    body =
      gate === "gate-flows" ? (
        <FlowReview
          jobId={job.id}
          version={view.artifacts[jobPaths.flows]}
          action={view.events.findLast((e) => e.type === "action" && e.gate === "gate-flows") as Extract<JobEvent, { type: "action" }> | undefined}
          onApprove={(d) => decide("gate-flows", d)}
        />
      ) : gate === "gate-script" ? (
        <StoryboardReview jobId={job.id} langs={job.config.variants.langs} versions={view.artifacts} onApprove={(d) => decide("gate-script", d)} />
      ) : (
        <PreviewReview job={job} version={view.artifacts[jobPaths.preview]} onDecide={(d) => decide("gate-preview", d)} />
      );
  } else if (job.status === "queued" || !stage) {
    title = "Starting";
    lead = "The worker has the job and is getting the first stages ready.";
  } else {
    title = STAGE_TITLE[stage];
    lead = st?.message ?? STAGE_LEAD[stage];
    clock = mmss(inStage); sub = `in this stage · stage ${stageIndex} of ${STAGES.length}`;
    body =
      (stage === "discover" || stage === "flow-runs") && agents.length > 0 ? (
        <Multiview jobId={job.id} agents={agents} />
      ) : (
        <StageWork job={job} stage={stage} events={view.events} />
      );
  }

  return (
    <AppShell current="job" connection={connection}>
      <div className="ttl">
        <div className="ttl-l">
          <p className="crumb"><Link href="/jobs">Videos</Link> / {modeName(job)}</p>
          <h1 className="jt">{hostOf(job.config.url)}</h1>
          <p className="finding">{finding(job, flows)}</p>
        </div>
        {!over && (
          <div className="ttl-act">
            <button
              type="button"
              className="ab ab-ghost"
              disabled={cancelling}
              onClick={async () => {
                if (!sure) { setSure(true); return; }
                setCancelError(undefined);
                setCancelling(true);
                try { await cancel(); } catch (err) { setCancelError(err instanceof Error ? err.message : "Couldn’t cancel the job. Try again."); }
                finally { setCancelling(false); setSure(false); }
              }}
            >
              {cancelling ? "Cancelling…" : sure ? "Yes, cancel it" : "Cancel job"}
            </button>
          </div>
        )}
      </div>
      {cancelError && <p className="app-alert" role="alert">{cancelError}</p>}

      <dl className="meta">
        <div><dt>Elapsed</dt><dd>{mmss(elapsed(job, now))}</dd></div>
        <div><dt>Stage</dt><dd>{job.status === "done" ? STAGES.length : stageIndex || "–"} <small>of {STAGES.length}</small></dd></div>
        <div><dt>Flows</dt><dd>{flows ? <>{flows.selected} <small>of {flows.total} picked</small></> : <small>not found yet</small>}</dd></div>
        <div><dt>Videos</dt><dd>{n} <small>at 1080p</small></dd></div>
        <div><dt>Video</dt><dd>{modeName(job).split(" ")[0]} <small>{voiced(job.config) ? "narrated" : "music-led"}</small></dd></div>
      </dl>

      <Field state={state} title={title} lead={lead} clock={clock} sub={sub}>{body}</Field>

      <RunTimeline job={job} now={now} />

      <div className="lower">
        <ActivityLog events={view.events} startedAt={job.createdAt} />
        <section className="blk" aria-labelledby="facts-h">
          <div className="blk-h"><h2 id="facts-h">This job</h2><span>{over ? `took ${took(elapsed(job, now))}` : `started ${took(elapsed(job, now))} ago`}</span></div>
          <dl className="facts">
            {facts(job).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{k === "Link" ? <a href={v} target="_blank" rel="noopener noreferrer">{v}</a> : v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </AppShell>
  );
}
