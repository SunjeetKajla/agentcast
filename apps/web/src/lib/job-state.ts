import type { Job, JobEvent, StageName } from "@agentcast/shared";

// Folds the worker's event stream (GET /jobs/:id/events) into what the job page shows. Pure, so the
// page and the tests share it.

export type AgentView = {
  agentId: string;
  stage: StageName;
  title: string;
  status: "started" | "step" | "done" | "failed" | "cancelled";
  streamingUrl?: string;
  screenshot?: string;
  /** Most recent last. */
  steps: string[];
};

export type JobView = {
  job: Job;
  /** Every event seen, in order, without duplicates. */
  events: JobEvent[];
  lastSeq: number;
  /** TinyFish agent runs, for the live views. */
  agents: AgentView[];
  /** Job-relative path → seq of its latest write, used to refetch (and cache-bust) artifacts. */
  artifacts: Record<string, number>;
};

export type JobAction = { type: "snapshot"; job: Job } | { type: "event"; event: JobEvent };

export function initialView(job: Job): JobView {
  return { job, events: [], lastSeq: 0, agents: [], artifacts: {} };
}

const stopAgents = (agents: AgentView[]) => agents.map(agent =>
  agent.status === "started" || agent.status === "step"
    ? { ...agent, status: "cancelled" as const, streamingUrl: undefined, screenshot: undefined }
    : agent,
);

export function reduceJob(view: JobView, action: JobAction): JobView {
  if (action.type === "snapshot") {
    if (view.job.status === "cancelled" && action.job.id === view.job.id && action.job.status !== "cancelled") return view;
    return { ...view, job: action.job, agents: action.job.status === "cancelled" ? stopAgents(view.agents) : view.agents };
  }
  const e = action.event;
  if (e.seq <= view.lastSeq || e.jobId !== view.job.id) return view;
  const next: JobView = { ...view, events: [...view.events, e], lastSeq: e.seq };

  switch (e.type) {
    case "job":
      if (view.job.status === "cancelled") break;
      next.job = { ...view.job, status: e.status, updatedAt: e.at };
      if (e.status === "cancelled") next.agents = stopAgents(view.agents);
      break;
    case "stage": {
      if (view.job.status === "cancelled") break;
      const prev = view.job.stages[e.stage];
      const running = e.status === "running" && prev.status !== "running";
      next.job = {
        ...view.job,
        updatedAt: e.at,
        stages: {
          ...view.job.stages,
          [e.stage]: {
            ...prev,
            status: e.status,
            attempts: e.attempt ?? prev.attempts,
            message: e.message,
            error: e.error,
            progress: running ? undefined : prev.progress,
            startedAt: running ? e.at : prev.startedAt,
            finishedAt: ["done", "failed", "skipped", "cancelled"].includes(e.status) ? e.at : prev.finishedAt,
          },
        },
      };
      break;
    }
    case "progress":
      if (view.job.status === "cancelled") break;
      next.job = {
        ...view.job,
        stages: { ...view.job.stages, [e.stage]: { ...view.job.stages[e.stage], progress: e.progress, message: e.message ?? view.job.stages[e.stage].message } },
      };
      break;
    case "artifact":
      next.artifacts = { ...view.artifacts, [e.path]: e.seq };
      break;
    case "agent": {
      const i = view.agents.findIndex((a) => a.agentId === e.agentId);
      const prev = i >= 0 ? view.agents[i] : undefined;
      const agent: AgentView = {
        agentId: e.agentId,
        stage: e.stage,
        title: e.title,
        status: e.status,
        streamingUrl: e.streamingUrl ?? prev?.streamingUrl,
        screenshot: e.screenshot ?? prev?.screenshot,
        steps: e.step ? [...(prev?.steps ?? []), e.step] : (prev?.steps ?? []),
      };
      if (view.job.status === "cancelled" && (agent.status === "started" || agent.status === "step")) {
        agent.status = "cancelled"; agent.streamingUrl = undefined; agent.screenshot = undefined;
      }
      next.agents = i >= 0 ? view.agents.map((a, j) => (j === i ? agent : a)) : [...view.agents, agent];
      break;
    }
  }
  return next;
}

/** How far along the pipeline is, 0–1: finished stages count fully, a running one by its progress. */
export function overallProgress(job: Job): number {
  const stages = Object.values(job.stages);
  const done = stages.reduce((sum, s) => {
    if (s.status === "done" || s.status === "skipped") return sum + 1;
    if (s.status === "running") return sum + (s.progress ?? 0.35);
    return sum;
  }, 0);
  return stages.length ? done / stages.length : 0;
}

/** The gate waiting for the person, if any. */
export function waitingGate(job: Job): "gate-flows" | "gate-script" | "gate-preview" | undefined {
  for (const gate of ["gate-flows", "gate-script", "gate-preview"] as const) {
    if (job.stages[gate].status === "waiting") return gate;
  }
  return undefined;
}
