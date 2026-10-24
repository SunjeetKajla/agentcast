import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { recordLive, LiveStallError, type LiveOptions } from "./live.ts";
import { runMediaCommand } from "./encode.ts";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const ready = await Promise.all([
  access(executablePath ?? chromium.executablePath()).then(
    () => true,
    () => false,
  ),
  ...["ffmpeg", "ffprobe"].map((tool) =>
    runMediaCommand(tool, ["-version"]).then(
      () => true,
      () => false,
    ),
  ),
]);
const directories: string[] = [];

async function options(): Promise<LiveOptions> {
  const directory = await mkdtemp(
    join(tmpdir(), "agentcast-live-integration-"),
  );
  directories.push(directory);
  return {
    outputPath: join(directory, "recording.mp4"),
    browser: {
      viewport: { width: 320, height: 180 },
      deviceScaleFactor: 1,
      launchOptions: executablePath ? { executablePath } : undefined,
    },
    prepare: async ({ page }) => {
      await page.setContent(
        '<style>body{margin:0;background:#234}</style><div id="box" style="width:30px;height:30px;background:red"></div>',
      );
    },
  };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.skipIf(ready.includes(false))("Live CDP to CFR MP4", () => {
  it("records motion with source cadence checks and a validated CFR file", async () => {
    const config = await options();
    const result = await recordLive(config, async ({ page, motion }) => {
      await motion(() =>
        page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              const started = performance.now();
              const step = () => {
                const elapsed = performance.now() - started;
                document.getElementById("box")!.style.transform =
                  `translateX(${elapsed / 10}px)`;
                if (elapsed < 1000) requestAnimationFrame(step);
                else resolve();
              };
              requestAnimationFrame(step);
            }),
        ),
      );
    });
    expect(result.stall.status).toBe("passed");
    expect(result.stall.effectiveFps).toBeGreaterThanOrEqual(30);
    expect(result).toMatchObject({
      mode: "live",
      fps: 30,
      width: 320,
      height: 180,
    });
    expect(
      result.duration * 1000 - result.sourceDurationMs,
    ).toBeLessThanOrEqual(1000 / 30 + 0.1);
    expect(await readdir(directories[0]!)).toEqual(["recording.mp4"]);
  }, 60_000);

  it("preserves a static hold longer than the stall threshold", async () => {
    const result = await recordLive(await options(), async () => {
      await delay(500);
    });
    expect(result.stall.status).toBe("not-applicable");
    expect(result.duration).toBeGreaterThanOrEqual(0.5);
    expect(result.takes).toHaveLength(1);
    expect(result.sourceFrameCount).toBeLessThan(result.frameCount);
  }, 30_000);

  it.runIf(process.env.AGENTCAST_REQUIRE_GPU === "1")(
    "records the default desktop at 2880×1800 with at least 30 source fps during motion",
    async () => {
      const config = await options();
      config.browser!.viewport = { width: 1440, height: 900 };
      config.browser!.deviceScaleFactor = 2;
      const result = await recordLive(config, async ({ page, motion }) => {
        await motion(() =>
          page.evaluate(() =>
            document
              .getElementById("box")!
              .animate(
                [
                  { transform: "translateX(0px)" },
                  { transform: "translateX(300px)" },
                ],
                { duration: 1000, fill: "forwards" },
              )
              .finished.then(() => {}),
          ),
        );
      });
      expect(result).toMatchObject({ width: 2880, height: 1800, fps: 30 });
      expect(result.stall.status).toBe("passed");
      expect(result.stall.effectiveFps).toBeGreaterThanOrEqual(30);
      if (process.env.AGENTCAST_REQUIRE_NVENC === "1")
        expect(result.encoder).toBe("h264_nvenc");
    },
    90_000,
  );

  it("captures physical pixels at DPR 2 without silently shrinking the source", async () => {
    const config = await options();
    config.browser!.deviceScaleFactor = 2;
    const result = await recordLive(config, async ({ page }) => {
      expect(
        await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        })),
      ).toEqual({ width: 320, height: 180, dpr: 2 });
      await page.evaluate(() => {
        const box = document.getElementById("box")!;
        Object.assign(box.style, {
          position: "absolute",
          left: "100px",
          top: "60px",
        });
        box.addEventListener("click", () => {
          document.body.dataset.clicked = "yes";
        });
      });
      await page.locator("#box").click({ timeout: 2_000 });
      expect(await page.evaluate(() => document.body.dataset.clicked)).toBe(
        "yes",
      );
      await delay(200);
    });
    expect(result).toMatchObject({ width: 640, height: 360, fps: 30 });
  }, 30_000);

  it("retakes missing expected motion and publishes no stalled footage", async () => {
    const config = await options();
    let actions = 0;
    await expect(
      recordLive({ ...config, maxTakes: 2 }, async ({ motion }) => {
        actions++;
        await motion(async () => {
          await delay(500);
        });
      }),
    ).rejects.toBeInstanceOf(LiveStallError);
    expect(actions).toBe(2);
    expect(await readdir(directories[0]!)).toEqual([]);
  }, 60_000);

  it("cancels the active capture without leaving frames or partial MP4s", async () => {
    const config = await options();
    const controller = new AbortController();
    const failure = new Error("cancelled by test");
    await expect(
      recordLive({ ...config, signal: controller.signal }, async () => {
        controller.abort(failure);
        await new Promise(() => {});
      }),
    ).rejects.toBe(failure);
    expect(await readdir(directories[0]!)).toEqual([]);
  }, 30_000);
});
