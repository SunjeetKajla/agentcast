import type { z } from "zod";

export const BACKENDS = ["claude-code", "codex"] as const;
export type BackendName = (typeof BACKENDS)[number];

/** smart: director, storyboard, scripts. fast: briefs, judge, healing (PRD §9.9). */
export type Tier = "smart" | "fast";

/** Progress for the UI (JobEvent type "llm"). */
export type LlmEvent = { kind: "text" | "tool_use" | "done" | "error"; text: string };
export type OnEvent = (event: LlmEvent) => void;

export type JsonTask<S extends z.ZodType> = {
  /** Put website content in through untrusted() (AGENTS.md rule 7). */
  prompt: string;
  schema: S;
  tier: Tier;
  /** Absolute paths of screenshots the model should look at. */
  images?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type AgentTask = {
  /** The workspace. The agent can read and edit files here and nowhere else. */
  cwd: string;
  prompt: string;
  tier: Tier;
  /**
   * Command prefixes the agent may run, e.g. "npx tsc --noEmit". Claude Code only: Codex runs with its
   * shell off, so the worker must run these checks itself and send failures back with resume.
   */
  allowCommands?: string[];
  /** Absolute paths of images to show the agent (e.g. rendered stills). */
  images?: string[];
  /** A session id from an earlier agent() call: continue that conversation. */
  resume?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type AgentResult = {
  /** Pass back as `resume` to continue (revisions, repair rounds). */
  sessionId: string;
  /** The agent's final message. */
  text: string;
};

export type Detection = { ok: true; version: string } | { ok: false; reason: string };

export interface LlmBackend {
  readonly name: BackendName;
  /** Is the CLI installed (and new enough)? Doesn't spend quota. */
  detect(): Promise<Detection>;
  json<S extends z.ZodType>(task: JsonTask<S>, model: string | undefined, onEvent?: OnEvent): Promise<z.output<S>>;
  agent(task: AgentTask, model: string | undefined, onEvent?: OnEvent): Promise<AgentResult>;
}
