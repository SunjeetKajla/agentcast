import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { launchExplorationChrome } from "./chrome.ts";

it.runIf(process.env.AGENTCAST_TEST_EXPLORATION_GPU === "1")(
  "executes shared page callbacks through the production tsx runtime",
  async () => {
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./test/tsx-actions.mts", import.meta.url)),
      ],
      { timeout: 30_000 },
    );
    expect(result.stdout).toContain("tsx action verified");
  },
  35_000,
);

it
  .runIf(process.env.AGENTCAST_TEST_EXPLORATION_GPU === "1")
  .each(["auto", "cpu"] as const)(
  "verifies persistent Chrome (%s), captures video and closes on cancellation",
  async (preference) => {
    const root = await mkdtemp(join(tmpdir(), "agentcast-exploration-gpu-"));
    const controller = new AbortController();
    let context:
      | Awaited<ReturnType<typeof launchExplorationChrome>>["context"]
      | undefined;
    try {
      const launched = await launchExplorationChrome(join(root, "profile"), {
        gpu: preference,
        signal: controller.signal,
        launchOptions: {
          ...(process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH }
            : {}),
          args: [
            "--remote-debugging-port=0",
            "--remote-debugging-address=127.0.0.1",
          ],
        },
        contextOptions: {
          viewport: { width: 1280, height: 720 },
          recordVideo: {
            dir: join(root, "video"),
            size: { width: 1280, height: 720 },
          },
        },
      });
      context = launched.context;
      console.info("Exploration GPU:", JSON.stringify(launched.gpu));
      expect(launched.gpu.attempts.at(-1)?.status).toBe("selected");
      if (preference === "cpu") {
        expect(launched.gpu.backend).toBe("cpu");
        expect(launched.gpu.hardwareAccelerated).toBe(false);
      } else if (process.env.AGENTCAST_REQUIRE_GPU === "1") {
        expect(launched.gpu.hardwareAccelerated).toBe(true);
        expect(launched.gpu.featureStatus.gpu_compositing).toBe("enabled");
      }
      const page = context.pages()[0] ?? (await context.newPage());
      await page.setContent(
        "<h1>Exploration GPU fixture</h1><button onclick=\"this.textContent='Ready'\">Preview</button>",
      );
      await page.getByRole("button", { name: "Preview" }).click();
      await expect
        .poll(() => page.getByRole("button").textContent())
        .toBe("Ready");
      expect(await page.screenshot()).toBeInstanceOf(Buffer);
      const closed = new Promise<void>((resolve) =>
        context!.once("close", () => resolve()),
      );
      const browser = context.browser()!;
      const disconnected = new Promise<void>((resolve) =>
        browser.once("disconnected", () => resolve()),
      );
      controller.abort();
      await closed;
      await disconnected;
      expect(browser.isConnected()).toBe(false);
      const videos = await readdir(join(root, "video"));
      expect(videos.some((file) => file.endsWith(".webm"))).toBe(true);
      for (const file of videos)
        expect((await stat(join(root, "video", file))).size).toBeGreaterThan(0);
    } finally {
      await context?.close().catch(() => {});
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  },
  90_000,
);
