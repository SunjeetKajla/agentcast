// @agentcast/llm: the LLM runner (PRD §9.9). The only place that spawns claude / codex (AGENTS.md rule 1).
// Stages call createLlm() (or sharedLlm()) and never know which coding agent answers.
//
//   AGENTCAST_LLM=auto|claude-code|codex          default auto: Claude Code if installed, else Codex
//   AGENTCAST_LLM_SMART / AGENTCAST_LLM_FAST      per-tier backend override
//   AGENTCAST_LLM_SMART_MODEL / _FAST_MODEL       per-tier model; Claude Code defaults opus / haiku,
//                                                 Codex uses its own default
//   AGENTCAST_LLM_CONCURRENCY                     calls at once across the process (default 2)
//   AGENTCAST_CLAUDE_BIN / AGENTCAST_CODEX_BIN    the CLI to run (default: claude / codex on PATH)
import type { z } from "zod";
import { claudeCode } from "./backends/claude-code.ts";
import { codex } from "./backends/codex.ts";
import { LlmError } from "./errors.ts";
import { Pool } from "./pool.ts";
import { BACKENDS, type AgentResult, type AgentTask, type BackendName, type Detection, type JsonTask, type LlmBackend, type OnEvent, type Tier } from "./types.ts";

export { LlmError, type LlmErrorCode } from "./errors.ts";
export { UNTRUSTED_RULE, untrusted } from "./prompt.ts";
export type { AgentResult, AgentTask, BackendName, Detection, JsonTask, LlmBackend, LlmEvent, OnEvent, Tier } from "./types.ts";
export { BACKENDS } from "./types.ts";

const DEFAULT_MODELS: Record<BackendName, Record<Tier, string | undefined>> = {
  "claude-code": { smart: "opus", fast: "haiku" },
  codex: { smart: undefined, fast: undefined },
};

const INSTALL: Record<BackendName, string> = {
  "claude-code": "Install Claude Code (https://claude.com/claude-code) and log in with `claude`.",
  codex: "Install Codex (`npm i -g @openai/codex`, 0.163+) and log in with `codex login`.",
};

export type Resolved = { backend: BackendName; model: string | undefined };

export type Llm = {
  /** A schema-checked answer (one repair round if the first answer doesn't validate). */
  json<S extends z.ZodType>(task: JsonTask<S>, onEvent?: OnEvent): Promise<z.output<S>>;
  /** Let the coding agent edit files in a workspace. The caller verifies the result. */
  agent(task: AgentTask, onEvent?: OnEvent): Promise<AgentResult>;
  /** Which backend and model a tier uses. Throws llm.unavailable if none can. */
  resolve(tier: Tier): Promise<Resolved>;
  /** Every supported backend and whether it's installed (agentcast doctor). */
  detectAll(): Promise<Record<BackendName, Detection>>;
};

export type LlmOptions = {
  /** Overrides AGENTCAST_LLM. */
  backend?: BackendName | "auto";
  /** For tests. */
  backends?: Record<BackendName, LlmBackend>;
  concurrency?: number;
  env?: NodeJS.ProcessEnv;
};

export function createLlm(opts: LlmOptions = {}): Llm {
  const env = opts.env ?? process.env;
  const backends = opts.backends ?? { "claude-code": claudeCode, codex };
  const pool = new Pool(opts.concurrency ?? (Number(env.AGENTCAST_LLM_CONCURRENCY) || 2));
  const detections = new Map<BackendName, Promise<Detection>>();
  const detect = (name: BackendName) => {
    let d = detections.get(name);
    if (!d) detections.set(name, (d = backends[name].detect()));
    return d;
  };

  async function pick(choice: string): Promise<BackendName> {
    if (choice === "auto") {
      for (const name of BACKENDS) if ((await detect(name)).ok) return name;
      throw new LlmError("llm.unavailable", `No coding agent found. ${INSTALL["claude-code"]} Or: ${INSTALL.codex}`);
    }
    if (!(BACKENDS as readonly string[]).includes(choice)) {
      throw new LlmError("llm.unavailable", `AGENTCAST_LLM=${choice} isn't supported; use auto, claude-code or codex.`);
    }
    const name = choice as BackendName;
    const d = await detect(name);
    if (!d.ok) throw new LlmError("llm.unavailable", `${name} isn't available (${d.reason}). ${INSTALL[name]}`);
    return name;
  }

  async function resolve(tier: Tier): Promise<Resolved> {
    const upper = tier.toUpperCase();
    const choice = env[`AGENTCAST_LLM_${upper}`] || opts.backend || env.AGENTCAST_LLM || "auto";
    const backend = await pick(choice);
    const model = env[`AGENTCAST_LLM_${upper}_MODEL`] || DEFAULT_MODELS[backend][tier];
    return { backend, model };
  }

  return {
    async json(task, onEvent) {
      const { backend, model } = await resolve(task.tier);
      return pool.run(() => backends[backend].json(task, model, onEvent));
    },
    async agent(task, onEvent) {
      const { backend, model } = await resolve(task.tier);
      return pool.run(() => backends[backend].agent(task, model, onEvent));
    },
    resolve,
    async detectAll() {
      const entries = await Promise.all(BACKENDS.map(async (name) => [name, await detect(name)] as const));
      return Object.fromEntries(entries) as Record<BackendName, Detection>;
    },
  };
}

let shared: Llm | undefined;
/** One runner per process, so AGENTCAST_LLM_CONCURRENCY holds across every stage. */
export function sharedLlm(): Llm {
  return (shared ??= createLlm());
}
