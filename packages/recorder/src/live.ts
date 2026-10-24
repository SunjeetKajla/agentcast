import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  withRecorderBrowser,
  type RecorderBrowser,
  type RecorderBrowserOptions,
} from "./browser.ts";
import {
  encodeCfrMp4,
  type EncodedVideo,
  type EncodingOptions,
} from "./encode.ts";
import {
  startScreencast,
  type CaptureOptions,
  type Screencast,
} from "./screencast.ts";
import {
  alignFrames,
  checkStalls,
  type MotionWindow,
  type StallReport,
} from "./timing.ts";
import type { GpuInfo } from "./gpu.ts";

export interface LiveControls extends RecorderBrowser {
  attempt: number;
  signal: AbortSignal;
  /** Scene time in milliseconds, matching the source video. */
  now(): number;
  /** Mark scrolling/animation phases; exclude static holds, resolution and loading waits. */
  motion<T>(run: () => Promise<T>): Promise<T>;
}

export interface LiveOptions {
  outputPath: string;
  browser?: RecorderBrowserOptions;
  /** Runs before capture on every fresh take: navigate, restore/reset app data, settle. */
  prepare?: (
    session: RecorderBrowser,
    attempt: number,
    signal: AbortSignal,
  ) => Promise<void>;
  maxTakes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  capture?: Pick<
    CaptureOptions,
    "quality" | "maxQueueBytes" | "firstFrameTimeoutMs"
  >;
  encoding?: Omit<EncodingOptions, "signal">;
}

export interface LiveRecording extends EncodedVideo {
  mode: "live";
  sourceDurationMs: number;
  sourceFrameCount: number;
  stall: StallReport;
  takes: { attempt: number; stall: StallReport }[];
  gpu: GpuInfo;
}

export class LiveStallError extends Error {
  constructor(
    public readonly takes: { attempt: number; stall: StallReport }[],
  ) {
    super(`Live recording failed stall checks after ${takes.length} take(s)`);
    this.name = "LiveStallError";
  }
}

async function interruptible<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** A callback must be replayable: quality failures retry the entire take, at most three times. */
export async function recordLive(
  options: LiveOptions,
  run: (controls: LiveControls) => Promise<void>,
): Promise<LiveRecording> {
  const maxTakes = options.maxTakes ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (
    !Number.isInteger(maxTakes) ||
    maxTakes < 1 ||
    maxTakes > 3 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new Error("Live recording needs 1–3 takes and a positive timeout");
  const outputPath = resolve(options.outputPath);
  if (!outputPath.toLowerCase().endsWith(".mp4"))
    throw new Error("Live output must be an .mp4 file");
  await access(outputPath).then(
    () => {
      throw new Error("Recording output already exists");
    },
    (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    },
  );
  await mkdir(dirname(outputPath), { recursive: true });
  const takes: LiveRecording["takes"] = [];
  for (let attempt = 1; attempt <= maxTakes; attempt++) {
    options.signal?.throwIfAborted();
    const directory = await mkdtemp(
      join(dirname(outputPath), ".agentcast-live-"),
    );
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new Error("Live take timed out")),
      timeoutMs,
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline.signal])
      : deadline.signal;
    let capture: Screencast | undefined;
    try {
      const result = await withRecorderBrowser(
        options.browser ?? {},
        async (session) => {
          signal.throwIfAborted();
          if (options.prepare)
            await interruptible(
              options.prepare(session, attempt, signal),
              signal,
            );
          const viewport = session.page.viewportSize();
          if (!viewport)
            throw new Error("Live recording requires a fixed viewport");
          const dpr = await session.page.evaluate(
            () => window.devicePixelRatio,
          );
          const starting = startScreencast(session.page, {
            ...options.capture,
            directory,
            maxWidth: Math.round(viewport.width * dpr),
            maxHeight: Math.round(viewport.height * dpr),
            expectedSize: {
              width: Math.round(viewport.width * dpr),
              height: Math.round(viewport.height * dpr),
            },
          });
          try {
            capture = await interruptible(starting, signal);
          } catch (error) {
            await session.close().catch(() => {});
            await starting
              .then(
                (handle) => handle.stop(),
                () => {},
              )
              .catch(() => {});
            throw error;
          }
          const windows: MotionWindow[] = [];
          const now = () => performance.now() - capture!.startedAtMs;
          const onNewPage = () =>
            deadline.abort(
              new Error("Live capture requires one page; a new tab was opened"),
            );
          session.context.on("page", onNewPage);
          try {
            await interruptible(
              Promise.race([
                run({
                  ...session,
                  attempt,
                  signal,
                  now,
                  motion: async (work) => {
                    const startMs = now();
                    try {
                      return await work();
                    } finally {
                      windows.push({ startMs, endMs: now() });
                    }
                  },
                }),
                capture.failure,
              ]),
              signal,
            );
            const recorded = await capture.stop();
            const frames = alignFrames(recorded.frames, recorded.startedAtMs);
            const stall = checkStalls(
              frames.map((frame) => frame.sceneMs),
              windows,
              recorded.durationMs,
            );
            takes.push({ attempt, stall });
            return { recorded, stall, gpu: session.gpu };
          } finally {
            session.context.off("page", onNewPage);
            // Drain capture before closing its page, including when cancellation
            // wins the race, so intentional shutdown cannot reject orphaned work.
            await capture.stop().catch(() => {});
          }
        },
      );
      if (result.stall.status === "failed") continue;
      const video = await encodeCfrMp4(result.recorded, outputPath, {
        ...options.encoding,
        signal,
      });
      return {
        ...video,
        mode: "live",
        sourceDurationMs: result.recorded.durationMs,
        sourceFrameCount: result.recorded.frames.length,
        stall: result.stall,
        takes,
        gpu: result.gpu,
      };
    } finally {
      clearTimeout(timer);
      await capture?.stop().catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  }
  throw new LiveStallError(takes);
}
