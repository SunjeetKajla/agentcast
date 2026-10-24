import { join } from "node:path";
import {
  GATE_DECISIONS,
  type GateDecision,
  type GateName,
  type JobConfig,
  type JobEventInput,
  type StageName,
} from "@agentcast/shared";
import { ArtifactError, readArtifact, writeArtifact } from "@agentcast/shared/node";
import { sharedLlm, type Llm, type OnEvent } from "@agentcast/llm";
import type { z } from "zod";
import type { EventBus } from "./bus.ts";

/** What a stage gets. Stages talk to the job only through this. */
export type StageContext = {
  readonly jobId: string;
  readonly stage: StageName;
  /** 1 on the first run of this stage. */
  readonly attempt: number;
  readonly config: JobConfig;
  /** The job dir. Prefer path() with jobPaths. */
  readonly dir: string;
  /** Aborted when the job is cancelled. Pass it to every long call. */
  readonly signal: AbortSignal;
  /** Absolute path of a job-relative path. */
  path(rel: string): string;
  /** Read and validate a JSON artifact. */
  read<S extends z.ZodType>(rel: string, schema: S): Promise<z.output<S>>;
  /** Validate and write a JSON artifact atomically, then announce it. */
  write<S extends z.ZodType>(rel: string, schema: S, data: z.input<S>): Promise<z.output<S>>;
  /** Announce a file the stage wrote itself (mp4, mp3, jpg…). */
  artifact(rel: string): void;
  log(message: string, level?: "info" | "warn" | "error"): void;
  /** 0–1 */
  progress(progress: number, message?: string): void;
  /** Any other event: agent (live views), llm (coding-agent progress), action. */
  emit(event: JobEventInput): void;
  /** The decision made at a gate, once it has been made. */
  decision<G extends GateName>(gate: G): Promise<GateDecision<G> | undefined>;
  /** The coding agent (Claude Code or Codex, whichever AGENTCAST_LLM picks). Pass llmProgress as onEvent. */
  llm: Llm;
  /** Forwards LLM progress to the job page as "llm" events. */
  llmProgress: OnEvent;
};

/** Gate decisions are kept at gates/<gate>.json so later stages can read them. */
export const decisionPath = (gate: GateName) => `gates/${gate}.json`;

export function createContext(opts: {
  jobId: string;
  stage: StageName;
  attempt: number;
  config: JobConfig;
  dir: string;
  signal: AbortSignal;
  bus: EventBus;
}): StageContext {
  const { bus, stage, dir } = opts;
  const path = (rel: string) => join(dir, rel);
  return {
    jobId: opts.jobId,
    stage,
    attempt: opts.attempt,
    config: opts.config,
    dir,
    signal: opts.signal,
    path,
    read: (rel, schema) => readArtifact(path(rel), schema),
    async write(rel, schema, data) {
      const written = await writeArtifact(path(rel), schema, data);
      bus.emit({ type: "artifact", stage, path: rel });
      return written;
    },
    artifact: (rel) => bus.emit({ type: "artifact", stage, path: rel }),
    log: (message, level = "info") => bus.emit({ type: "log", stage, level, message }),
    progress: (progress, message) =>
      bus.emit({ type: "progress", stage, progress: Math.min(1, Math.max(0, progress)), message }),
    emit: (event) => bus.emit(event),
    llm: sharedLlm(),
    llmProgress: (e) => bus.emit({ type: "llm", stage, kind: e.kind, text: e.text }),
    async decision(gate) {
      try {
        return (await readArtifact(path(decisionPath(gate)), GATE_DECISIONS[gate])) as GateDecision<typeof gate>;
      } catch (err) {
        if (err instanceof ArtifactError && (err.cause as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
        throw err;
      }
    },
  };
}
