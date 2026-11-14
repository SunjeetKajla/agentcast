import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withRecorderBrowser, type RecorderBrowserOptions } from "./browser.ts";
import { startScreencast } from "./screencast.ts";
import { alignFrames, checkStalls } from "./timing.ts";
import { installRecordingHygiene } from "./flow/hygiene.ts";

/** A short representative paint/capture probe; final takes still have to pass their own checks. */
export async function chooseCapture(
  url: string,
  browser: RecorderBrowserOptions,
  signal?: AbortSignal,
): Promise<{ dpr: number; strategy: "live" | "states"; reason: string }> {
  const directory = await mkdtemp(join(tmpdir(), "agentcast-paint-probe-"));
  try {
    for (const dpr of [2, 4 / 3]) {
      const passed = await withRecorderBrowser(
        { ...browser, deviceScaleFactor: dpr, signal },
        async (session) => {
          const hygiene = await installRecordingHygiene(session.page, {
            signal,
          });
          await session.page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          await hygiene.ready();
          const scrollable = await session.page.evaluate(
            () => document.documentElement.scrollHeight > innerHeight + 100,
          );
          if (!scrollable) return true; // No representative page scroll: final actions retain their own checks.
          const dir = join(directory, String(dpr));
          const { mkdir } = await import("node:fs/promises");
          await mkdir(dir);
          const size = session.page.viewportSize()!;
          const cast = await startScreencast(session.page, {
            directory: dir,
            maxWidth: Math.round(size.width * dpr),
            maxHeight: Math.round(size.height * dpr),
          });
          let capture;
          const begin = performance.now();
          try {
            await Promise.race([
              cast.failure,
              (async () => {
                for (let i = 0; i < 24; i++) {
                  signal?.throwIfAborted();
                  await session.page.mouse.wheel(0, 20);
                  await new Promise((resolve) =>
                    setTimeout(resolve, 1000 / 60),
                  );
                }
              })(),
            ]);
          } finally {
            capture = await cast.stop();
          }
          const startMs = begin - cast.startedAtMs;
          const frames = alignFrames(capture.frames, capture.startedAtMs);
          return (
            checkStalls(
              frames.map((f) => f.sceneMs),
              [{ startMs, endMs: capture.durationMs }],
              capture.durationMs,
            ).status !== "failed"
          );
        },
      );
      if (passed)
        return {
          dpr,
          strategy: "live",
          reason: `Representative motion passed at ${Math.round(1440 * dpr)} px; each take is checked independently.`,
        };
    }
    return {
      dpr: 4 / 3,
      strategy: "states",
      reason:
        "Representative live motion failed at both resolutions; capture verified settled states instead.",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
