import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { Job, STAGES, jobPaths } from "@agentcast/shared";
import { FIXTURE_JOB_DIR } from "@agentcast/shared/node";

it.skipIf(process.env.AGENTCAST_WEB_TESTS !== "1")(
  "shows the film evidence and preview findings in the existing review UI",
  async () => {
    const reserve = createServer();
    await new Promise<void>((resolve) =>
      reserve.listen(0, "127.0.0.1", resolve),
    );
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const root = process.cwd();
    const web = join(root, "apps/web");
    const require = createRequire(join(web, "package.json"));
    const server = spawn(
      process.execPath,
      [require.resolve("next/dist/bin/next"), "start", "-p", String(port)],
      { cwd: web, stdio: "ignore" },
    );
    const origin = `http://127.0.0.1:${port}`;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      for (let i = 0; ; i++) {
        try {
          const res = await fetch(origin, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) break;
        } catch {
          /* Server is starting. */
        }
        if (i > 100) throw new Error("Web preview did not start");
        await delay(100);
      }
      const at = new Date().toISOString();
      const job = Job.parse({
        schemaVersion: 3,
        id: "job_evidencetest",
        createdAt: at,
        updatedAt: at,
        status: "waiting",
        config: { url: "https://fixture.example/" },
        stages: Object.fromEntries(
          STAGES.map((s) => [s.name, { status: "pending", attempts: 0 }]),
        ),
      });
      job.id = "job_evidencetest";
      job.status = "waiting";
      for (const stage of STAGES) job.stages[stage.name].status = "pending";
      for (const stage of STAGES.slice(
        0,
        STAGES.findIndex((s) => s.name === "gate-script"),
      ))
        job.stages[stage.name].status = "done";
      job.stages["gate-script"].status = "waiting";
      const artifacts: Record<string, unknown> = {};
      for (const file of [
        jobPaths.flows,
        jobPaths.storyboard,
        jobPaths.script("en"),
        jobPaths.script("hi"),
      ])
        artifacts[file] = JSON.parse(
          await readFile(join(FIXTURE_JOB_DIR, file), "utf8"),
        );
      artifacts[jobPaths.filmPlan] = {
        schemaVersion: 1,
        premise: "Show the product through its strongest verified moments.",
        approach: "showcase",
        moments: [],
        limitations: [],
      };
      artifacts[jobPaths.evidence] = {
        schemaVersion: 1,
        inputHash: "test",
        approach: "showcase",
        moments: [],
        outputs: [],
        limitations: ["Only the public product presentation was recorded."],
      };
      artifacts[jobPaths.quality] = {
        schemaVersion: 1,
        inputHash: "test",
        passed: true,
        issues: [
          {
            code: "capture.states",
            severity: "warning",
            message: "Some moments use deliberate cuts between settled states.",
            repair: "capture",
          },
        ],
        checks: ["source bounds"],
        reviewFrames: [],
      };
      browser = await chromium.launch({
        executablePath:
          process.env.AGENTCAST_TEST_CHROMIUM ?? "/usr/bin/google-chrome",
        headless: true,
        args: ["--no-sandbox"],
      });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.route("**/api/jobs/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/events")) {
          const data = Object.keys(artifacts)
            .map(
              (file, i) =>
                `data: ${JSON.stringify({ seq: i + 1, at: job.updatedAt, jobId: job.id, type: "artifact", stage: "script", path: file })}\n\n`,
            )
            .join("");
          return route.fulfill({
            contentType: "text/event-stream",
            body: data,
          });
        }
        if (path.includes("/files/")) {
          const file = decodeURIComponent(path.split("/files/")[1]!);
          if (file === jobPaths.preview)
            return route.fulfill({
              contentType: "video/mp4",
              body: await readFile(
                join(FIXTURE_JOB_DIR, jobPaths.recording("desktop")),
              ),
            });
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(artifacts[file] ?? {}),
          });
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(job),
        });
      });
      await page.goto(`${origin}/jobs/${job.id}`);
      await page
        .getByText("Only the public product presentation was recorded.")
        .waitFor();
      expect(
        await page.getByText("Product showcase", { exact: true }).count(),
      ).toBe(1);
      await page.screenshot({
        path: "/tmp/agentcast-evidence-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "/tmp/agentcast-evidence-mobile.png",
        fullPage: true,
      });
      job.stages["gate-script"].status = "done";
      job.stages.voice.status = "done";
      job.stages.direct.status = "done";
      job.stages.preview.status = "done";
      job.stages["gate-preview"].status = "waiting";
      await page.reload();
      await page.getByLabel("Preview checks").waitFor();
      expect(await page.getByText("Preview checks passed.").count()).toBe(1);
      expect(
        await page
          .getByRole("button", { name: "Approve and render" })
          .isEnabled(),
      ).toBe(true);
      await page.screenshot({
        path: "/tmp/agentcast-quality-mobile.png",
        fullPage: true,
      });
      (artifacts[jobPaths.quality] as { passed: boolean }).passed = false;
      await page.reload();
      await page.getByText("Preview checks need attention.").waitFor();
      expect(
        await page
          .getByRole("button", { name: "Approve and render" })
          .isDisabled(),
      ).toBe(true);
    } finally {
      await browser?.close();
      server.kill("SIGTERM");
    }
  },
  45000,
);
