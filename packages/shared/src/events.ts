import { z } from "zod";
import { IsoTime } from "./common.ts";
import { GateName, JobStatus, StageError, StageName, StageStatus } from "./job.ts";

// events.ndjson and the SSE stream (GET /jobs/:id/events). One JSON object per line / message.

const base = {
  /** Monotonic per job, from 1. SSE sends it as the event id, so a reconnect resumes after it. */
  seq: z.number().int().positive(),
  at: IsoTime,
  jobId: z.string(),
};

export const JobEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("job"), status: JobStatus, message: z.string().optional() }),
  z.object({
    ...base,
    type: z.literal("stage"),
    stage: StageName,
    status: StageStatus,
    attempt: z.number().int().positive().optional(),
    message: z.string().optional(),
    error: StageError.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("progress"),
    stage: StageName,
    /** 0–1 */
    progress: z.number().min(0).max(1),
    message: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("log"),
    stage: StageName.optional(),
    level: z.enum(["info", "warn", "error"]),
    message: z.string(),
  }),
  /** Coding-agent progress, e.g. "Edit edl.json" (packages/llm LlmEvent). */
  z.object({
    ...base,
    type: z.literal("llm"),
    stage: StageName,
    kind: z.enum(["text", "tool_use", "done", "error"]),
    text: z.string(),
  }),
  /** A TinyFish agent run, for the live agent views. */
  z.object({
    ...base,
    type: z.literal("agent"),
    stage: StageName,
    /** Task or flow id; stable across a run's events. */
    agentId: z.string(),
    title: z.string(),
    status: z.enum(["started", "step", "done", "failed", "cancelled"]),
    /** TinyFish live view; safe to send to the browser. */
    streamingUrl: z.url().optional(),
    step: z.string().optional(),
    /** Job-relative path or TinyFish URL of the latest frame. */
    screenshot: z.string().optional(),
  }),
  /** An artifact was written; the UI can refetch it from GET /files/<jobId>/<path>. */
  z.object({ ...base, type: z.literal("artifact"), stage: StageName, path: z.string() }),
  /** Work a waiting gate runs without releasing it (edit-step, add-flow). */
  z.object({
    ...base,
    type: z.literal("action"),
    gate: GateName,
    name: z.string(),
    status: z.enum(["started", "done", "failed"]),
    message: z.string().optional(),
  }),
]);
export type JobEvent = z.infer<typeof JobEvent>;
export type JobEventType = JobEvent["type"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What a stage emits; the event bus adds seq, at and jobId. */
export type JobEventInput = DistributiveOmit<JobEvent, "seq" | "at" | "jobId">;
