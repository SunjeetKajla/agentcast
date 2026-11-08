import { describe, expect, it } from "vitest";
import { BrowserTrace, Flow } from "@agentcast/shared";
import {
  collectTaskCoverage,
  coverageArea,
  coverageUrl,
  CoverageReport,
  navigationInventory,
  noteReplay,
  summarizeCoverage,
} from "./coverage";
import type { ArtifactIO } from "./runtime";
import type { PageFacts } from "./tour";

const root = "https://www.product.example/";
const facts = (hrefs: string[]): PageFacts => ({
  url: root,
  title: "Product",
  height: 1800,
  viewport: 900,
  tabs: [],
  links: hrefs.map((href) => ({ text: href, href, inNav: true })),
});
const task = {
  id: "scout",
  source: "scout" as const,
  requestedUrl: root,
  status: "done" as const,
  maxActions: 18,
  timeoutMs: 240000,
  actions: 0,
  traceAvailable: false,
};
const ioFor = (raw: unknown): ArtifactIO => ({
  read: async (file, schema) => {
    if (!file.includes("/traces/"))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return schema.parse(raw);
  },
  write: async (_, schema, value) => schema.parse(value),
});

describe("bounded same-site coverage", () => {
  it("resolves root links against the actual authorized redirect origin", () => {
    const page = {
      ...facts(["/monitor", "/workspaces"]),
      url: "https://app.product.example/home",
    };
    const report = navigationInventory(root, page);
    expect(report.paths.map((p) => p.url)).toEqual([
      "https://app.product.example/home",
      "https://app.product.example/monitor",
      "https://app.product.example/workspaces",
    ]);
    expect(
      navigationInventory(root, { ...page, url: "https://evil.example/home" })
        .paths,
    ).toEqual([]);
  });
  it("groups product families and reserves inventory slots for broad branches", () => {
    const report = navigationInventory(
      root,
      facts([
        ...Array.from({ length: 25 }, (_, n) => `/iphone-${n}/`),
        "/mac/",
        "/ipad/",
        "/watch/",
        "/airpods/",
        "/services/",
        "/docs/",
        "/pricing/",
      ]),
      { maxSections: 5 },
    );
    expect(report.areas.map((a) => a.id)).toEqual([
      "product.example/",
      "product.example/iphone",
      "product.example/mac",
      "product.example/ipad",
      "product.example/watch",
    ]);
    expect(report.limits.inventoryTruncated).toBe(true);
    expect(report.exhaustive).toBe(false);
    expect(report.counts.observed).toBe(0);
    expect(report.paths[0]?.inspected).toBe(true);
    expect(report.paths.every((p) => p.unvisited)).toBe(true);
    expect(
      report.paths.filter((p) => p.areaId === "product.example/iphone"),
    ).toHaveLength(20);
    expect(coverageArea("https://product.example/us/shop/iphone-17-pro")).toBe(
      "product.example/iphone",
    );
  });

  it("deduplicates route/query/fragment aliases and rejects dangerous or unauthorized URLs", () => {
    const report = navigationInventory(
      root,
      facts([
        "/mac/",
        "/mac?utm_source=x",
        "/mac#details",
        "/mac/?token=secret",
        "/account",
        "/shop/bag",
        "/checkout",
        "/privacy",
        "/legal/terms",
        "/%64elete/all",
        "https://evil.example/mac",
        "javascript:alert(1)",
        "https://user:secret@product.example/mac",
        "/press/file.pdf",
      ]),
    );
    expect(report.paths.map((p) => p.url)).toEqual([
      root,
      "https://www.product.example/mac",
    ]);
    expect(report.limits.excludedLinks).toBe(10);
    expect(JSON.stringify(report)).not.toContain("token=secret");
    expect(
      coverageUrl("https://other.vercel.app/mac", "https://mine.vercel.app/"),
    ).toBeUndefined();
    expect(
      coverageUrl("https://account.product.example/", root),
    ).toBeUndefined();
    expect(coverageUrl("/plans", root, "Change billing")).toBeUndefined();
  });

  it("counts observed paths only from actual traces, never inventory or reported candidates", async () => {
    const report = navigationInventory(
      root,
      facts(["/mac", "/ipad", "/watch"]),
    );
    await collectTaskCoverage(
      report,
      ioFor({
        schemaVersion: 1,
        steps: [
          { action: "navigate", result_url_path: "/" },
          { action: "click", result_url_path: "/mac?secret=not-retained" },
          { action: "scroll", result_url_path: "/mac" },
          { action: "wait", result_url_path: "/mac" },
          { action: "click", result_url_path: "https://evil.example/" },
        ],
      }),
      { ...task },
    );
    expect(report.counts).toMatchObject({
      discovered: 4,
      observed: 2,
      unvisited: 2,
      replayed: 0,
    });
    expect(report.tasks[0]).toMatchObject({ actions: 4, traceAvailable: true });
    expect(report.paths.find((p) => p.path === "/ipad")?.observed).toBe(false);
    expect(JSON.stringify(report)).not.toContain("not-retained");
    // Re-reading durable evidence replaces it; it does not double the counts.
    await collectTaskCoverage(
      report,
      ioFor({
        schemaVersion: 2,
        steps: [{ action: "navigate", result_url_path: "/" }],
      }),
      { ...task },
    );
    expect(report.counts.observed).toBe(1);
    expect(report.limits.actions).toBe(1);
  });

  it("keeps tours and independent agent rehearsals distinct from observed browsing", () => {
    const report = navigationInventory(root, facts(["/mac"]));
    const flow = Flow.parse({
      id: "t1",
      title: "Tour",
      whyItMatters: "",
      startUrl: root,
      selected: false,
      rank: 0,
      requiresAuth: false,
      source: "tour",
      steps: [{ id: "s1", action: "scroll", value: "500" }],
      rehearsal: { ok: true },
    });
    noteReplay(report, flow);
    expect(summarizeCoverage(report).counts).toMatchObject({
      observed: 0,
      attempted: 0,
      replayed: 0,
      unvisited: 2,
    });
    expect(
      report.paths[0]?.evidence.some((e) => e.source === "tour" && e.replayed),
    ).toBe(true);
    noteReplay(report, {
      ...flow,
      id: "f1",
      source: "agent",
      startUrl: "https://www.product.example/mac",
    });
    expect(summarizeCoverage(report).counts).toMatchObject({
      observed: 0,
      replayed: 1,
    });
    expect(
      report.paths.find((p) => p.path === "/mac")?.evidence[0]?.source,
    ).toBe("flow");
  });

  it("leaves missing traces unobserved and rejects corrupt durable artifacts", async () => {
    const report = navigationInventory(root, facts(["/mac"]));
    const missing = ioFor(undefined);
    missing.read = async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    };
    await collectTaskCoverage(report, missing, {
      ...task,
      status: "interrupted",
    });
    expect(report.counts).toMatchObject({
      observed: 0,
      attempted: 0,
      blocked: 0,
    });
    expect(report.tasks[0]?.traceAvailable).toBe(false);
    await expect(
      collectTaskCoverage(report, ioFor({ schemaVersion: 99, steps: [] }), {
        ...task,
      }),
    ).rejects.toThrow();
    expect(
      CoverageReport.safeParse({ ...report, exhaustive: true }).success,
    ).toBe(false);
    expect(
      BrowserTrace.safeParse({ schemaVersion: 2, steps: [{ action: "click" }] })
        .success,
    ).toBe(false);
  });

  it("separates task failures from observed access barriers and preserves redirect hosts", async () => {
    const report = navigationInventory(root, facts(["/mac"]));
    await collectTaskCoverage(
      report,
      ioFor({
        schemaVersion: 2,
        steps: [
          {
            action: "navigate",
            result_url_path: "/login",
            result_url: "https://app.product.example/login?token=secret",
            result_visible_text: "Sign in required to access this workspace",
          },
        ],
      }),
      { ...task, status: "failed" },
    );
    expect(report.counts.blocked).toBe(1);
    const redirect = report.paths.find(
      (p) => p.url === "https://app.product.example/login",
    );
    expect(redirect).toMatchObject({
      observed: true,
      blocked: true,
      discovered: false,
    });
    expect(report.paths.find((p) => p.url === root)?.blocked).toBe(false);
    expect(coverageUrl(redirect!.url, root)).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("token=secret");
    const noBarrier = navigationInventory(root, facts([]));
    await collectTaskCoverage(
      noBarrier,
      ioFor({
        schemaVersion: 2,
        steps: [
          { action: "navigate", result_url_path: "/", settle: "timeout" },
        ],
      }),
      { ...task, status: "failed" },
    );
    expect(noBarrier.counts).toMatchObject({ observed: 1, blocked: 0 });
  });

  it("surfaces limits including repair work without conflating them with a whole-job timeout", () => {
    const report = navigationInventory(root, facts([]));
    expect(report.budget).toMatchObject({
      maxFlows: 6,
      maxSections: 12,
      maxScouts: 3,
    });
    expect(report.limits.maxAgentActions).toBe(3 * 19 + 6 * 2 * 33);
    expect(report.limits.maxAgentTimeMs).toBe(3 * 240000 + 6 * 2 * 300000);
    expect(() =>
      navigationInventory(root, facts([]), { maxFlows: 13 }),
    ).toThrow();
    expect(() =>
      navigationInventory(root, facts([]), { scoutMaxActions: 65 }),
    ).toThrow();
    expect(() =>
      navigationInventory(root, facts([]), { flowMaxActions: 97 }),
    ).toThrow();
    expect(() =>
      navigationInventory(root, facts([]), { flowTimeoutMs: 600001 }),
    ).toThrow();
  });
});
