import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { z } from "zod";
import {
  TinyFishError,
  type AgentRequest,
  type Run,
  type TinyFish,
} from "@agentcast/tinyfish";
import { ExplorationTask } from "./artifacts";
import { ExplorationWatchdog } from "./access";
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

export type TaskOptions<S extends z.ZodType> = {
  id: string;
  request: AgentRequest;
  schema: S;
  io: ArtifactIO;
  tf: TinyFish;
  signal?: AbortSignal;
  maxMs: number;
  maxSteps?: number;
  idleMs?: number;
  intervalMs?: number;
  onUpdate?: (run: Run) => void | Promise<void>;
};

/** Durable single submission. A lost run-creation response is never submitted again automatically. */
export async function runTask<S extends z.ZodType>(
  options: TaskOptions<S>,
): Promise<{ result: z.output<S>; runId: string }> {
  if (!/^[a-z0-9_-]{1,80}$/i.test(options.id))
    throw new Error("Invalid exploration task id.");
  return limited(options.signal, async () => {
    const { io, tf, request, id } = options;
    const file = `explore/tasks/${id}.json`;
    const hash = requestHash(request);
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
    if (checkpoint && checkpoint.requestHash !== hash)
      throw new Error(
        "Exploration inputs changed. Start a new job; existing run IDs cannot be reused with different goals.",
      );
    if (checkpoint?.state === "done")
      return {
        result: options.schema.parse(checkpoint.result),
        runId: checkpoint.runId!,
      };
    if (checkpoint && !checkpoint.runId)
      throw new Error(
        `${checkpoint.error ?? "Run creation could not be confirmed."} It will not be submitted twice; start a new job after checking provider runs.`,
      );
    if (checkpoint?.state === "failed")
      throw new Error(checkpoint.error ?? "The saved exploration run failed.");
    const save = async (patch: Partial<ExplorationTask>) => {
      checkpoint = ExplorationTask.parse({
        ...checkpoint,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      await io.write(file, ExplorationTask, checkpoint);
    };
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.maxMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    if (!checkpoint) {
      await save({
        schemaVersion: 1,
        id,
        requestHash: hash,
        state: "creating",
        startedAt: new Date().toISOString(),
      });
      try {
        await save({
          runId: await tf.runAsync(request, signal),
          state: "running",
        });
      } catch (error) {
        const known =
          error instanceof TinyFishError &&
          error.status < 500 &&
          error.status !== 408;
        await save({
          state: known ? "failed" : "uncertain",
          error: known
            ? (error as Error).message
            : "Run creation could not be confirmed.",
        });
        throw error;
      }
    }
    const watchdog = new ExplorationWatchdog(
      Date.now(),
      options.maxSteps ?? 32,
      // An agent writing its final report adds no steps for a while (a shadcn/ui scout: 92 s), so
      // only a longer silence counts as stuck.
      options.idleMs ?? 150_000,
    );
    const accept = async (run: Run) => {
      if (run.status !== "COMPLETED") return undefined;
      const result = options.schema.parse(safeReport(run.result));
      await save({
        state: "done",
        result: result as Record<string, unknown>,
        error: undefined,
      });
      return { result, runId: run.run_id };
    };
    try {
      for (;;) {
        signal.throwIfAborted();
        const run = await tf.getRun(checkpoint!.runId!, signal);
        const complete = await accept(run);
        if (complete) {
          await options.onUpdate?.(run);
          return complete;
        }
        if (run.status === "FAILED" || run.status === "CANCELLED") {
          const message = `TinyFish run ${run.status.toLowerCase()}${run.error?.code ? ` (${run.error.code})` : ""}.`;
          await save({ state: "failed", error: message });
          throw new Error(message);
        }
        for (const step of run.steps) {
          const problem = watchdog.observe(step, Date.now());
          if (problem) throw new Error(problem);
        }
        const idle = watchdog.idle(Date.now());
        if (idle) throw new Error(idle);
        await options.onUpdate?.(run);
        await delay(options.intervalMs ?? 1500, undefined, { signal });
      }
    } catch (error) {
      if (!options.signal?.aborted) {
        // A terminal result may arrive just as the local deadline fires. Recover it without a POST.
        const run = await tf
          .getRun(checkpoint!.runId!, AbortSignal.timeout(5000))
          .catch(() => undefined);
        if (run) {
          const result = await accept(run);
          if (result) return result;
        }
      }
      await tf.cancelRun(checkpoint!.runId!).catch(() => {});
      if (options.signal?.aborted) throw options.signal.reason;
      if (signal.aborted)
        throw new Error(
          `${id} exceeded its ${Math.round(options.maxMs / 1000)} s deadline; its run ID was saved.`,
        );
      throw error;
    }
  });
}
