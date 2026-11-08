import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ browser: vi.fn(), capture: vi.fn(), encode: vi.fn() }));
vi.mock("./browser.ts", () => ({ withRecorderBrowser: mocks.browser }));
vi.mock("./screencast.ts", () => ({ startScreencast: mocks.capture }));
vi.mock("./encode.ts", () => ({ encodeCfrMp4: mocks.encode }));
import { recordLive, LiveStallError } from "./live.ts";

let directory: string, clock: number;
let page: EventEmitter, frame: object;
let closed = vi.fn<() => void>();
beforeEach(async () => {
  vi.resetAllMocks();
  clock = 0;
  directory = await mkdtemp(join(tmpdir(), "agentcast-live-diagnostics-"));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  closed = vi.fn();
  mocks.browser.mockImplementation(async (_options, run) => {
    frame = {};
    page = Object.assign(new EventEmitter(), { mainFrame: () => frame, viewportSize: () => ({ width: 320, height: 180 }) });
    try { return await run({ page, context: new EventEmitter(), gpu: { backend: "cpu" }, deviceScaleFactor: 1 }); }
    finally { closed(); }
  });
  mocks.capture.mockImplementation(async () => {
    const startedAtMs = clock;
    return { startedAtMs, failure: new Promise(() => {}), stop: async () => ({ durationMs: clock - startedAtMs, startedAtMs, frames: [0, clock - startedAtMs].map((t, i) => ({ file: `frame-${i}.jpg`, timestampMs: t, receivedAtMs: startedAtMs + t })) }) };
  });
  mocks.encode.mockResolvedValue({ duration: 1, frameCount: 30, fps: 30, encoder: "libx264" });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

function navigate() {
  page.emit("request", { isNavigationRequest: () => true, frame: () => frame });
  clock += 1000;
  page.emit("framenavigated", frame);
  page.emit("domcontentloaded");
}

describe("Live diagnostics wiring", () => {
  it("keeps observed non-motion navigation waits on the first take with safe evidence", async () => {
    const result = await recordLive({ outputPath: join(directory, "clip.mp4") }, async (controls) => {
      controls.markStep?.("navigate");
      navigate();
    });
    expect(mocks.browser).toHaveBeenCalledOnce();
    expect(mocks.encode).toHaveBeenCalledOnce();
    expect(result.takes[0]?.diagnostics?.[0]).toMatchObject({ kind: "navigation-wait", stepId: "navigate", retryable: false });
    expect(result.takes[0]?.navigation?.[0]).toMatchObject({ startEvidence: "main-document-request", endEvidence: "main-frame-commit" });
    expect(page.eventNames()).toEqual([]);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("fails overlapping animation gaps at the strict limit, retains step evidence, and never encodes them", async () => {
    const error = await recordLive({ outputPath: join(directory, "clip.mp4") }, async (controls) => {
      controls.markStep?.("animate");
      await controls.motion(async () => navigate());
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveStallError);
    const failure = error as LiveStallError;
    expect(failure.kind).toBe("capture-stall");
    expect(failure.stepId).toBe("animate");
    expect(failure.takes).toHaveLength(3);
    expect(failure.navigation.length).toBeGreaterThan(0);
    expect(failure.diagnostics[0]).toMatchObject({ kind: "capture-stall", startMs: 0, endMs: 1000 });
    expect(mocks.encode).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(3);
    expect(page.eventNames()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });
});
