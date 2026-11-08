import { EventEmitter } from "node:events";
import type { Page, Request } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackSettle } from "./settle.ts";

afterEach(() => { vi.useRealTimers(); });
function fixture() {
  const page = new EventEmitter() as EventEmitter & { mainFrame(): unknown; isClosed(): boolean; evaluate: ReturnType<typeof vi.fn> };
  const frame = {};
  page.mainFrame = () => frame;
  page.isClosed = () => false;
  page.evaluate = vi.fn().mockResolvedValue({ signature: "same", moving: false, ready: true });
  const request = { isNavigationRequest: () => true, frame: () => frame, resourceType: () => "document" } as Request;
  const tracker = trackSettle(page as unknown as Page, { timeoutMs: 1000, domQuietMs: 100, networkQuietMs: 200, pollMs: 25, now: () => performance.now() });
  return { page, frame, request, tracker };
}

describe("settle lifecycle evidence", () => {
  it("waits through a pending document request despite an unchanged old DOM", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.page.emit("request", f.request);
    let finished = false;
    const work = f.tracker.wait().then((r) => { finished = true; return r; });
    await vi.advanceTimersByTimeAsync(350);
    expect(finished).toBe(false);
    f.page.emit("framenavigated", f.frame);
    f.page.emit("domcontentloaded");
    f.page.emit("requestfinished", f.request);
    await vi.advanceTimersByTimeAsync(100);
    const report = await work;
    expect(report.reason).toBe("dom-stable");
    expect(report.navigation?.map((n) => n.kind)).toEqual(["navigation-wait", "loading-wait"]);
    expect(report.motion).toEqual([]);
    f.tracker.dispose();
    expect(f.page.eventNames()).toEqual([]);
  });

  it("returns timeout with incomplete evidence instead of treating a hung navigation as success", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.page.emit("request", f.request);
    const work = f.tracker.wait();
    await vi.advanceTimersByTimeAsync(1100);
    const report = await work;
    expect(report.reason).toBe("timeout");
    expect(report.navigation?.[0]?.endEvidence).toBe("capture-ended");
    f.tracker.dispose();
  });

  it("preserves measured animation while navigation is pending", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.page.evaluate.mockResolvedValue({ signature: "same", moving: true, ready: true });
    f.page.emit("request", f.request);
    const work = f.tracker.wait();
    await vi.advanceTimersByTimeAsync(1100);
    const report = await work;
    expect(report.motion.length).toBeGreaterThan(0);
    expect(report.motion.reduce((n, m) => n + m.endMs - m.startMs, 0)).toBeGreaterThan(900);
    expect(report.navigation?.length).toBe(1);
    f.tracker.dispose();
  });
});
