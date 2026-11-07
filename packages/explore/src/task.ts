import { createHash } from "node:crypto";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  ExplorationAgent,
  ExplorationRequest,
  BrowserProgress,
} from "@agentcast/browser";
import type { BrowserOptions } from "./runtime";
import { ExplorationTask } from "./artifacts";
import type { ArtifactIO } from "./runtime";

export const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Redact reports before they can become durable data or inputs to another model. */
export function safeReport(value: unknown): unknown {
  const secretKey =
    /^(password|api_?key|access_?token|refresh_?token|cookie|authorization)$/i;
  const secretStep = (source: Record<string, unknown>) =>
    source.secret === true ||
    /pass(word|code|phrase)?|\bpin\b|\botp\b|secret|token|api[ _-]?key|card number|cvv|cvc/i.test(
      [source.target_text, source.target_label, source.target_placeholder]
        .filter((v) => typeof v === "string")
        .join(" "),
    );
  const secrets = new Set<string>();
  const collect = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(collect);
      return;
    }
    if (!item || typeof item !== "object") return;
    const source = item as Record<string, unknown>;
    for (const [key, nested] of Object.entries(source)) {
      if (
        typeof nested === "string" &&
        nested &&
        (secretKey.test(key) || (key === "value" && secretStep(source)))
      )
        secrets.add(nested);
      collect(nested);
    }
  };
  collect(value);
  const scrub = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(scrub);
    if (typeof item === "string") {
      let text = item;
      for (const secret of secrets)
        if (text === secret || secret.length >= 3)
          text = text.replaceAll(secret, "[redacted]");
      return text;
    }
    if (item && typeof item === "object") {
      const source = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(source).map(([key, nested]) => [
          key,
          secretKey.test(key) || (secretStep(source) && key === "value")
            ? { redacted: true }
            : scrub(nested),
        ]),
      );
    }
    return item;
  };
  return scrub(value);
}

// Account-wide within the worker process. Waiting work is cancellable and does not occupy a slot.
let active = 0;
const waiters: Array<() => void> = [];
async function limited<T>(
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  if (active >= 2)
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = waiters.indexOf(ready);
        if (index >= 0) waiters.splice(index, 1);
        reject(signal?.reason);
      };
      waiters.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
  // A released slot is reserved for the waiter; otherwise increment it here.
  else active++;
  try {
    signal?.throwIfAborted();
    return await fn();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}

export type ExplorationUpdate = {
  status: "RUNNING" | "COMPLETED";
  steps: BrowserProgress[];
};
export type TaskOptions<S extends z.ZodType> = {
  id: string;
  request: ExplorationRequest;
  schema: S;
  io: ArtifactIO;
  agent: ExplorationAgent;
  storageState?: BrowserOptions["storageState"];
  signal?: AbortSignal;
  maxMs: number;
  maxSteps?: number;
  onUpdate?: (run: ExplorationUpdate) => void | Promise<void>;
};

/** Complete results are reusable. Interrupted browser mutations are never automatically repeated. */
export async function runTask<S extends z.ZodType>(
  options: TaskOptions<S>,
): Promise<{ result: z.output<S>; runId: string }> {
  if (!/^[a-z0-9_-]{1,80}$/i.test(options.id))
    throw new Error("Invalid exploration task id.");
  return limited(options.signal, async () => {
    const { io, id, request } = options;
    const file = `explore/tasks/${id}.json`;
    const hash = requestHash([
      request,
      requestHash(options.storageState ?? "public"),
    ]);
    let checkpoint: ExplorationTask | undefined;
    try {
      checkpoint = await io.read(file, ExplorationTask);
    } catch (error) {
      if (
        (error as { cause?: NodeJS.ErrnoException }).cause?.code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    if (checkpoint) {
      if (checkpoint.state !== "done")
        throw new Error(
          "Previous exploration was interrupted or failed. Start fresh exploration in a new job; browser actions will not be repeated automatically.",
        );
      if (checkpoint.requestHash !== hash)
        throw new Error("Exploration inputs changed. Start a new job.");
      return {
        result: options.schema.parse(checkpoint.result),
        runId: checkpoint.runId!,
      };
    }
    const runId = randomUUID();
    const save = async (patch: Partial<ExplorationTask>) => {
      checkpoint = ExplorationTask.parse({
        ...checkpoint,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      await io.write(file, ExplorationTask, checkpoint);
    };
    await save({
      schemaVersion: 2,
      id,
      runId,
      requestHash: hash,
      state: "running",
      startedAt: new Date().toISOString(),
    });
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.maxMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    const steps: BrowserProgress[] = [];
    try {
      const response = await options.agent.run({
        id,
        request,
        schema: options.schema,
        signal,
        maxSteps: options.maxSteps ?? 32,
        storageState: options.storageState,
        onStep: async (step) => {
          steps.push(step);
          await options.onUpdate?.({ status: "RUNNING", steps: [...steps] });
        },
      });
      signal.throwIfAborted();
      const result = options.schema.parse(safeReport(response.result));
      await save({
        state: "done",
        result: result as Record<string, unknown>,
        sessionId: response.sessionId,
      });
      await options.onUpdate?.({ status: "COMPLETED", steps });
      return { result, runId };
    } catch (error) {
      await save({
        state: signal.aborted ? "interrupted" : "failed",
        error: signal.aborted
          ? "Exploration cancelled or timed out; start a new job."
          : "Browser exploration failed; start a new job.",
      });
      if (options.signal?.aborted) throw options.signal.reason;
      throw error;
    }
  });
}
