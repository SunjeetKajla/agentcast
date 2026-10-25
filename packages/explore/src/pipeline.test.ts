import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreativeBrief,
  ProductBrief,
  FlowsFile,
  jobPaths,
  type Flow,
} from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import {
  type TinyFish,
  type Run,
  type AgentRequest,
} from "@agentcast/tinyfish";
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
const complete = (id: string, result: Record<string, unknown>): Run => ({
  run_id: id,
  status: "COMPLETED",
  result,
  goal: "",
  created_at: "",
  started_at: null,
  finished_at: null,
  num_of_steps: 0,
  error: null,
  steps: [],
  streaming_url: null,
  video_url: null,
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
  const tf = {
    runAsync: vi.fn(async () => "scout-id"),
    getRun: vi.fn(async () =>
      complete("scout-id", {
        entry_url: url,
        access: "public",
        reason: "Public examples",
        candidates: [candidate("Preview components")],
        blockers: [],
      }),
    ),
    cancelRun: vi.fn(),
  };
  options = {
    url,
    dir,
    product,
    creative,
    tf: tf as unknown as TinyFish,
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
  it("checks app routes with the session before focused runs and does not pay for a 404 candidate", async () => {
    const entry = "https://app.product.example/home";
    const good = "https://app.product.example/monitor";
    const bad = "https://app.product.example/missing";
    options.publicMode = false;
    options.auth = { use_profile: true, profile_id: "profile-fixture" };
    const state = { cookies: [], origins: [{ origin: "https://app.product.example", localStorage: [{ name: "session", value: "private-token" }] }] };
    options.browserOptions = { storageState: state };
    vi.mocked(options.browser.inspect).mockImplementation(async (requested) => {
      if (requested === bad) throw new PageAccessError("unavailable", "The product entrance returned HTTP 404.");
      return { facts: { url: requested, title: "Workspace", heading: "Workspace", height: 1000, viewport: 900, links: [], tabs: [] } };
    });
    await options.io.write("explore/plan.json", ExplorationPlan, {
      schemaVersion: 1, entryUrl: entry, access: "authenticated", reason: "", blockers: [],
      candidates: [{ ...candidate("Preview monitor"), start_url: good }, { ...candidate("Missing feature"), start_url: bad }],
    });
    vi.mocked(options.tf.getRun).mockResolvedValue(complete("scout-id", {
      ...report("Preview monitor"), steps: [{ action: "navigate", result_url_path: "/monitor" }, ...report("Preview monitor").steps],
    }));
    const flows = await executeFlows(options);
    expect(options.tf.runAsync).toHaveBeenCalledTimes(1);
    expect(options.tf.runAsync).toHaveBeenCalledWith(expect.objectContaining({ url: good, use_profile: true, profile_id: "profile-fixture" }), expect.any(AbortSignal));
    expect(options.browser.inspect).toHaveBeenCalledWith(bad, expect.objectContaining({ storageState: state }));
    expect(flows.find((flow) => flow.id === "f1")?.startUrl).toBe(good);
    const failed = flows.find((flow) => flow.id === "f2")!;
    expect(failed.selected).toBe(false);
    expect(failed.rehearsal?.reason).toContain("HTTP 404");
    expect(options.browser.rehearse).not.toHaveBeenCalledWith(expect.objectContaining({ id: "f2" }), expect.anything());
  });

  it("resolves relative scout candidates on the discovered app origin", async () => {
    const entry = "https://app.product.example/home";
    vi.mocked(options.browser.inspect).mockImplementation(async (requested) => ({ facts: {
      url: requested, title: "Workspace", heading: "Workspace", height: 1000, viewport: 900, links: [], tabs: [],
    } }));
    vi.mocked(options.tf.getRun).mockResolvedValue(complete("scout-id", {
      entry_url: entry, access: "public", reason: "Public app", blockers: [],
      candidates: [{ ...candidate("Preview monitor"), start_url: "/monitor" }],
    }));
    const plan = await discoverProduct(options);
    expect(plan.entryUrl).toBe(entry);
    expect(plan.candidates[0]?.start_url).toBe("https://app.product.example/monitor");
  });
  it("uses stealth without beta-only max_steps and filters account/off-site candidates in public mode", async () => {
    vi.mocked(options.tf.getRun).mockResolvedValue(
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
    expect(options.tf.runAsync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        browser_profile: "stealth",
        agent_config: { max_duration_seconds: 60 },
      }),
      expect.any(AbortSignal),
    );
    expect(vi.mocked(options.tf.runAsync).mock.calls[0]![0].goal).toContain(
      "public access (no login)",
    );
  });
  it("does not loop or invent a login requirement when the remote browser is blocked", async () => {
    vi.mocked(options.tf.getRun).mockResolvedValue(
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
    expect(options.tf.runAsync).toHaveBeenCalledTimes(1);
    expect(options.browser.rehearse).toHaveBeenCalled();
  });
  it("repairs a failed replay once, preserves good results and reuses provider IDs on restart", async () => {
    await options.io.write("explore/plan.json", ExplorationPlan, {
      schemaVersion: 1,
      entryUrl: url,
      access: "public",
      reason: "",
      blockers: [],
      candidates: [candidate("Preview components"), candidate("Change theme")],
    });
    let count = 0;
    const requests = new Map<string, AgentRequest>();
    vi.mocked(options.tf.runAsync).mockImplementation(async (request) => {
      const id = `run-${++count}`;
      requests.set(id, request);
      return id;
    });
    vi.mocked(options.tf.getRun).mockImplementation(async (id) =>
      complete(
        id,
        report(
          requests.get(id)!.goal.includes("Change theme")
            ? "Change theme"
            : "Preview components",
        ),
      ),
    );
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
    expect(options.tf.runAsync).toHaveBeenCalledTimes(3);
    expect(attempts.get("f1")).toBe(2);
    expect(attempts.get("f2")).toBe(1);
    await executeFlows(options);
    expect(options.tf.runAsync).toHaveBeenCalledTimes(3);
    expect(attempts.get("f2")).toBe(1);
  });
  it("never selects a flow solely because the remote agent claimed success", async () => {
    await discoverProduct(options);
    vi.mocked(options.tf.getRun).mockResolvedValue(
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
