import { createServer } from "node:http";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createBrowserAgent } from "./index.ts";
import type { Llm } from "@agentcast/llm";

const enabled = process.env.AGENTCAST_TEST_BROWSER === "1";
describe.runIf(enabled)("Browser Harness with dedicated Chrome", () => {
  it("waits for a delayed document body, delivers images, enforces targets and captures real actions", async () => {
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.write(
        "<!doctype html><html><head><title>Delayed body fixture</title>",
      );
      setTimeout(
        () =>
          res.end(
            '</head><body><h1>AgentCast test product</h1><a href="/next">Next page</a><button onclick="document.querySelector(\'h1\').textContent=\'Preview ready\'">Show preview</button><button>Delete workspace</button><input type="password" aria-label="Password" style="display:none"></body></html>',
          ),
        500,
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No test server");
    const url = `http://127.0.0.1:${address.port}`;
    const dir = await mkdtemp(join(tmpdir(), "agentcast-browser-test-"));
    const reports: unknown[] = [];
    const llm: Pick<Llm, "agent"> = {
      agent: async (task) => {
        const env = task.mcp!.env!;
        const call = async (name: string, args: unknown = {}) => {
          const r = await fetch(env.AGENTCAST_BROWSER_ENDPOINT!, {
            method: "POST",
            headers: { authorization: `Bearer ${env.AGENTCAST_BROWSER_TOKEN}` },
            body: JSON.stringify({
              method: "tools/call",
              params: { name, arguments: args },
            }),
          });
          return (await r.json()) as any;
        };
        let observed = await call("observe");
        expect(observed.content.some((c: any) => c.type === "image")).toBe(
          true,
        );
        let page = JSON.parse(
          observed.content[0].text.match(
            /\n([\s\S]*)\n<\/untrusted_site_content>/,
          )[1],
        );
        const destructive = page.targets.find(
          (t: any) => t.text === "Delete workspace",
        );
        expect(
          (await call("act", { action: "click", target: destructive.id }))
            .isError,
        ).toBe(true);
        const preview = page.targets.find(
          (t: any) => t.text === "Show preview",
        );
        observed = await call("act", { action: "click", target: preview.id });
        expect(observed.isError).not.toBe(true);
        expect(observed.content[0].text).toContain("Preview ready");
        expect(
          (await call("act", { action: "click", target: preview.id })).isError,
        ).toBe(true);
        const current = JSON.parse(
          observed.content[0].text.match(
            /\n([\s\S]*)\n<\/untrusted_site_content>/,
          )[1],
        );
        const next = current.targets.find(
          (target: any) => target.text === "Next page",
        );
        expect((await call("navigate", { url: next.href })).isError).not.toBe(
          true,
        );
        expect(
          (await call("act", { action: "click", target: preview.id })).isError,
        ).toBe(true);
        reports.push(
          await call("submit", {
            completed: true,
            steps: [{ action: "invented" }],
          }),
        );
        return { sessionId: "test-browser", text: "Done" };
      },
    };
    try {
      const result = await createBrowserAgent({
        llm,
        dir,
        authorizedUrl: url,
        siteOf: (h) => h,
        recordVideo: true,
      }).run({
        id: "test",
        request: { url, goal: "Show a preview" },
        schema: z.object({
          completed: z.boolean(),
          steps: z.array(z.object({ action: z.string() })),
        }),
        maxSteps: 5,
        signal: AbortSignal.timeout(30000),
      });
      expect(result.result.steps).toEqual([
        { action: "navigate" },
        { action: "click" },
        { action: "navigate" },
      ]);
      expect(reports[0]).not.toHaveProperty("isError", true);
      expect(
        JSON.parse(
          await readFile(join(dir, "explore/traces/test.json"), "utf8"),
        ).steps,
      ).toHaveLength(3);
      const videos = await readdir(join(dir, "explore/videos/test"));
      expect(videos.some((file) => file.endsWith(".webm"))).toBe(true);
      for (const file of videos)
        expect(
          (await stat(join(dir, "explore/videos/test", file))).size,
        ).toBeGreaterThan(0);
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 40000);
});

it.runIf(!!process.env.AGENTCAST_TEST_LLM)(
  "uses the logged-in CLI with task-only MCP tools",
  async () => {
    const { createLlm } = await import("@agentcast/llm");
    const { loadDotEnv } = await import("../../../apps/worker/src/env.ts");
    await loadDotEnv();
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(
        "<h1>Local product</h1><button onclick=\"this.textContent='Preview ready'\">Show preview</button>",
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    const dir = await mkdtemp(join(tmpdir(), "agentcast-cli-browser-"));
    try {
      const backend = process.env.AGENTCAST_TEST_LLM as "codex" | "claude-code";
      const result = await createBrowserAgent({
        llm: createLlm({
          backend,
          env: { ...process.env, AGENTCAST_LLM_SMART: backend },
        }),
        dir,
        authorizedUrl: url,
        siteOf: (h) => h,
        onEvent: (event) => console.log(event.kind, event.text),
      }).run({
        id: "cli",
        request: {
          url,
          goal: 'Observe the page. Click Show preview, verify Preview ready appears, then submit {"done":true}.',
          output_schema: {
            type: "object",
            properties: { done: { type: "boolean" } },
            required: ["done"],
            additionalProperties: false,
          },
        },
        schema: z.object({ done: z.boolean() }),
        maxSteps: 5,
        signal: AbortSignal.timeout(90000),
      });
      expect(result.result.done).toBe(true);
      const trace = JSON.parse(
        await readFile(join(dir, "explore/traces/cli.json"), "utf8"),
      );
      expect(
        trace.steps.some(
          (s: any) => s.action === "click" && s.target_text === "Show preview",
        ),
      ).toBe(true);
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  100000,
);

it.runIf(enabled)(
  "restores private sessions without publishing live frames and cancels promptly",
  async () => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<h1>Workspace</h1><button>Preview</button>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const dir = await mkdtemp(join(tmpdir(), "agentcast-private-browser-"));
    const abort = new AbortController();
    const progress: any[] = [];
    const llm: Pick<Llm, "agent"> = {
      agent: async (task) => {
        abort.abort();
        task.signal!.throwIfAborted();
        throw Error("unreachable");
      },
    };
    const started = Date.now();
    try {
      await expect(
        createBrowserAgent({
          llm,
          dir,
          authorizedUrl: url,
          siteOf: (h) => h,
          recordVideo: true,
        }).run({
          id: "private",
          request: { url, goal: "Observe" },
          schema: z.object({ done: z.boolean() }),
          maxSteps: 2,
          signal: abort.signal,
          storageState: {
            cookies: [
              {
                name: "sid",
                value: "private-session-value",
                domain: "127.0.0.1",
                path: "/",
                expires: -1,
                httpOnly: true,
                secure: false,
                sameSite: "Lax",
              },
            ],
            origins: [
              {
                origin: url,
                localStorage: [{ name: "token", value: "private-token" }],
              },
            ],
          },
          onStep: (s) => {
            progress.push(s);
          },
        }),
      ).rejects.toBeDefined();
      expect(Date.now() - started).toBeLessThan(15000);
      expect(progress).toHaveLength(1);
      expect(progress[0]).not.toHaveProperty("screenshot");
      const trace = await readFile(
        join(dir, "explore/traces/private.json"),
        "utf8",
      );
      expect(trace).not.toContain("private-session-value");
      expect(trace).not.toContain("private-token");
      await expect(readdir(join(dir, "explore/videos"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  25000,
);
