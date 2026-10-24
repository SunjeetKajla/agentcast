import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreativeBrief,
  ProductBrief,
  FlowsFile,
  JobConfig,
  ReplayPlan,
  jobPaths,
  type Flow,
} from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import type { BrowserAdapter, RehearsalResult } from "@agentcast/explore";
import type { TinyFish, Run } from "@agentcast/tinyfish";
import type { StageContext } from "../context";
import { addFlow, editStep } from "./flow-runs";

let dir: string;
let ctx: StageContext;
let browser: BrowserAdapter;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-review-"));
  const io: Pick<StageContext, "read" | "write"> = {
    read: (rel, schema) => readArtifact(join(dir, rel), schema),
    write: (rel, schema, value) => writeArtifact(join(dir, rel), schema, value),
  };
  ctx = {
    ...io,
    dir,
    config: JobConfig.parse({ url: "https://demoboard.vercel.app/" }),
    signal: new AbortController().signal,
    emit: vi.fn(),
    log: vi.fn(),
    progress: vi.fn(),
    llm: { json: vi.fn() },
  } as unknown as StageContext;
  await ctx.write(
    jobPaths.productBrief,
    ProductBrief,
    await readArtifact(
      join(FIXTURE_JOB_DIR, jobPaths.productBrief),
      ProductBrief,
    ),
  );
  await ctx.write(
    jobPaths.creativeBrief,
    CreativeBrief,
    await readArtifact(
      join(FIXTURE_JOB_DIR, jobPaths.creativeBrief),
      CreativeBrief,
    ),
  );
  await ctx.write(
    jobPaths.flows,
    FlowsFile,
    await readArtifact(join(FIXTURE_JOB_DIR, jobPaths.flows), FlowsFile),
  );
  await ctx.write(jobPaths.replayPlan, ReplayPlan, {
    schemaVersion: 1,
    byFormFactor: {
      desktop: {
        "flow-template.s1": {
          strategy: "text",
          locator: "obsolete",
          lastOk: "",
        },
        "other.s1": { strategy: "text", locator: "preserved", lastOk: "" },
      },
    },
  });
  browser = {
    readPage: vi.fn(),
    inspect: vi.fn(),
    rehearse: vi.fn(async (flow: Flow): Promise<RehearsalResult> => ({
      flow: { ...flow, rehearsal: { ok: true } },
      replay: {
        schemaVersion: 1,
        byFormFactor: {
          desktop: {
            [`${flow.id}.s1`]: {
              strategy: "role",
              locator: "rehearsed",
              lastOk: "",
            },
          },
        },
      },
    })),
  };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("flow review action implementations", () => {
  it("rejects an edit that turns a public field into a credential input before saving or rehearsing it", async () => {
    await expect(
      editStep(
        ctx,
        {
          flowId: "flow-template",
          stepId: "s1",
          text: "Password",
          value: "private-credential",
        },
        { browser, tf: {} as TinyFish },
      ),
    ).rejects.toThrow("Secret inputs");
    expect(browser.rehearse).not.toHaveBeenCalled();
    expect(
      JSON.stringify(await ctx.read(jobPaths.flows, FlowsFile)),
    ).not.toContain("private-credential");
  });
  it("rehearses an edited step and replaces only that flow's saved locators", async () => {
    const result = await editStep(
      ctx,
      { flowId: "flow-template", stepId: "s1", text: "Create project" },
      { browser, tf: {} as TinyFish },
    );
    expect(result.steps[0]?.target?.text).toBe("Create project");
    expect(result.selected).toBe(true);
    expect(browser.rehearse).toHaveBeenCalledTimes(1);
    const replay = await ctx.read(jobPaths.replayPlan, ReplayPlan);
    expect(replay.byFormFactor.desktop?.["flow-template.s1"]?.locator).toBe(
      "rehearsed",
    );
    expect(replay.byFormFactor.desktop?.["other.s1"]?.locator).toBe(
      "preserved",
    );
  });
  it("deselects a failed edit and invalidates stale locators even without a new replay plan", async () => {
    vi.mocked(browser.rehearse).mockImplementation(async (flow) => ({
      flow: { ...flow, rehearsal: { ok: false, reason: "Missing target" } },
    }));
    const result = await editStep(
      ctx,
      { flowId: "flow-template", stepId: "s1", text: "Missing" },
      { browser, tf: {} as TinyFish },
    );
    expect(result.selected).toBe(false);
    expect(
      (await ctx.read(jobPaths.replayPlan, ReplayPlan)).byFormFactor.desktop,
    ).not.toHaveProperty("flow-template.s1");
  });
  it("reuses a completed add-flow request and saves its independent replay locators", async () => {
    const completed: Run = {
      run_id: "user-run",
      status: "COMPLETED",
      result: {
        flow_title: "Preview a project",
        completed: true,
        steps: [
          { action: "click", target_role: "button", target_text: "Preview" },
          { action: "click", target_role: "button", target_text: "Details" },
        ],
      },
      goal: "",
      created_at: "",
      started_at: null,
      finished_at: null,
      num_of_steps: 0,
      error: null,
      steps: [],
      streaming_url: null,
      video_url: null,
    };
    const tf = {
      runAsync: vi.fn(async () => "user-run"),
      getRun: vi.fn(async () => completed),
    } as unknown as TinyFish;
    const added = await addFlow(
      ctx,
      { description: "Preview the project details" },
      { browser, tf },
    );
    expect(added.source).toBe("user");
    expect(added.selected).toBe(true);
    expect(
      (await ctx.read(jobPaths.replayPlan, ReplayPlan)).byFormFactor.desktop?.[
        `${added.id}.s1`
      ]?.locator,
    ).toBe("rehearsed");
    const again = await addFlow(
      ctx,
      { description: "Preview the project details" },
      { browser, tf },
    );
    expect(again.id).toBe(added.id);
    expect(tf.runAsync).toHaveBeenCalledTimes(1);
    expect(browser.rehearse).toHaveBeenCalledTimes(1);
  });
});
