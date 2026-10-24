import { EventEmitter } from "node:events";
import type { Page } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ writeFile: mocks.writeFile }));
import { startScreencast } from "./screencast.ts";

function setup(initial = true) {
  const cdp = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  });
  const page = Object.assign(new EventEmitter(), {
    context: () => ({ newCDPSession: async () => cdp }),
  });
  const emit = (timestamp = 1000, data = "/9j/2Q==") =>
    cdp.emit("Page.screencastFrame", {
      data,
      metadata: { timestamp },
      sessionId: 7,
    });
  cdp.send.mockImplementation(async (method) => {
    if (initial && method === "Page.startScreencast") emit();
  });
  return { cdp, page: page as unknown as Page, emit };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.writeFile.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("CDP screencast", () => {
  it("ACKs promptly while the first disk write is still blocked and drains on stop", async () => {
    let finish!: () => void;
    mocks.writeFile.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { cdp, page, emit } = setup();
    const capture = await startScreencast(page, {
      directory: "/tmp/capture",
      maxWidth: 800,
      maxHeight: 600,
    });
    expect(cdp.send).toHaveBeenCalledWith("Page.screencastFrameAck", {
      sessionId: 7,
    });
    emit(1000.016);
    const stop = capture.stop();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    finish();
    const result = await stop;
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([
      1_000_000, 1_000_016,
    ]);
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    expect(cdp.detach).toHaveBeenCalledOnce();
    expect(capture.stop()).toBe(stop);
    expect(cdp.listenerCount("Page.screencastFrame")).toBe(0);
  });

  it("reports disk failures through the failure channel and stop", async () => {
    const { page } = setup();
    mocks.writeFile.mockRejectedValue(new Error("disk full"));
    const capture = await startScreencast(page, {
      directory: "/tmp/capture",
      maxWidth: 800,
      maxHeight: 600,
    });
    await expect(capture.failure).rejects.toThrow("disk full");
    await expect(capture.stop()).rejects.toThrow("disk full");
  });

  it("fails rather than dropping frames when the bounded queue is full", async () => {
    const { page } = setup();
    await expect(
      startScreencast(page, {
        directory: "/tmp/capture",
        maxWidth: 800,
        maxHeight: 600,
        maxQueueBytes: 1,
      }),
    ).rejects.toThrow("queue");
  });

  it.each([undefined, NaN])(
    "rejects missing CDP timestamps: %s",
    async (timestamp) => {
      const { page, cdp } = setup();
      const capture = await startScreencast(page, {
        directory: "/tmp/capture",
        maxWidth: 800,
        maxHeight: 600,
      });
      cdp.emit("Page.screencastFrame", {
        data: "/9j/2Q==",
        metadata: { timestamp },
        sessionId: 8,
      });
      await expect(capture.failure).rejects.toThrow(/timestamp/);
      await expect(capture.stop()).rejects.toThrow(/timestamp/);
    },
  );

  it("skips a stale frame that arrives after a newer one, and still acknowledges it", async () => {
    const { page, cdp } = setup();
    const capture = await startScreencast(page, {
      directory: "/tmp/capture",
      maxWidth: 800,
      maxHeight: 600,
    });
    cdp.emit("Page.screencastFrame", { data: "/9j/2Q==", metadata: { timestamp: 999 }, sessionId: 8 });
    const result = await capture.stop();
    expect(result.frames.map((f) => f.timestampMs)).toEqual([1_000_000]);
    expect(cdp.send.mock.calls.filter(([method]) => method === "Page.screencastFrameAck")).toHaveLength(2);
  });

  it("ignores duplicate frames but still acknowledges them", async () => {
    const { page, cdp, emit } = setup();
    const capture = await startScreencast(page, {
      directory: "/tmp/capture",
      maxWidth: 800,
      maxHeight: 600,
    });
    emit();
    const result = await capture.stop();
    expect(result.frames).toHaveLength(1);
    expect(
      cdp.send.mock.calls.filter(
        ([method]) => method === "Page.screencastFrameAck",
      ),
    ).toHaveLength(2);
  });

  it("cleans up when the initial frame never arrives", async () => {
    vi.useFakeTimers();
    const { page, cdp } = setup(false);
    const started = startScreencast(page, {
      directory: "/tmp/capture",
      maxWidth: 800,
      maxHeight: 600,
      firstFrameTimeoutMs: 100,
    });
    const assertion = expect(started).rejects.toThrow("No initial");
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(cdp.detach).toHaveBeenCalledOnce();
  });

  it("surfaces page crashes immediately", async () => {
    const { page } = setup();
    const capture = await startScreencast(page, {
      directory: "/tmp/capture",
      maxWidth: 800,
      maxHeight: 600,
    });
    (page as unknown as EventEmitter).emit("crash");
    await expect(capture.failure).rejects.toThrow("crashed");
    await expect(capture.stop()).rejects.toThrow("crashed");
  });

  it("prefers the monotonic CDP clock when available so wall-clock adjustments do not break a take", async () => {
    const { page, cdp } = setup(false);
    cdp.send.mockImplementation(async (method) => {
      if (method === "Page.startScreencast")
        cdp.emit("Page.screencastFrame", {
          data: "/9j/2Q==",
          metadata: { timestamp: 1000, monotonicTimestamp: 100 },
          sessionId: 1,
        });
    });
    const capture = await startScreencast(page, {
      directory: "/tmp/capture",
      maxWidth: 800,
      maxHeight: 600,
    });
    cdp.emit("Page.screencastFrame", {
      data: "/9j/2Q==",
      metadata: { timestamp: 999, monotonicTimestamp: 100.02 },
      sessionId: 1,
    });
    expect(
      (await capture.stop()).frames.map((frame) => frame.timestampMs),
    ).toEqual([100_000, 100_020]);
  });
});
