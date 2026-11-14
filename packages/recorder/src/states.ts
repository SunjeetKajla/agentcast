import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withRecorderBrowser } from "./browser.ts";
import { encodeCfrMp4 } from "./encode.ts";
import type { LiveControls, LiveOptions, LiveRecording } from "./live.ts";
import type { CapturedFrame } from "./timing.ts";

/** Real actions, real settled screenshots, deliberate cuts. Never represented as continuous motion. */
export async function recordStateSequence(
  options: LiveOptions,
  run: (c: LiveControls) => Promise<void>,
): Promise<LiveRecording> {
  await mkdir(dirname(options.outputPath), { recursive: true });
  const directory = await mkdtemp(
    join(dirname(options.outputPath), ".states-"),
  );
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("State capture timed out")),
    options.timeoutMs ?? 120_000,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  try {
    return await withRecorderBrowser(
      { ...options.browser, signal },
      async (session) => {
        await options.prepare?.(session, 1, signal);
        signal.throwIfAborted();
        const frames: CapturedFrame[] = [];
        const start = performance.now();
        const now = () => performance.now() - start;
        const captureState = async () => {
          signal.throwIfAborted();
          const data = await session.page.screenshot({
            type: "jpeg",
            quality: 95,
            animations: "disabled",
            timeout: 10000,
          });
          const t = performance.now(),
            file = `frame-${String(frames.length).padStart(8, "0")}.jpg`;
          await writeFile(join(directory, file), data);
          frames.push({ file, receivedAtMs: t, timestampMs: t });
        };
        await captureState();
        await run({
          ...session,
          attempt: 1,
          signal,
          now,
          motion: (work) => work(),
          markMotion: () => {},
          captureState,
        });
        await captureState();
        const durationMs = now() + 1000;
        const encoded = await encodeCfrMp4(
          { directory, frames, startedAtMs: start, durationMs },
          options.outputPath,
          { ...options.encoding, signal },
        );
        const stall = {
          status: "not-applicable" as const,
          maxGapMs: 0,
          p95GapMs: 0,
          motionDurationMs: 0,
          effectiveFps: 0,
          gaps: [],
        };
        return {
          ...encoded,
          mode: "states" as const,
          sourceDurationMs: durationMs,
          sourceFrameCount: frames.length,
          stall,
          takes: [{ attempt: 1, stall }],
          gpu: session.gpu,
        };
      },
    );
  } finally {
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
  }
}
