import { appendFile, readFile } from "node:fs/promises";
import { JobEvent, type JobEventInput } from "@agentcast/shared";

type Listener = (event: JobEvent) => void;

/**
 * One job's event stream: numbers each event, appends it to events.ndjson and tells live listeners (SSE).
 * The whole history stays in memory so a subscriber can replay and then follow without missing anything.
 */
export class EventBus {
  private readonly listeners = new Set<Listener>();
  private writes: Promise<void> = Promise.resolve();

  private constructor(
    readonly jobId: string,
    private readonly file: string,
    private readonly history: JobEvent[],
    private readonly onWriteError: (err: unknown) => void,
  ) {}

  static async open(jobId: string, file: string, onWriteError: (err: unknown) => void): Promise<EventBus> {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const history: JobEvent[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      // A crash can leave a torn last line; skip anything that doesn't parse.
      try {
        history.push(JobEvent.parse(JSON.parse(line)));
      } catch {}
    }
    return new EventBus(jobId, file, history, onWriteError);
  }

  emit(input: JobEventInput): JobEvent {
    const event = JobEvent.parse({
      ...input,
      seq: (this.history.at(-1)?.seq ?? 0) + 1,
      at: new Date().toISOString(),
      jobId: this.jobId,
    });
    this.history.push(event);
    const line = JSON.stringify(event) + "\n";
    this.writes = this.writes.then(() => appendFile(this.file, line)).catch(this.onWriteError);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Events after `seq` (0 for all). */
  since(seq: number): JobEvent[] {
    return this.history.filter((e) => e.seq > seq);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once everything emitted so far is on disk. */
  flush(): Promise<void> {
    return this.writes;
  }
}
