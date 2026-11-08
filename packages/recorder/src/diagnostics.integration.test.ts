import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordLive } from "./live.ts";
import { recordFlow, FlowRecordingError } from "./flow/compile.ts";

// Opt-in system Chrome test: localhost only, no model/provider calls.
const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const available = !!executablePath && await access(executablePath).then(() => true, () => false);
let server: Server | undefined, directory: string | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    server = undefined;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
const browser = {
  gpu: "cpu" as const, viewport: { width: 480, height: 320 }, deviceScaleFactor: 1,
  launchOptions: { executablePath },
};

describe.skipIf(!available)("recorder diagnostics in local Chrome", () => {
  it("records slow document loading once with bounded lifecycle evidence and a validated MP4", async () => {
    directory = await mkdtemp(join(tmpdir(), "agentcast-navigation-diagnostic-"));
    server = createServer((request, response) => {
      void (async () => {
        if (request.url === "/slow") await delay(700);
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<body style="background:#234;color:white">Local test page</body>');
      })();
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => { server!.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    const url = `http://127.0.0.1:${address.port}`;
    const result = await recordLive({
      outputPath: join(directory, "take.mp4"), timeoutMs: 15000, browser, encoding: { encoder: "libx264" },
      prepare: async ({ page }) => { await page.goto(url); },
    }, async ({ page, markStep }) => {
      markStep?.("open-model");
      await page.goto(`${url}/slow`, { waitUntil: "domcontentloaded" });
      await delay(150);
    });
    expect(result.takes).toHaveLength(1);
    expect(result.stall.status).toBe("not-applicable");
    const evidence = result.takes[0]?.navigation ?? [];
    expect(evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "navigation-wait", stepId: "open-model", endEvidence: "main-frame-commit" })]));
    expect(evidence.find((n) => n.kind === "navigation-wait")!.endMs - evidence.find((n) => n.kind === "navigation-wait")!.startMs).toBeGreaterThan(600);
    expect(evidence.every((n) => n.startMs >= 0 && n.endMs <= result.sourceDurationMs)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(url);
    expect(result.width).toBe(480);
    expect(await readdir(directory)).toEqual(["take.mp4"]);
  }, 30000);

  it("does not open three fresh browsers for an exhausted deterministic outcome failure", async () => {
    directory = await mkdtemp(join(tmpdir(), "agentcast-outcome-diagnostic-"));
    const prepare = vi.fn(async ({ page }: Parameters<NonNullable<Parameters<typeof recordFlow>[1]["prepare"]>>[0]) => {
      await page.setContent('<button onclick="document.querySelector(\'h1\').textContent=\'Upgrade required\'">Configure</button><h1></h1>');
    });
    const error = await recordFlow({
      id: "configure", title: "Configure", whyItMatters: "Inspect a configuration", startUrl: "https://fixture.test", requiresAuth: false, rank: 1, selected: true, source: "agent",
      steps: [{ id: "choose", action: "click", target: { role: "button", text: "Configure" }, expect: [{ type: "element", role: "heading", name: "Your selected model" }] }],
    }, {
      outputPath: join(directory, "take.mp4"), browser, prepare, outcomeTimeoutMs: 200, maxTakes: 3,
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(FlowRecordingError);
    expect((error as FlowRecordingError).takes).toMatchObject([{ attempt: 1, kind: "outcome", retryable: false, stepId: "choose" }]);
    expect(prepare).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toEqual([]);
  }, 30000);
});
