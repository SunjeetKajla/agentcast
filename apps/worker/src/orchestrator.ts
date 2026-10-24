import { join } from "node:path";
import {
  GATE_DECISIONS,
  STAGES,
  jobPaths,
  type GateDecision,
  type GateName,
  type Job,
  type JobConfig,
  type JobStatus,
  type StageName,
  type StageState,
} from "@agentcast/shared";
import { writeArtifact } from "@agentcast/shared/node";
import type { Logger } from "pino";
import { z } from "zod";
import { EventBus } from "./bus.ts";
import { createContext, decisionPath } from "./context.ts";
import { WorkerError } from "./errors.ts";
import type { GateFn, StageRegistry } from "./stages/index.ts";
import type { JobStore } from "./store.ts";

type RunnableStage = Exclude<StageName, GateName>;

/** A job this process is driving. `job` is the source of truth; state.json follows it. */
type Live = {
  job: Job;
  bus: EventBus;
  abort: AbortController;
  saving: Promise<void>;
};

const TERMINAL: JobStatus[] = ["done", "failed", "cancelled"];
const isGate = (name: StageName): name is GateName => STAGES.find((s) => s.name === name)?.gate === true;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs each job's stage graph (STAGES): starts every pending stage whose `after` stages are done or
 * skipped, waits at gates, and keeps state.json and the event stream up to date. Never blocks a request:
 * stages run in the background and the API only reads state.
 *
 * Not yet: resource pools, retries with backoff, per-stage cache keys (TEAM_TASKS.md, Kaustav task 2).
 */
export class Orchestrator {
  private readonly lives = new Map<string, Promise<Live | undefined>>();

  constructor(
    private readonly store: JobStore,
    private readonly stages: StageRegistry,
    private readonly gates: { [G in GateName]?: GateFn<G> },
    private readonly log: Logger,
  ) {}

  async create(config: JobConfig): Promise<Job> {
    const created = await this.store.create(config);
    const live = (await this.find(created.id))!;
    live.bus.emit({ type: "job", status: "queued" });
    this.advance(live);
    return structuredClone(live.job);
  }

  async get(id: string): Promise<Job | undefined> {
    const live = await this.find(id);
    return live && structuredClone(live.job);
  }

