import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CreativeBrief,
  ProductBrief,
  JobConfig,
  jobPaths,
} from "@agentcast/shared";
import { FIXTURE_JOB_DIR, readArtifact } from "@agentcast/shared/node";
import { join } from "node:path";
import {
  agentEvents,
  explorationBudgetFromEnv,
  explorationOptions,
} from "./discover";
import type { StageContext } from "../context";

afterEach(() => vi.unstubAllEnvs());

describe("worker exploration budget", () => {
  it("defaults to broader exploration without changing JobConfig", () => {
    expect(explorationBudgetFromEnv({})).toEqual({
      maxFlows: 6,
      maxSections: 12,
      maxScouts: 3,
    });
  });
  it("caps integers and falls back for malformed environment values", () => {
    expect(
      explorationBudgetFromEnv({
        AGENTCAST_EXPLORE_MAX_FLOWS: "100",
        AGENTCAST_EXPLORE_MAX_SECTIONS: "0",
        AGENTCAST_EXPLORE_MAX_SCOUTS: "999",
      }),
    ).toEqual({ maxFlows: 12, maxSections: 1, maxScouts: 4 });
    expect(
      explorationBudgetFromEnv({
        AGENTCAST_EXPLORE_MAX_FLOWS: "2.5",
        AGENTCAST_EXPLORE_MAX_SECTIONS: "-1",
        AGENTCAST_EXPLORE_MAX_SCOUTS: "NaN",
      }),
    ).toEqual({ maxFlows: 6, maxSections: 12, maxScouts: 3 });
    expect(
      explorationBudgetFromEnv({
        AGENTCAST_EXPLORE_MAX_FLOWS: " 4 ",
        AGENTCAST_EXPLORE_MAX_SECTIONS: "9007199254740999999999",
        AGENTCAST_EXPLORE_MAX_SCOUTS: "",
      }),
    ).toEqual({ maxFlows: 4, maxSections: 12, maxScouts: 3 });
  });
  it("maps worker environment into ExploreOptions using injected browser dependencies", async () => {
    vi.stubEnv("AGENTCAST_EXPLORE_MAX_FLOWS", "9");
    vi.stubEnv("AGENTCAST_EXPLORE_MAX_SECTIONS", "15");
    vi.stubEnv("AGENTCAST_EXPLORE_MAX_SCOUTS", "4");
    const product = await readArtifact(
      join(FIXTURE_JOB_DIR, jobPaths.productBrief),
      ProductBrief,
    );
    const creative = await readArtifact(
      join(FIXTURE_JOB_DIR, jobPaths.creativeBrief),
      CreativeBrief,
    );
    const ctx = {
      config: { url: "https://product.example/", auth: { mode: "public" } },
      dir: "/tmp/agentcast-test",
      read: vi.fn(async (file) =>
        file === jobPaths.productBrief ? product : creative,
      ),
      llm: {},
      llmProgress: vi.fn(),
      emit: vi.fn(),
      log: vi.fn(),
      progress: vi.fn(),
      signal: new AbortController().signal,
    } as unknown as StageContext;
    const deps = {
      agent: { run: vi.fn() },
      browser: { readPage: vi.fn(), inspect: vi.fn(), rehearse: vi.fn() },
    };
    const options = await explorationOptions(ctx, deps);
    expect(options.budget).toEqual({
      maxFlows: 9,
      maxSections: 15,
      maxScouts: 4,
    });
    expect(options.agent).toBe(deps.agent);
    expect(options.browser).toBe(deps.browser);
  });
});

function setup(mode: "public" | "sign-in-once" = "public") {
  const emit = vi.fn();
  const on = agentEvents({
    emit,
    stage: "discover",
    config: JobConfig.parse({ url: "https://product.example", auth: { mode } }),
  } as unknown as StageContext);
  return { emit, on };
}
describe("observed browser progress", () => {
  it("emits each observed step once and includes local public frames", () => {
    const { emit, on } = setup();
    const update = {
      status: "RUNNING" as const,
      steps: [
        {
          id: "1",
          action: "Open preview",
          screenshot: "explore/frames/scout/1.png",
        },
      ],
    };
    on("scout", "Scout", "started");
    on("scout", "Scout", "step", update);
    on("scout", "Scout", "step", update);
    on("scout", "Scout", "done");
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls[1]![0]).toMatchObject({
      step: "Open preview",
      screenshot: "explore/frames/scout/1.png",
    });
  });
  it("suppresses frames for authenticated runs", () => {
    const { emit, on } = setup("sign-in-once");
    on("a", "A", "step", {
      status: "RUNNING",
      steps: [{ id: "1", action: "Open preview", screenshot: "private.png" }],
    });
    expect(emit.mock.calls[0]![0]).not.toHaveProperty("screenshot");
  });
  it("keeps independent agents apart", () => {
    const { emit, on } = setup();
    for (const id of ["a", "b"])
      on(id, id, "step", {
        status: "RUNNING",
        steps: [{ id: "1", action: id }],
      });
    expect(emit.mock.calls.map(([e]) => e.agentId)).toEqual(["a", "b"]);
  });
});
