import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreativeBrief,
  ProductBrief,
  FlowsFile,
  jobPaths,
  BrowserTrace,
  CoverageReport,
  type Flow,
} from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import { Candidate } from "./agent";
import { ExplorationPlan } from "./artifacts";
import { discoverProduct, executeFlows, type ExploreOptions } from "./pipeline";
import { PageAccessError } from "./local";

const url = "https://product.example/";
const candidate = (title: string) =>
  Candidate.parse({
    title,
    start_url: url,
    why_it_matters: title,
    outline: ["Open preview", "See result"],
  });
const complete = (id: string, result: Record<string, unknown>) => ({
  result,
  sessionId: id,
});
const report = (title: string) => ({
  flow_title: title,
  completed: true,
  steps: [
    { action: "click", target_role: "button", target_text: title },
    { action: "click", target_role: "button", target_text: "Show result" },
  ],
  blockers: [],
});
let dir: string;
let options: ExploreOptions;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-pipeline-"));
  const product = await readArtifact(
    join(FIXTURE_JOB_DIR, jobPaths.productBrief),
    ProductBrief,
  );
  const creative = await readArtifact(
    join(FIXTURE_JOB_DIR, jobPaths.creativeBrief),
    CreativeBrief,
  );
  const agent = {
    run: vi.fn(async () =>
      complete("scout-id", {
        entry_url: url,
        access: "public",
        reason: "Public examples",
        candidates: [candidate("Preview components")],
        blockers: [],
      }),
    ),
  };
  options = {
    url,
    dir,
    product,
    creative,
    agent: agent as unknown as ExploreOptions["agent"],
    publicMode: true,
    io: {
      read: (file, schema) => readArtifact(join(dir, file), schema),
      write: (file, schema, value) =>
        writeArtifact(join(dir, file), schema, value),
    },
    llm: {
      json: vi.fn(async (task) => {
        const flows = await readArtifact(join(dir, jobPaths.flows), FlowsFile);
        return task.schema.parse({
          flows: flows.flows
            .filter((flow) => flow.rehearsal?.ok)
            .map((flow) => ({
              id: flow.id,
              valueAlignment: 4,
              visiblePayoff: 4,
              storyRole: "core",
              valuePropCited: product.valueProps[0],
              rationale: "A demonstrated result",
            })),
        });
      }),
    },
    browser: {
      readPage: vi.fn(),
      inspect: vi.fn(async () => ({
        facts: {
          url,
          title: "Public component library",
          heading: "Public previews",
          height: 2400,
          viewport: 900,
          links: [],
          tabs: [],
        },
      })),
      rehearse: vi.fn(async (flow: Flow) => ({
        flow: { ...flow, rehearsal: { ok: true, seconds: 8 } },
      })),
    },
  };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("exploration orchestration (ported worker regressions)", () => {
  it("actually scouts additional unvisited sections and explores six candidates while selecting at most four", async () => {
    const areas = [
      "mac",
      "ipad",
      "watch",
      "airpods",
      "services",
      "docs",
      "pricing",
    ];
    vi.mocked(options.browser.inspect).mockImplementation(
      async (requested) => ({
        facts: {
          url: requested,
          title: "Product",
          height: 1000,
          viewport: 900,
          tabs: [],
          links: areas.map((area) => ({
            text: area,
            href: `/${area}`,
            inNav: true,
          })),
        },
      }),
    );
    let active = 0;
    let peak = 0;
    vi.mocked(options.agent.run).mockImplementation(async (task) => {
      active++;
      peak = Math.max(peak, active);
      try {
        const start = new URL(task.request.url).pathname;
        await options.io.write(`explore/traces/${task.id}.json`, BrowserTrace, {
          schemaVersion: 2,
          steps: [
            {
              action: "navigate",
              result_url_path: start,
              result_url: task.request.url,
              elapsedMs: 20,
            },
          ],
        });
        // Yield to the second focused task and check the shared process pool stays bounded.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          sessionId: task.id,
          result: task.schema.parse(
            task.id.startsWith("scout")
              ? {
                  entry_url: task.request.url,
                  access: "public",
                  reason: "Local section controls",
                  blockers: [],
                  candidates: [1, 2, 3, 4].map((n) => ({
                    ...candidate(`${start} interaction ${n}`),
                    start_url: task.request.url,
                  })),
                }
              : report(task.id),
          ),
        };
      } finally {
        active--;
      }
    });
    const plan = await discoverProduct(options);
    expect(plan.schemaVersion).toBe(2);
    expect(plan.candidates).toHaveLength(6);
    expect([
      ...new Set(plan.candidates.map((c) => new URL(c.start_url).pathname)),
    ]).toEqual(["/", "/mac", "/ipad"]);
    const scouts = vi
      .mocked(options.agent.run)
      .mock.calls.map(([task]) => task);
    expect(scouts.map((t) => t.id)).toEqual([
      "scout",
      "scout-section-1",
      "scout-section-2",
    ]);
    expect(scouts.map((t) => t.request.url)).toEqual([
      url,
      `${url}mac`,
      `${url}ipad`,
    ]);
    expect(scouts[1]!.request.goal).toContain("supplemental scout");
    expect(
      scouts.every(
        (t) =>
          (t.request.output_schema?.properties as any).candidates.maxItems ===
          2,
      ),
    ).toBe(true);
    const coverage = await options.io.read(
      "explore/coverage.json",
      CoverageReport,
    );
    expect(coverage.counts).toMatchObject({
      discovered: 8,
      observed: 3,
      unvisited: 5,
      replayed: 0,
    });
    expect(coverage.tasks).toHaveLength(3);
    const flows = await executeFlows(options);
    expect(options.agent.run).toHaveBeenCalledTimes(9);
    expect(flows.filter((f) => f.source === "agent")).toHaveLength(6);
    expect(flows.filter((f) => f.selected).length).toBeLessThanOrEqual(4);
    expect(peak).toBe(2);
    const completed = await options.io.read(
      "explore/coverage.json",
      CoverageReport,
    );
    expect(completed.limits).toMatchObject({
      candidateFlows: 6,
      scoutTasks: 3,
      flowTasks: 6,
      actions: 9,
    });
    expect(completed.counts).toMatchObject({
      observed: 3,
      replayed: 3,
      unvisited: 5,
    });
    const elapsed = completed.limits.elapsedTaskMs;
    await executeFlows(options);
    expect(options.agent.run).toHaveBeenCalledTimes(9);
    expect(
      (await options.io.read("explore/coverage.json", CoverageReport)).limits
        .actions,
    ).toBe(9);
    expect(
      (await options.io.read("explore/coverage.json", CoverageReport)).limits
        .elapsedTaskMs,
    ).toBe(elapsed);
  });

  it("continues to another section after an interrupted scout without retrying that task", async () => {
    vi.mocked(options.browser.inspect).mockImplementation(
      async (requested) => ({
        facts: {
          url: requested,
          title: "Product",
          height: 1000,
          viewport: 900,
          tabs: [],
          links: [
            { text: "Mac", href: "/mac", inNav: true },
            { text: "iPad", href: "/ipad", inNav: true },
          ],
        },
      }),
    );
    vi.mocked(options.agent.run).mockImplementation(async (task) => {
      if (task.id === "scout") throw new Error("Interrupted browser session");
      return {
        sessionId: task.id,
        result: task.schema.parse({
          entry_url: task.request.url,
          access: "public",
          reason: "Actual controls",
          blockers: [],
          candidates: [
            { ...candidate(task.request.url), start_url: task.request.url },
          ],
        }),
      };
    });
    expect((await discoverProduct(options)).candidates).toHaveLength(2);
    const calls = vi
      .mocked(options.agent.run)
      .mock.calls.map(([task]) => task.id);
    expect(calls).toEqual(["scout", "scout-section-1", "scout-section-2"]);
    const coverage = await options.io.read(
      "explore/coverage.json",
      CoverageReport,
    );
    expect(coverage.counts.observed).toBe(0); // Reports without traces do not establish visits.
    expect(coverage.tasks.find((t) => t.id === "scout")?.status).toBe("failed");
    await discoverProduct(options);
    expect(options.agent.run).toHaveBeenCalledTimes(3); // Failed task IDs remain interrupted; no duplicate mutations.
  });

  it("honors a smaller exploration budget and preserves coverage when every rehearsal fails", async () => {
    options.budget = { maxFlows: 1, maxScouts: 1, maxSections: 2 };
    await discoverProduct(options);
    vi.mocked(options.agent.run).mockResolvedValue(
      complete("flow-id", report("Preview components")),
    );
    vi.mocked(options.browser.rehearse).mockImplementation(async (flow) => ({
      flow: { ...flow, rehearsal: { ok: false, reason: "No target" } },
    }));
    await expect(executeFlows(options)).rejects.toThrow(
      "No reported flow or guided tour replayed",
    );
    const coverage = await options.io.read(
      "explore/coverage.json",
      CoverageReport,
    );
    expect(coverage.budget).toMatchObject({
      maxFlows: 1,
      maxScouts: 1,
      maxSections: 2,
    });
    expect(coverage.tasks.map((t) => t.id)).toEqual([
      "scout",
      "f1",
      "f1-repair",
    ]);
    expect(coverage.limits.candidateFlows).toBe(1);
    expect(
      coverage.paths.some((p) => p.evidence.some((e) => e.source === "tour")),
    ).toBe(true);
    expect(coverage.counts.replayed).toBe(0);
  });

  it("checks app routes with the session before focused runs and does not pay for a 404 candidate", async () => {
    const entry = "https://app.product.example/home";
    const good = "https://app.product.example/monitor";
    const bad = "https://app.product.example/missing";
    options.publicMode = false;
    const state = {
      cookies: [],
      origins: [
        {
          origin: "https://app.product.example",
          localStorage: [{ name: "session", value: "private-token" }],
        },
      ],
    };
    options.browserOptions = { storageState: state };
    vi.mocked(options.browser.inspect).mockImplementation(async (requested) => {
      if (requested === bad)
        throw new PageAccessError(
          "unavailable",
          "The product entrance returned HTTP 404.",
        );
      return {
        facts: {
          url: requested,
          title: "Workspace",
          heading: "Workspace",
          height: 1000,
          viewport: 900,
          links: [],
          tabs: [],
        },
      };
    });
    await options.io.write("explore/plan.json", ExplorationPlan, {
      schemaVersion: 1,
      entryUrl: entry,
      access: "authenticated",
      reason: "",
      blockers: [],
      candidates: [
        { ...candidate("Preview monitor"), start_url: good },
        { ...candidate("Missing feature"), start_url: bad },
      ],
    });
    vi.mocked(options.agent.run).mockResolvedValue(
      complete("scout-id", {
        ...report("Preview monitor"),
        steps: [
          { action: "navigate", result_url_path: "/monitor" },
          ...report("Preview monitor").steps,
        ],
      }),
    );
    const flows = await executeFlows(options);
    expect(options.agent.run).toHaveBeenCalledTimes(1);
    expect(options.agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ url: good }),
        storageState: state,
      }),
    );
    expect(options.browser.inspect).toHaveBeenCalledWith(
      bad,
      expect.objectContaining({ storageState: state }),
    );
    expect(flows.find((flow) => flow.id === "f1")?.startUrl).toBe(good);
    const failed = flows.find((flow) => flow.id === "f2")!;
    expect(failed.selected).toBe(false);
    expect(failed.rehearsal?.reason).toContain("HTTP 404");
    expect(options.browser.rehearse).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "f2" }),
      expect.anything(),
    );
  });

  it("resolves relative scout candidates on the discovered app origin", async () => {
    const entry = "https://app.product.example/home";
    vi.mocked(options.browser.inspect).mockImplementation(
      async (requested) => ({
        facts: {
          url: requested,
          title: "Workspace",
          heading: "Workspace",
          height: 1000,
          viewport: 900,
          links: [],
          tabs: [],
        },
      }),
    );
    vi.mocked(options.agent.run).mockResolvedValue(
      complete("scout-id", {
        entry_url: entry,
        access: "public",
        reason: "Public app",
        blockers: [],
        candidates: [
          { ...candidate("Preview monitor"), start_url: "/monitor" },
        ],
      }),
    );
    const plan = await discoverProduct(options);
    expect(plan.entryUrl).toBe(entry);
    expect(plan.candidates[0]?.start_url).toBe(
      "https://app.product.example/monitor",
    );
  });
  it("enforces a bounded local scout and filters account/off-site candidates in public mode", async () => {
    vi.mocked(options.agent.run).mockResolvedValue(
      complete("scout-id", {
        entry_url: url,
        access: "public",
        reason: "The component page is the app",
        candidates: [
          candidate("Preview components"),
          { ...candidate("Account settings"), needs_sign_in: true },
          {
            ...candidate("External editor"),
            start_url: "https://external.example/",
          },
        ],
        blockers: [],
      }),
    );
    expect(
      (await discoverProduct(options)).candidates.map((flow) => flow.title),
    ).toEqual(["Preview components"]);
    expect(options.agent.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        maxSteps: 18,
        request: expect.objectContaining({ url }),
      }),
    );
    expect(
      vi.mocked(options.agent.run).mock.calls[0]![0].request.goal,
    ).toContain("public access (no login)");
  });
  it("does not loop or invent a login requirement when the agent browser is blocked", async () => {
    vi.mocked(options.agent.run).mockResolvedValue(
      complete("scout-id", {
        entry_url: url,
        access: "blocked",
        reason: "Access denied",
        candidates: [],
        blockers: ["Cloudflare"],
      }),
    );
    const plan = await discoverProduct(options);
    expect(plan.access).toBe("public");
    const flows = await executeFlows(options);
    expect(flows.some((flow) => flow.source === "tour" && flow.selected)).toBe(
      true,
    );
    expect(options.agent.run).toHaveBeenCalledTimes(1);
    expect(options.browser.rehearse).toHaveBeenCalled();
  });
  it("repairs a failed replay once, preserves good results and reuses completed results on restart", async () => {
    await options.io.write("explore/plan.json", ExplorationPlan, {
      schemaVersion: 1,
      entryUrl: url,
      access: "public",
      reason: "",
      blockers: [],
      candidates: [candidate("Preview components"), candidate("Change theme")],
    });
    vi.mocked(options.agent.run).mockImplementation(async (task) => ({
      result: task.schema.parse(
        report(
          task.request.goal.includes("Change theme")
            ? "Change theme"
            : "Preview components",
        ),
      ),
      sessionId: task.id,
    }));
    const attempts = new Map<string, number>();
    vi.mocked(options.browser.rehearse).mockImplementation(async (flow) => {
      attempts.set(flow.id, (attempts.get(flow.id) ?? 0) + 1);
      const ok = flow.id !== "f1" || attempts.get(flow.id)! > 1;
      return {
        flow: {
          ...flow,
          rehearsal: {
            ok,
            seconds: 8,
            ...(ok ? {} : { reason: "A prerequisite was missing" }),
          },
        },
      };
    });
    const flows = await executeFlows(options);
    expect(
      flows
        .filter((flow) => flow.rehearsal?.ok)
        .map((flow) => flow.id)
        .sort(),
    ).toEqual(["f1", "f2"]);
    expect(options.agent.run).toHaveBeenCalledTimes(3);
    expect(attempts.get("f1")).toBe(2);
    expect(attempts.get("f2")).toBe(1);
    await executeFlows(options);
    expect(options.agent.run).toHaveBeenCalledTimes(3);
    expect(attempts.get("f2")).toBe(1);
  });
  it("never selects a flow solely because the agent claimed success", async () => {
    await discoverProduct(options);
    vi.mocked(options.agent.run).mockResolvedValue(
      complete("scout-id", report("Preview components")),
    );
    vi.mocked(options.browser.rehearse).mockImplementation(async (flow) => ({
      flow: { ...flow, rehearsal: { ok: false, reason: "No unique target" } },
    }));
    await expect(executeFlows(options)).rejects.toThrow(
      "No reported flow or guided tour replayed",
    );
    const saved = await options.io.read(jobPaths.flows, FlowsFile);
    expect(saved.flows.every((flow) => !flow.selected)).toBe(true);
    expect(options.llm.json).not.toHaveBeenCalled();
  });
});