  /** Every job, newest first. */
  async list(): Promise<Job[]> {
    const jobs = await Promise.all(
      (await this.store.ids()).map(async (id) => {
        const live = this.lives.has(id) ? await this.find(id) : undefined;
        if (live) return structuredClone(live.job);
        return this.store.load(id).catch((err) => {
          this.log.warn({ err, jobId: id }, "unreadable job");
          return undefined;
        });
      }),
    );
    return jobs.filter((j) => j !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async events(id: string): Promise<EventBus | undefined> {
    return (await this.find(id))?.bus;
  }

  /** POST /jobs/:id/gates/:gate */
  async decide(id: string, gate: GateName, body: unknown): Promise<Job> {
    const live = await this.require(id);
    const state = live.job.stages[gate];
    if (state.status !== "waiting") throw new WorkerError(409, `${gate} isn't waiting for a decision (it's ${state.status})`);
    const parsed = GATE_DECISIONS[gate].safeParse(body);
    if (!parsed.success) throw new WorkerError(400, z.prettifyError(parsed.error));
    await this.release(live, gate, parsed.data as GateDecision<typeof gate>, { manual: true });
    return structuredClone(live.job);
  }

  async cancel(id: string): Promise<Job> {
    const live = await this.require(id);
    if (TERMINAL.includes(live.job.status)) throw new WorkerError(409, `job is already ${live.job.status}`);
    live.abort.abort();
    for (const { name } of STAGES) {
      const status = live.job.stages[name].status;
      if (status === "running" || status === "waiting" || status === "pending") {
        this.setStage(live, name, { status: "cancelled", finishedAt: new Date().toISOString() });
      }
    }
    this.setJobStatus(live, "cancelled");
    return structuredClone(live.job);
  }

  /** On start: carry on with every unfinished job. Stages that were running start again. */
  async resumeAll(): Promise<string[]> {
    const resumed: string[] = [];
    const unreadable: string[] = [];
    for (const id of await this.store.ids()) {
      let live: Live | undefined;
      try {
        live = await this.find(id);
      } catch (err) {
        // Usually a job folder from an older format; one summary line below instead of a stack per job.
        this.log.debug({ jobId: id, reason: (err as Error).message }, "can't resume an unreadable job");
        unreadable.push(id);
        continue;
      }
      if (!live || TERMINAL.includes(live.job.status)) continue;
      for (const { name } of STAGES) {
        if (live.job.stages[name].status === "running") {
          this.setStage(live, name, { status: "pending", message: "Restarted after a worker restart" });
        }
      }
      live.bus.emit({ type: "log", level: "info", message: "Resumed after a worker restart" });
      this.advance(live);
      resumed.push(id);
    }
    return resumed;
  }

  /**
   * Stops every running stage without recording it as cancelled, so the next start resumes it.
   * Further results from this process are dropped.
   */
  async shutdown(): Promise<void> {
    for (const pending of this.lives.values()) (await pending)?.abort.abort();
    await this.flush();
  }

  /** Waits for every pending state and event write (tests, shutdown). */
  async flush(): Promise<void> {
    for (const pending of this.lives.values()) {
      const live = await pending;
      if (live) await Promise.all([live.saving, live.bus.flush()]);
    }
  }

  private async require(id: string): Promise<Live> {
    const live = await this.find(id);
    if (!live) throw new WorkerError(404, `no job ${id}`);
    return live;
  }

  private find(id: string): Promise<Live | undefined> {
    let pending = this.lives.get(id);
    if (!pending) {
      pending = this.load(id);
      this.lives.set(id, pending);
      pending.then(
        (live) => live || this.lives.delete(id),
        () => this.lives.delete(id),
      );
    }
    return pending;
  }

  private async load(id: string): Promise<Live | undefined> {
    const job = await this.store.load(id);
    if (!job) return undefined;
    const bus = await EventBus.open(id, join(this.store.dir(id), jobPaths.events), (err) =>
      this.log.error({ err, jobId: id }, "couldn't append to events.ndjson"),
    );
    return { job, bus, abort: new AbortController(), saving: Promise.resolve() };
  }

  /** Start whatever is ready, then work out the job's status. Synchronous: stages run in the background. */
  private advance(live: Live): void {
    const { stages } = live.job;
    if (TERMINAL.includes(live.job.status)) return;
    const finished = (name: StageName) => stages[name].status === "done" || stages[name].status === "skipped";
    if (!STAGES.some((s) => stages[s.name].status === "failed")) {
      for (const info of STAGES) {
        if (stages[info.name].status !== "pending" || !info.after.every(finished)) continue;
        if (isGate(info.name)) this.openGate(live, info.name);
        else void this.runStage(live, info.name as RunnableStage);
      }
    }
    const statuses = STAGES.map((s) => stages[s.name].status);
    let status: JobStatus = "running";
    if (statuses.includes("running")) status = "running";
    else if (statuses.includes("failed")) status = "failed";
    else if (statuses.includes("waiting")) status = "waiting";
    else if (statuses.every((s) => s === "done" || s === "skipped")) status = "done";
    this.setJobStatus(live, status);
  }

  private async runStage(live: Live, name: RunnableStage): Promise<void> {
    const attempt = live.job.stages[name].attempts + 1;
    this.setStage(live, name, {
      status: "running",
      attempts: attempt,
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      message: undefined,
      error: undefined,
    });
    try {
      const result = await this.stages[name](this.context(live, name, attempt));
      if (live.abort.signal.aborted) return;
      this.setStage(live, name, {
        status: result?.skipped ? "skipped" : "done",
        finishedAt: new Date().toISOString(),
        message: result?.message,
      });
    } catch (err) {
      if (live.abort.signal.aborted) return;
      this.log.error({ err, jobId: live.job.id, stage: name }, "stage failed");
      this.setStage(live, name, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: { message: errorMessage(err) },
      });
    }
    this.advance(live);
  }

  private openGate(live: Live, gate: GateName): void {
    if (live.job.config.autopilot) {
      void this.release(live, gate, { action: "approve" }, { manual: false }).catch(() => {});
    } else {
      this.setStage(live, gate, { status: "waiting", message: "Waiting for your review" });
    }
  }

  /** Save the decision, apply it, and let the pipeline continue (or, for a preview revise, go back). */
  private async release<G extends GateName>(
    live: Live,
    gate: G,
    decision: GateDecision<G>,
    { manual }: { manual: boolean },
  ): Promise<void> {
    const attempt = live.job.stages[gate].attempts + 1;
    this.setStage(live, gate, { status: "running", attempts: attempt, message: "Applying the review" });
    const ctx = this.context(live, gate, attempt);
    try {
      await writeArtifact(ctx.path(decisionPath(gate)), GATE_DECISIONS[gate], decision);
      await this.gates[gate]?.(ctx, decision);
    } catch (err) {
      if (manual) {
        // A decision that doesn't fit the job (e.g. an unknown flow id): keep waiting, tell the caller.
        this.setStage(live, gate, { status: "waiting", message: `Couldn't apply that: ${errorMessage(err)}` });
        throw new WorkerError(400, errorMessage(err));
      }
      this.setStage(live, gate, { status: "failed", error: { message: errorMessage(err) } });
      this.advance(live);
      throw err;
    }
    if (gate === "gate-preview" && decision.action === "revise") {
      this.setStage(live, "direct", { status: "pending", message: `Revising: ${decision.revise}` });
      this.setStage(live, "preview", { status: "pending", message: undefined });
      this.setStage(live, gate, { status: "pending", message: undefined });
    } else {
      const message = manual ? "Approved" : "Approved on autopilot";
      this.setStage(live, gate, { status: "done", finishedAt: new Date().toISOString(), message });
    }
    this.advance(live);
  }

  private context(live: Live, stage: StageName, attempt: number) {
    return createContext({
      jobId: live.job.id,
      stage,
      attempt,
      config: live.job.config,
      dir: this.store.dir(live.job.id),
      signal: live.abort.signal,
      bus: live.bus,
    });
  }

  private setStage(live: Live, name: StageName, patch: Partial<StageState>): void {
    const next = { ...live.job.stages[name], ...patch };
    live.job.stages[name] = next;
    this.touch(live);
    live.bus.emit({
      type: "stage",
      stage: name,
      status: next.status,
      attempt: next.attempts > 0 ? next.attempts : undefined,
      message: next.message,
      error: next.error,
    });
  }

  private setJobStatus(live: Live, status: JobStatus): void {
    if (live.job.status === status) return;
    live.job.status = status;
    this.touch(live);
    live.bus.emit({ type: "job", status });
  }

  /** Mark updated and queue a state.json write (writes are serialized per job). */
  private touch(live: Live): void {
    live.job.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(live.job);
    live.saving = live.saving
      .then(() => this.store.save(snapshot))
      .catch((err) => this.log.error({ err, jobId: live.job.id }, "couldn't save state.json"));
  }
}
