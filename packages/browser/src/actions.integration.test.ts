import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { z } from "zod";
import { BrowserTrace, BrowserRuntime } from "@agentcast/shared";
import { readArtifact } from "@agentcast/shared/node";
import type { Llm } from "@agentcast/llm";
import { createBrowserAgent } from "./index.ts";

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
const enabled = process.env.AGENTCAST_TEST_BROWSER === "1";

it.runIf(enabled)(
  "uses replayable accessible names, awaits delayed results and verifies a short sequence",
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<h1>Products</h1>
      <section><h2>Watch</h2><span id="watch-name">Details</span><button aria-labelledby="watch-name" onclick="setTimeout(()=>document.querySelector('h1').textContent='Watch ready',650)">Icon</button></section>
      <section><h2>Mac</h2><span id="mac-name">Details</span><button aria-labelledby="mac-name" onclick="document.querySelector('h1').textContent='Wrong product'">Icon</button></section>
      <span id="model-name">Watch model</span><select aria-labelledby="model-name"><option value="series-12">Series 12</option><option value="series-8">Series 8</option></select>
      <span id="search-name">Search products</span><input type="search" aria-labelledby="search-name" onkeydown="if(event.key==='Enter')setTimeout(()=>{history.pushState({},'', '/results');document.querySelector('h1').textContent='Results for '+this.value},500)">`);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const dir = await mkdtemp(join(tmpdir(), "agentcast-action-test-"));
    const frames: boolean[] = [];
    const llm: Pick<Llm, "agent"> = {
      agent: async (task) => {
        const env = task.mcp!.env!;
        const call = async (
          name: string,
          args: unknown = {},
        ): Promise<Response> => {
          const response = await fetch(env.AGENTCAST_BROWSER_ENDPOINT!, {
            method: "POST",
            headers: { authorization: `Bearer ${env.AGENTCAST_BROWSER_TOKEN}` },
            body: JSON.stringify({
              method: "tools/call",
              params: { name, arguments: args },
            }),
          });
          return response.json() as Promise<Response>;
        };
        let page = decode(await call("observe"));
        const watch = page.targets.find(
          (t: any) => t.text === "Details" && t.near === "Watch",
        );
        expect(watch).toBeDefined();
        const began = performance.now();
        const clicked = await call("act", {
          action: "click",
          target: watch.id,
          waitFor: [{ type: "text", text: "Watch ready", match: "exact" }],
        });
        if (clicked.isError) throw new Error(clicked.content[0]?.text);
        expect(clicked.isError).not.toBe(true);
        expect(performance.now() - began).toBeGreaterThanOrEqual(600);
        page = decode(clicked);
        expect(page.text).toContain("Watch ready");
        expect(page.text).not.toContain("Wrong product");
        const select = page.targets.find((t: any) => t.role === "combobox");
        expect(select.text).toBe("Watch model");
        const selected = await call("act", {
          action: "select",
          target: select.id,
          value: "Series 8",
        });
        expect(selected.isError).not.toBe(true);
        page = decode(selected);
        const search = page.targets.find((t: any) => t.role === "searchbox");
        const result = await call("act_sequence", {
          actions: [
            { action: "type", target: search.id, value: "watch" },
            {
              action: "press",
              target: search.id,
              value: "Enter",
              waitFor: [
                { type: "text", text: "Results for watch", match: "exact" },
              ],
            },
          ],
        });
        expect(result.isError).not.toBe(true);
        expect(decode(result).url).toBe(url + "/results");
        expect(result.content.some((c) => c.type === "image")).toBe(true);
        expect(
          (await call("submit", { completed: true, steps: [] })).isError,
        ).not.toBe(true);
        return { sessionId: "fixture", text: "Done" };
      },
    };
    try {
      await createBrowserAgent({
        llm,
        dir,
        authorizedUrl: url,
        siteOf: (h) => h,
      }).run({
        id: "sequence",
        request: {
          url,
          goal: "Find Watch details, select Series 8 and search",
        },
        schema: z.object({
          completed: z.boolean(),
          steps: z.array(z.unknown()),
        }),
        maxSteps: 6,
        signal: AbortSignal.timeout(30_000),
        onStep: (step) => {
          frames.push(Boolean(step.screenshot));
        },
      });
      const trace = await readArtifact(
        join(dir, "explore/traces/sequence.json"),
        BrowserTrace,
      );
      expect(trace.schemaVersion).toBe(2);
      expect(trace.steps.map((s) => s.action)).toEqual([
        "navigate",
        "click",
        "select",
        "type",
        "press",
      ]);
      expect(trace.steps[1]).toMatchObject({
        target_text: "Details",
        target_role: "button",
        near_text: "Watch",
        outcome: "verified",
      });
      expect(trace.steps[2]).toMatchObject({
        value: "series-8",
        expect: expect.arrayContaining([
          { type: "value", target: "Watch model", value: "series-8" },
        ]),
      });
      expect(trace.steps.at(-1)?.expect).toContainEqual({
        type: "url",
        pattern: "/results",
      });
      expect(frames).toEqual([true, true, true, false, true]);
      const runtime = await readArtifact(
        join(dir, "explore/runtime/sequence.json"),
        BrowserRuntime,
      );
      expect(runtime.gpu.attempts.at(-1)?.status).toBe("selected");
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000,
);
