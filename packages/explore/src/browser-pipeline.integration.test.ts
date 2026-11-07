import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createLlm } from "@agentcast/llm";
import { createBrowserAgent } from "@agentcast/browser";
import {
  CreativeBrief,
  ProductBrief,
  FlowsFile,
  jobPaths,
} from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import { siteOf } from "./access";
import { workspaceLlm } from "./llm";
import { localBrowserAdapter } from "./local";
import { discoverProduct, executeFlows } from "./pipeline";

it.runIf(process.env.AGENTCAST_TEST_PIPELINE === "1")(
  "discovers and independently rehearses real workflows through the selected logged-in CLI",
  async () => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      const content = req.url?.startsWith("/templates")
        ? "<h1>Template previews</h1><button onclick=\"document.querySelector('section').hidden=false\">Show templates</button><section hidden><button onclick=\"document.querySelector('p').textContent='Starter preview ready'\">Preview starter</button><p>Choose a template</p></section>"
        : req.url?.startsWith("/analytics")
          ? "<h1>Analytics charts</h1><button onclick=\"document.querySelector('section').hidden=false\">Show analytics</button><section hidden><button onclick=\"document.querySelector('p').textContent='Chart for this week'\">Select this week</button><p>Choose a period</p></section>"
          : "<h1>PreviewForge</h1><p>Preview templates and explore analytics charts.</p>";
      res.end(
        `<html><body><nav><a href="/templates">Explore templates</a> <a href="/analytics">View analytics</a></nav>${content}</body></html>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const dir = await mkdtemp(join(tmpdir(), "agentcast-pipeline-live-"));
    const { loadDotEnv } = await import("../../../apps/worker/src/env.ts");
    await loadDotEnv();
    const backend =
      process.env.AGENTCAST_TEST_PIPELINE_BACKEND === "claude-code"
        ? "claude-code"
        : "codex";
    const llm = createLlm({
      backend,
      env: {
        ...process.env,
        AGENTCAST_LLM_SMART: backend,
        AGENTCAST_LLM_FAST: backend,
      },
    });
    const product = {
      ...(await readArtifact(
        join(FIXTURE_JOB_DIR, jobPaths.productBrief),
        ProductBrief,
      )),
      url,
      name: "PreviewForge",
      oneLiner: "Preview templates and explore analytics charts.",
      valueProps: ["Preview starter templates", "View analytics for this week"],
    };
    const creative = {
      ...(await readArtifact(
        join(FIXTURE_JOB_DIR, jobPaths.creativeBrief),
        CreativeBrief,
      )),
      mustShow: ["Preview a starter template", "View this week analytics"],
    };
    const options = {
      url,
      dir,
      product,
      creative,
      publicMode: true,
      llm: workspaceLlm(llm),
      agent: createBrowserAgent({ llm, dir, authorizedUrl: url, siteOf }),
      browser: localBrowserAdapter({
        gpu: "cpu",
        launchOptions: { channel: "chrome" },
      }),
      signal: AbortSignal.timeout(240000),
      io: {
        read: <S extends import("zod").z.ZodType>(rel: string, schema: S) =>
          readArtifact(join(dir, rel), schema),
        write: <S extends import("zod").z.ZodType>(
          rel: string,
          schema: S,
          data: import("zod").z.input<S>,
        ) => writeArtifact(join(dir, rel), schema, data),
      },
    };
    try {
      const plan = await discoverProduct(options);
      expect(plan.candidates.length).toBeGreaterThanOrEqual(2);
      const flows = await executeFlows(options);
      const selected = flows.filter(
        (flow) => flow.selected && flow.source === "agent",
      );
      expect(selected.length).toBeGreaterThanOrEqual(2);
      expect(selected.every((flow) => flow.rehearsal?.ok)).toBe(true);
      expect(
        (await options.io.read(jobPaths.flows, FlowsFile)).schemaVersion,
      ).toBe(2);
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  250000,
);
