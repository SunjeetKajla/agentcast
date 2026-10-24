import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { LlmError } from "./errors.ts";
import type { JsonTask } from "./types.ts";

/**
 * Ask, check the answer with zod, and on failure ask once more with the errors (PRD §9.9 rule 1).
 * `ask` gets the prompt for this round and returns the raw (already restored) answer.
 */
export async function askValidated<S extends z.ZodType>(
  task: JsonTask<S>,
  ask: (prompt: string) => Promise<unknown>,
): Promise<z.output<S>> {
  let prompt = task.prompt;
  for (let round = 1; ; round++) {
    const answer = await ask(prompt);
    const parsed = task.schema.safeParse(answer);
    if (parsed.success) return parsed.data;
    const errors = z.prettifyError(parsed.error);
    if (round === 2) throw new LlmError("llm.invalid", `The answer didn't match the schema:\n${errors}`, JSON.stringify(answer));
    prompt =
      `${task.prompt}\n\nYour previous answer was:\n${JSON.stringify(answer)}\n` +
      `It failed validation:\n${errors}\nAnswer again, fixing these problems.`;
  }
}

/** A scratch dir for one task, removed afterwards. */
export async function withTaskDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-llm-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const DEFAULT_JSON_TIMEOUT = 3 * 60_000;
export const DEFAULT_AGENT_TIMEOUT = 8 * 60_000;
