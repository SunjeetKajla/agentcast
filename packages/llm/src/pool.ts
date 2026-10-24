import { LlmError } from "./errors";

/** At most `size` tasks at once; the rest queue in order. Subscription logins have usage limits (PRD §9.9). */
export class Pool {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const cancelled = () => new LlmError("llm.cancelled", "LLM task cancelled");
    if (signal?.aborted) throw cancelled();
    if (this.active >= this.size)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = this.queue.indexOf(ready);
          if (index >= 0) this.queue.splice(index, 1);
          signal?.removeEventListener("abort", abort);
          reject(cancelled());
        };
        this.queue.push(ready);
        signal?.addEventListener("abort", abort, { once: true });
      });
    else this.active++;
    try {
      if (signal?.aborted) throw cancelled();
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next)
        next(); // Reserve this slot for the queued caller before yielding.
      else this.active--;
    }
  }
}
