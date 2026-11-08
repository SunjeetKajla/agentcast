import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { z } from "zod";
import { BrowserTrace } from "@agentcast/shared";
import { readArtifact } from "@agentcast/shared/node";
import { createBrowserAgent } from "./index.ts";
import { launchExplorationChrome } from "./chrome.ts";
import { BrowserActionFailure, performBrowserAction } from "./actions.ts";

const enabled = process.env.AGENTCAST_TEST_BROWSER === "1";
type Response = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};
const decode = (response: Response) =>
  JSON.parse(
    response.content[0]!.text!.match(
      /\n([\s\S]*)\n<\/untrusted_site_content>/,
    )![1]!,
  );

it.runIf(enabled)(
  "blocks focused destructive controls and implicit contact submissions while allowing search",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentcast-keyboard-"));
    const { context } = await launchExplorationChrome(join(dir, "profile"));
    try {
      const page = context.pages()[0]!;
      const run = () =>
        performBrowserAction(
          page,
          { action: "press", value: "Enter" },
          undefined,
          AbortSignal.timeout(10_000),
        );
      await page.setContent(
        '<h1>Ready</h1><button onclick="window.activated=true">Delete workspace</button>',
      );
      await page.getByRole("button").focus();
      const error = await run().catch((e) => e);
      expect(error).toBeInstanceOf(BrowserActionFailure);
      expect(error).toMatchObject({ performed: false, uncertain: false });
      expect(
        await page.evaluate(() => (window as any).activated),
      ).toBeUndefined();
      await page.setContent(
        '<form aria-label="Contact sales" onsubmit="event.preventDefault();window.sent=true"><label>Name<input></label><button>Continue</button></form>',
      );
      await page.getByRole("textbox").focus();
      await expect(run()).rejects.toBeInstanceOf(BrowserActionFailure);
      await expect(
        performBrowserAction(
          page,
          { action: "click" },
          {
            id: "o1-0",
            role: "button",
            text: "Continue",
            label: "",
            placeholder: "",
          },
          AbortSignal.timeout(10_000),
        ),
      ).rejects.toBeInstanceOf(BrowserActionFailure);
      expect(await page.evaluate(() => (window as any).sent)).toBeUndefined();
      await page.setContent(
        '<h1>Ready</h1><form role="search" onsubmit="event.preventDefault();document.querySelector(\'h1\').textContent=\'Search ready\'"><input type="search" aria-label="Search products"></form>',
      );
      await page.getByRole("searchbox").fill("watch");
      const result = await run();
      expect(result.expect).toContainEqual({
        type: "element",
        role: "heading",
        name: "Search ready",
      });
    } finally {
      await context.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);

for (const scenario of [
  "observation-failure",
  "navigation-timeout",
  "navigate-observation-failure",
] as const) {
  it.runIf(enabled)(
    `retains execution evidence after ${scenario}`,
    async () => {
      let dispatched = 0;
      const server = createServer((req, res) => {
        if (req.url === "/slow") {
          dispatched++;
          return;
        }
        res.setHeader("content-type", "text/html");
        if (req.url === "/bad-observation")
          return res.end(
            "<h1>Destination</h1><script>document.createTreeWalker=()=>{throw Error('fixture observation failure')}</script>",
          );
        res.end(
          scenario === "observation-failure"
            ? "<h1>Ready</h1><button onclick=\"document.querySelector('h1').textContent='Done';document.createTreeWalker=()=>{throw Error('fixture observation failure')}\">Preview</button>"
            : `<h1>Ready</h1><a href="${scenario === "navigation-timeout" ? "/slow" : "/bad-observation"}">Open product</a>`,
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const dir = await mkdtemp(join(tmpdir(), "agentcast-evidence-"));
      const screenshots: boolean[] = [];
      try {
        await createBrowserAgent({
          dir,
          authorizedUrl: url,
          siteOf: (h) => h,
          llm: {
            agent: async (task) => {
              const env = task.mcp!.env!;
              const call = async (
                name: string,
                args: unknown = {},
              ): Promise<Response> =>
                (
                  await fetch(env.AGENTCAST_BROWSER_ENDPOINT!, {
                    method: "POST",
                    headers: {
                      authorization: `Bearer ${env.AGENTCAST_BROWSER_TOKEN}`,
                    },
                    body: JSON.stringify({
                      method: "tools/call",
                      params: { name, arguments: args },
                    }),
                  })
                ).json();
              const page = decode(await call("observe"));
              const target = page.targets.find(
                (t: any) =>
                  t.text ===
                  (scenario === "observation-failure"
                    ? "Preview"
                    : "Open product"),
              );
              const action =
                scenario === "navigate-observation-failure"
                  ? await call("navigate", { url: target.href })
                  : await call("act", {
                      action: "click",
                      target: target.id,
                    });
              expect(action.isError).toBe(true);
              if (scenario === "observation-failure")
                expect(action.content[0]?.text).toContain(
                  "Execution evidence was saved",
                );
              else {
                expect(action.content[0]?.text).toContain(
                  scenario === "navigation-timeout"
                    ? "may have executed"
                    : "Navigation evidence was saved",
                );
                expect(
                  (await call("submit", { completed: true, steps: [] }))
                    .isError,
                ).toBe(true);
              }
              expect(
                (await call("submit", { completed: false, steps: [] })).isError,
              ).not.toBe(true);
              return { sessionId: "fixture-evidence", text: "Done" };
            },
          },
        }).run({
          id: "evidence",
          request: { url, goal: "Verify execution evidence" },
          maxSteps: 2,
          schema: z.object({
            completed: z.boolean(),
            steps: z.array(z.unknown()),
          }),
          signal: AbortSignal.timeout(35_000),
          onStep: (step) => {
            screenshots.push(Boolean(step.screenshot));
          },
        });
        const trace = await readArtifact(
          join(dir, "explore/traces/evidence.json"),
          BrowserTrace,
        );
        expect(trace.steps).toHaveLength(2);
        expect(trace.steps[1]).toMatchObject({
          action:
            scenario === "navigate-observation-failure" ? "navigate" : "click",
          outcome:
            scenario === "observation-failure" ? "verified" : "unverified",
          execution:
            scenario === "navigation-timeout" ? "uncertain" : "confirmed",
        });
        if (scenario === "observation-failure")
          expect(screenshots).toEqual([true, false]);
        else if (scenario === "navigation-timeout") expect(dispatched).toBe(1);
        else expect(trace.steps[1]?.result_url_path).toBe("/bad-observation");
      } finally {
        server.closeAllConnections();
        server.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    45_000,
  );
}
