import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flow } from "@agentcast/shared";

const mocks = vi.hoisted(() => ({ live: vi.fn(), resolve: vi.fn(), run: vi.fn(), outcome: vi.fn(), snapshot: vi.fn(), screenshot: vi.fn() }));
vi.mock("../live.ts", async (original) => ({ ...await original<typeof import("../live.ts")>(), recordLive: mocks.live }));
vi.mock("./locate.ts", async (original) => ({ ...await original<typeof import("./locate.ts")>(), resolveTarget: mocks.resolve }));
vi.mock("./act.ts", () => ({ createActuator: () => ({ samples: [], run: mocks.run }) }));
vi.mock("./outcome.ts", async (original) => ({ ...await original<typeof import("./outcome.ts")>(), snapshotOutcome: mocks.snapshot, verifyOutcome: mocks.outcome }));
vi.mock("./hygiene.ts", () => ({ installRecordingHygiene: async () => ({ ready: async () => {} }), maskedScreenshot: mocks.screenshot }));
vi.mock("./settle.ts", () => ({ waitForSettle: async () => ({}), trackSettle: () => ({ wait: async () => ({ motion: [] }), navigation: () => [], dispose: () => {} }) }));
vi.mock("./select.ts", () => ({ selectMatch: async () => ({ match: { bbox: [0, 0, 20, 20] } }) }));
vi.mock("./layout.ts", () => ({ pageLayout: async () => undefined }));
import { LiveStallError } from "../live.ts";
import { checkStalls } from "../timing.ts";
import { recordFlow, FlowRecordingError } from "./compile.ts";
import { LocatorResolutionError } from "./locate.ts";
import { OutcomeError } from "./outcome.ts";

let directory: string;
const flow: Flow = { id: "configure", title: "Configure", whyItMatters: "Inspect a model", startUrl: "https://fixture.test", requiresAuth: false, rank: 1, selected: true, source: "agent", steps: [{ id: "model", action: "click", target: { role: "button", text: "Choose model" } }] };
const state = { url: "https://fixture.test", aria: "", signature: "state", landmarks: [] };
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(tmpdir(), "agentcast-diagnostic-flow-"));
  mocks.resolve.mockResolvedValue({ locator: {}, bbox: [0, 0, 20, 20] });
  mocks.snapshot.mockResolvedValue(state);
  mocks.screenshot.mockResolvedValue(Buffer.alloc(0));
  mocks.run.mockResolvedValue({ at: 0 });
  mocks.outcome.mockRejectedValue(new OutcomeError(["missing result"], state));
  mocks.live.mockImplementation(async (options, run) => {
    const session = { page: { goto: async () => {}, viewportSize: () => ({ width: 320, height: 180 }), evaluate: async () => 1, mouse: { move: async () => {} }, url: () => "https://fixture.test" } };
    const signal = new AbortController().signal;
    await options.prepare(session, 1, signal);
    await run({ ...session, signal, now: () => 0, markMotion: () => {}, markStep: () => {}, motion: (work: () => Promise<void>) => work() });
    throw new Error("Fixture must fail before publishing");
  });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function failure(options: Partial<Parameters<typeof recordFlow>[1]> = {}) {
  const takes: unknown[] = [];
  const error = await recordFlow(flow, { outputPath: join(directory, "take.mp4"), maxTakes: 3, onTake: (take) => takes.push(take), ...options }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(FlowRecordingError);
  return { error: error as FlowRecordingError, takes };
}

describe("targeted flow retries", () => {
  it("stops a deterministic locator failure after one take without publishing artifacts", async () => {
    mocks.resolve.mockRejectedValue(new LocatorResolutionError("locator.not-found", "model"));
    const { error, takes } = await failure();
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(error.takes).toMatchObject([{ attempt: 1, status: "failed", stepId: "model", kind: "locator", retryable: false }]);
    expect(takes).toEqual(error.takes);
    expect(await readdir(directory)).toEqual([]);
  });

  it("stops an exhausted action failure after one take and redacts the returned reason", async () => {
    mocks.run.mockRejectedValue(new Error("Target private-demo-key not actionable"));
    const { error } = await failure({ hygiene: { secretValues: ["private-demo-key"] } });
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(error.takes[0]).toMatchObject({ kind: "action", retryable: false, stepId: "model" });
    expect(JSON.stringify(error.takes)).not.toContain("private-demo-key");
    expect(await readdir(directory)).toEqual([]);
  });

  it("does not replay unchanged mutating steps after outcome polling is exhausted", async () => {
    const { error } = await failure();
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(error.takes[0]).toMatchObject({ kind: "outcome", retryable: false });
    expect(await readdir(directory)).toEqual([]);
  });

  it("allows bounded repair retakes only with explicit healing enabled", async () => {
    const { error } = await failure({ locate: { heal: true } });
    expect(mocks.live).toHaveBeenCalledTimes(3);
    expect(error.takes).toHaveLength(3);
    expect(error.takes.every((t) => t.retryable && t.kind === "outcome")).toBe(true);
    expect(mocks.resolve.mock.calls[1]?.[2]?.repair).toBeDefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it("continues bounded capture retries and forwards the failed step and lifecycle evidence", async () => {
    const stall = checkStalls([0], [{ startMs: 0, endMs: 1000 }], 1000);
    const navigation = [{ startMs: 0, endMs: 800, kind: "navigation-wait" as const, startEvidence: "main-document-request" as const, endEvidence: "main-frame-commit" as const, stepId: "model" }];
    mocks.live.mockRejectedValue(new LiveStallError([{ attempt: 1, stall, navigation, diagnostics: [{ startMs: 0, endMs: 1000, kind: "capture-stall", stepId: "model", retryable: true, reason: "Measured motion lost frames" }] }]));
    const { error } = await failure();
    expect(mocks.live).toHaveBeenCalledTimes(3);
    expect(error.takes).toHaveLength(3);
    expect(error.takes[0]).toMatchObject({ kind: "capture-stall", retryable: true, stepId: "model", navigation });
    expect(error.takes[0]?.diagnostics?.[0]?.kind).toBe("capture-stall");
    expect(await readdir(directory)).toEqual([]);
  });

  it("preserves cancellation without retrying or publishing a diagnostic artifact", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled");
    mocks.run.mockImplementation(() => { controller.abort(cancelled); throw cancelled; });
    await expect(recordFlow(flow, { outputPath: join(directory, "take.mp4"), signal: controller.signal })).rejects.toBe(cancelled);
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toEqual([]);
  });
});
