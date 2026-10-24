import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CDPSession, Page } from "playwright-core";
import type { CapturedFrame } from "./timing.ts";

export interface CaptureOptions {
  directory: string;
  maxWidth: number;
  maxHeight: number;
  quality?: number;
  maxQueueBytes?: number;
  firstFrameTimeoutMs?: number;
  /** Required physical source dimensions, checked before publishing the MP4. */
  expectedSize?: { width: number; height: number };
}

export interface CaptureResult {
  directory: string;
  frames: CapturedFrame[];
  startedAtMs: number;
  durationMs: number;
  expectedSize?: { width: number; height: number };
}

export interface Screencast {
  startedAtMs: number;
  /** Rejects on I/O, CDP or timestamp failure so the action can be interrupted. */
  failure: Promise<never>;
  stop(): Promise<CaptureResult>;
}

interface FrameEvent {
  data: string;
  metadata: { timestamp?: number; monotonicTimestamp?: number };
  sessionId: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // The owner may be awaiting startup before attaching its failure race.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("CDP screencast command timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Install the listener before starting CDP, and ACK before any disk I/O. */
export async function startScreencast(
  page: Page,
  options: CaptureOptions,
): Promise<Screencast> {
  if (
    ![options.maxWidth, options.maxHeight].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  )
    throw new Error("Capture dimensions must be positive integers");
  const quality = options.quality ?? 85;
  const maxQueueBytes = options.maxQueueBytes ?? 64 * 1024 * 1024;
  const firstFrameTimeoutMs = options.firstFrameTimeoutMs ?? 5_000;
  if (
    !Number.isInteger(quality) ||
    quality < 0 ||
    quality > 100 ||
    !Number.isFinite(maxQueueBytes) ||
    maxQueueBytes <= 0 ||
    !Number.isFinite(firstFrameTimeoutMs) ||
    firstFrameTimeoutMs <= 0
  )
    throw new Error("Invalid screencast options");
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const first = deferred<void>();
  const failed = deferred<never>();
  const frames: CapturedFrame[] = [];
  const acknowledgements = new Set<Promise<unknown>>();
  let writes = Promise.resolve();
  let queuedBytes = 0;
  let error: unknown;
  let accepting = true;
  let startedAtMs = 0;
  let closing: Promise<CaptureResult> | undefined;
  let timestampKey: "timestamp" | "monotonicTimestamp" | undefined;
  const fail = (reason: unknown) => {
    error ??= reason;
    first.reject(error);
    failed.reject(error);
  };
  const onFrame = ({ data, metadata, sessionId }: FrameEvent) => {
    const receivedAtMs = performance.now();
    const ack = bounded(
      cdp.send("Page.screencastFrameAck", { sessionId }),
      5_000,
    ).catch(fail);
    acknowledgements.add(ack);
    void ack.then(() => acknowledgements.delete(ack));
    if (!accepting || error) return;
    timestampKey ??= Number.isFinite(metadata.monotonicTimestamp)
      ? "monotonicTimestamp"
      : "timestamp";
    const timestamp = metadata[timestampKey];
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      fail(new Error("CDP frame is missing its timestamp"));
      return;
    }
    const timestampMs = timestamp * 1000;
    const previous = frames.at(-1);
    if (previous && timestampMs === previous.timestampMs) return;
    if (previous && timestampMs < previous.timestampMs) {
      fail(new Error("CDP frame timestamps moved backwards"));
      return;
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      fail(new Error("CDP did not return a JPEG frame"));
      return;
    }
    if (queuedBytes + bytes.length > maxQueueBytes) {
      fail(new Error("Screencast write queue exceeded its byte limit"));
      return;
    }
    queuedBytes += bytes.length;
    const file = `frame-${String(frames.length).padStart(8, "0")}.jpg`;
    frames.push({ file, timestampMs, receivedAtMs });
    // A serialized bounded queue keeps names/timestamps in arrival order. Errors
    // are observed immediately, not left as unhandled async event rejections.
    writes = writes
      .then(async () => {
        try {
          await writeFile(join(options.directory, file), bytes, {
            flag: "wx",
            mode: 0o600,
          });
        } finally {
          queuedBytes -= bytes.length;
        }
      })
      .catch(fail);
    first.resolve();
  };
  const onClose = () => fail(new Error("The recorded page closed"));
  const onCrash = () => fail(new Error("The recorded page crashed"));
  cdp.on("Page.screencastFrame", onFrame);
  page.on("close", onClose);
  page.on("crash", onCrash);
  const stop = (): Promise<CaptureResult> => {
    if (closing) return closing;
    const stoppedAtMs = performance.now();
    accepting = false;
    closing = (async () => {
      try {
        await bounded(cdp.send("Page.stopScreencast"), 5_000).catch(fail);
      } finally {
        cdp.off("Page.screencastFrame", onFrame);
        page.off("close", onClose);
        page.off("crash", onCrash);
        await Promise.all([...acknowledgements]);
        await writes;
        await bounded(cdp.detach(), 2_000).catch(fail);
      }
      if (error) throw error;
      return {
        directory: options.directory,
        frames,
        startedAtMs,
        durationMs: stoppedAtMs - startedAtMs,
        expectedSize: options.expectedSize,
      };
    })();
    return closing;
  };
  const timer = setTimeout(
    () => fail(new Error("No initial CDP screencast frame")),
    firstFrameTimeoutMs,
  );
  try {
    await Promise.race([cdp.send("Page.bringToFront"), failed.promise]);
    await Promise.race([
      cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        everyNthFrame: 1,
      }),
      failed.promise,
    ]);
    await first.promise;
    startedAtMs = performance.now();
    return { startedAtMs, failure: failed.promise, stop };
  } catch (reason) {
    await stop().catch(() => {});
    throw reason;
  } finally {
    clearTimeout(timer);
  }
}
