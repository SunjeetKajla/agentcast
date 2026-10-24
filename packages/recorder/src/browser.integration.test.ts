import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, type Browser } from "playwright-core";
import { describe, expect, it } from "vitest";
import { withRecorderBrowser } from "./browser.ts";
import { detectGpuAdapters, launchGpuBrowser } from "./gpu.ts";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const browserAvailable = await access(
  executablePath ?? chromium.executablePath(),
).then(
  () => true,
  () => false,
);
const launchOptions = executablePath ? { executablePath } : undefined;

// Uses bundled Chromium when installed; an explicit path also allows local Chrome.
describe.skipIf(!browserAvailable)("recorder browser in Chromium", () => {
  it.each(["auto", "igpu", "cpu"] as const)(
    "renders with verified GPU preference %s",
    async (preference) => {
      await withRecorderBrowser(
        { launchOptions, gpu: preference },
        async ({ page, gpu }) => {
          console.info(
            `[recorder GPU] ${preference} -> ${gpu.backend}: ${gpu.renderer}; ${JSON.stringify(gpu.attempts)}`,
          );
          if (preference === "cpu") {
            expect(gpu.backend).toBe("cpu");
            expect(gpu.hardwareAccelerated).toBe(false);
          } else if (process.env.AGENTCAST_REQUIRE_GPU === "1") {
            const adapters = await detectGpuAdapters();
            const expected =
              preference === "auto"
                ? adapters.some((item) => item.backend === "dgpu")
                  ? "dgpu"
                  : "igpu"
                : "igpu";
            expect(gpu.backend).toBe(expected);
            expect(gpu.hardwareAccelerated).toBe(true);
          }
          await page.setContent(
            '<canvas id="scene" width="80" height="80"></canvas>',
          );
          expect(await page.screenshot()).toBeInstanceOf(Buffer);
        },
      );
    },
    60_000,
  );

  it.runIf(process.env.AGENTCAST_REQUIRE_GPU === "1").each([
    { failures: 1, expected: "igpu" },
    { failures: 2, expected: "cpu" },
  ] as const)(
    "falls back to $expected after $failures unusable hardware configurations",
    async ({ failures, expected }) => {
      let launches = 0;
      const { browser, gpu } = await launchGpuBrowser((options) => {
        launches += 1;
        // Deliberately break ANGLE in the hardware attempts, exercising real
        // browser/probe failures rather than replacing them with mocked results.
        return chromium.launch(
          launches <= failures
            ? {
                ...options,
                args: [
                  ...(options.args ?? []).filter(
                    (arg) => !arg.startsWith("--use-angle="),
                  ),
                  "--use-angle=recorder-test-invalid",
                ],
              }
            : options,
        );
      }, launchOptions);
      try {
        expect(gpu.backend).toBe(expected);
        expect(
          gpu.attempts.filter((attempt) => attempt.status === "failed"),
        ).toHaveLength(failures);
        expect(launches).toBe(failures + 1);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );

  it("applies stealth to the page and new tabs while preserving custom UA", async () => {
    await withRecorderBrowser(
      { launchOptions, userAgent: "AgentCastCustom/1.0", gpu: "cpu" },
      async ({ page, context }) => {
        for (const target of [page, await context.newPage()]) {
          await target.goto("data:text/html,<h1>Local stealth fixture</h1>");
          expect(await target.evaluate(() => navigator.webdriver)).toBeFalsy();
          expect(await target.evaluate(() => navigator.userAgent)).toBe(
            "AgentCastCustom/1.0",
          );
        }
      },
    );
  });

  it("keeps stealth configuration isolated between simultaneous sessions", async () => {
    await withRecorderBrowser(
      { launchOptions, gpu: "cpu" },
      async (stealth) => {
        await withRecorderBrowser(
          { launchOptions, gpu: "cpu", stealth: false },
          async (plain) => {
            expect(
              await stealth.page.evaluate(() => navigator.webdriver),
            ).toBeFalsy();
            expect(await plain.page.evaluate(() => navigator.webdriver)).toBe(
              true,
            );
          },
        );
      },
    );
  });

  it("delivers CDP screencast JPEG frames with stealth enabled", async () => {
    await withRecorderBrowser(
      { launchOptions, gpu: "cpu" },
      async ({ page, context }) => {
        const cdp = await context.newCDPSession(page);
        try {
          const frame = new Promise<string>((resolve, reject) => {
            cdp.once("Page.screencastFrame", (event) => {
              void cdp
                .send("Page.screencastFrameAck", { sessionId: event.sessionId })
                .then(() => resolve(event.data), reject);
            });
          });
          await cdp.send("Page.startScreencast", {
            format: "jpeg",
            quality: 85,
            maxWidth: 720,
            maxHeight: 450,
          });
          await page.setContent(
            '<div style="background:blue;height:100vh">Local recording fixture</div>',
          );
          const jpeg = Buffer.from(await frame, "base64");
          expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
        } finally {
          await cdp.send("Page.stopScreencast");
          await cdp.detach();
        }
      },
    );
  });

  it("restores session state before app scripts and keeps origins isolated", async () => {
    await withRecorderBrowser(
      {
        launchOptions,
        storageState: {
          cookies: [
            {
              name: "session",
              value: "test-cookie",
              domain: "app.agentcast.test",
              path: "/",
              expires: -1,
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [
            {
              origin: "http://app.agentcast.test",
              localStorage: [{ name: "token", value: "app-token" }],
            },
            {
              origin: "http://other.agentcast.test",
              localStorage: [{ name: "token", value: "other-token" }],
            },
          ],
        },
      },
      async ({ page, context }) => {
        await context.route("http://*.agentcast.test/**", async (route) => {
          await route.fulfill({
            contentType: "text/html",
            body: '<script>document.title = localStorage.getItem("token") ?? "empty"</script>',
          });
        });
        await page.goto("http://app.agentcast.test/");
        expect(await page.title()).toBe("app-token");
        expect(await context.cookies("http://app.agentcast.test/")).toEqual([
          expect.objectContaining({
            name: "session",
            value: "test-cookie",
            httpOnly: true,
          }),
        ]);
        await page.goto("http://other.agentcast.test/");
        expect(await page.title()).toBe("other-token");
        expect(await context.cookies("http://other.agentcast.test/")).toEqual(
          [],
        );
        const otherPage = await context.newPage();
        await otherPage.goto("http://unrelated.agentcast.test/");
        expect(await otherPage.title()).toBe("empty");
        await page.goto("http://app.agentcast.test/again");
        expect(await page.title()).toBe("app-token");
      },
    );
  });

  it.each([
    {
      formFactor: "desktop" as const,
      width: 1440,
      height: 900,
      dpr: 2,
      touch: false,
    },
    {
      formFactor: "mobile" as const,
      width: 390,
      height: 844,
      dpr: 3,
      touch: true,
    },
  ])(
    "applies the $formFactor viewport and input profile",
    async ({ formFactor, width, height, dpr, touch }) => {
      await withRecorderBrowser(
        { formFactor, launchOptions },
        async ({ page }) => {
          await page.setContent(
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
          );
          expect(page.viewportSize()).toEqual({ width, height });
          expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
          expect(await page.evaluate(() => navigator.maxTouchPoints > 0)).toBe(
            touch,
          );
          if (touch)
            expect(await page.evaluate(() => navigator.userAgent)).toContain(
              "Mobile",
            );
        },
      );
    },
  );

  it("closes the actual child browser when an action throws", async () => {
    let browser: Browser | undefined;
    await expect(
      withRecorderBrowser({ launchOptions }, async (session) => {
        browser = session.browser;
        throw new Error("failed take");
      }),
    ).rejects.toThrow("failed take");
    expect(browser?.isConnected()).toBe(false);
  });

  it.each(["exit", "SIGINT", "SIGTERM", "SIGHUP"])(
    "closes Chrome on worker %s",
    async (mode) => {
      const moduleUrl = new URL("./browser.ts", import.meta.url).href;
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `
        import { launchRecorderBrowser } from ${JSON.stringify(moduleUrl)};
        const session = await launchRecorderBrowser({ launchOptions: ${JSON.stringify(launchOptions ?? {})} });
        session.browser.on("disconnected", () => process.exit(0));
        const cdp = await session.browser.newBrowserCDPSession();
        const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
        process.on("message", (mode) => {
          if (mode === "exit") process.exit(0);
          else process.kill(process.pid, mode);
        });
        process.send({ pid: processInfo.find(p => p.type === "browser").id });
      `,
        ],
        { stdio: ["ignore", "ignore", "pipe", "ipc"] },
      );
      // Drain diagnostics so a noisy browser cannot block the child on stderr.
      child.stderr?.resume();
      const ready = once(child, "message", {
        signal: AbortSignal.timeout(10_000),
      });
      try {
        const [message] = await ready;
        const { pid } = message as { pid: number };
        const exited = once(child, "exit", {
          signal: AbortSignal.timeout(10_000),
        });
        child.send(mode);
        await exited;
        await expect
          .poll(
            async () => {
              try {
                process.kill(pid, 0);
                // An orphan killed during process.exit may briefly remain a zombie.
                if (process.platform === "linux") {
                  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
                  return !stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
                }
                return true;
              } catch (error) {
                if (
                  ["ESRCH", "ENOENT"].includes(
                    (error as NodeJS.ErrnoException).code ?? "",
                  )
                )
                  return false;
                throw error;
              }
            },
            { timeout: 3_000 },
          )
          .toBe(false);
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }
    },
    25_000,
  );
});
