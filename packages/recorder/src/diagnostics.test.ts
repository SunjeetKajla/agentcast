import { EventEmitter } from "node:events";
import type { Page, Request } from "playwright-core";
import { describe, expect, it } from "vitest";
import { diagnoseCapture, trackNavigation, type NavigationInterval } from "./diagnostics.ts";
import { checkStalls } from "./timing.ts";

function fixture() {
  const page = new EventEmitter() as EventEmitter & { mainFrame(): unknown };
  const frame = {};
  page.mainFrame = () => frame;
  let clock = 0;
  const tracker = trackNavigation(page as unknown as Page, () => clock, () => "choose-model");
  const request = { isNavigationRequest: () => true, frame: () => frame } as Request;
  return { page, frame, request, tracker, at: (t: number) => { clock = t; } };
}

describe("capture lifecycle diagnostics", () => {
  it("records paired main-frame phases without retaining request URLs or page text", () => {
    const f = fixture();
    f.at(100); f.page.emit("request", f.request);
    f.at(900); f.page.emit("framenavigated", f.frame);
    f.at(1200); f.page.emit("domcontentloaded");
    expect(f.tracker.snapshot()).toEqual([
      { kind: "navigation-wait", startMs: 100, endMs: 900, stepId: "choose-model", startEvidence: "main-document-request", endEvidence: "main-frame-commit" },
      { kind: "loading-wait", startMs: 900, endMs: 1200, stepId: "choose-model", startEvidence: "main-frame-commit", endEvidence: "domcontentloaded" },
    ]);
    expect(f.tracker.pending).toBe(false);
    f.tracker.dispose();
    expect(f.page.eventNames()).toEqual([]);
  });

  it("ignores analytics, subframes and same-document navigation without a document request", () => {
    const f = fixture();
    f.page.emit("request", { isNavigationRequest: () => false });
    f.page.emit("request", { isNavigationRequest: () => true, frame: () => ({}) });
    f.page.emit("framenavigated", f.frame);
    f.page.emit("domcontentloaded");
    expect(f.tracker.snapshot()).toEqual([]);
    f.tracker.dispose();
  });

  it("keeps unfinished, failed and superseded requests explicit instead of claiming load completion", () => {
    const f = fixture();
    f.page.emit("request", f.request);
    f.at(400);
    expect(f.tracker.snapshot()[0]?.endEvidence).toBe("capture-ended");
    f.page.emit("request", f.request);
    f.at(900); f.page.emit("requestfailed", f.request);
    expect(f.tracker.snapshot().map((n) => n.endEvidence)).toEqual(["superseded", "request-failed"]);
    expect(f.tracker.pending).toBe(false);
    f.tracker.dispose();
  });

  const navigation: NavigationInterval[] = [{ startMs: 0, endMs: 1000, kind: "navigation-wait", startEvidence: "main-document-request", endEvidence: "main-frame-commit", stepId: "buy" }];
  it("identifies a frame gap during observed navigation outside motion without a pointless retake", () => {
    const stall = checkStalls([0, 1000], [], 1000);
    const [diagnostic] = diagnoseCapture([0, 1000], [], 1000, stall, navigation);
    expect(stall.status).toBe("not-applicable");
    expect(diagnostic).toMatchObject({ kind: "navigation-wait", stepId: "buy", startMs: 0, endMs: 1000, retryable: false });
  });

  it("never excuses a genuine animation stall just because navigation overlapped it", () => {
    const motion = [{ startMs: 0, endMs: 1000 }];
    const frames = [0, 16, 32, 900, 916, 932];
    const stall = checkStalls(frames, motion, 1000);
    const diagnostics = diagnoseCapture(frames, motion, 1000, stall, navigation, [{ ...motion[0]!, stepId: "choose" }]);
    expect(stall.status).toBe("failed");
    expect(stall.maxGapMs).toBe(868);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "capture-stall", startMs: 32, endMs: 900, stepId: "choose", retryable: true });
  });

  it("does not invent navigation evidence for unknown or partially overlapping gaps", () => {
    const stall = checkStalls([0, 2000], [], 2000);
    expect(diagnoseCapture([0, 2000], [], 2000, stall, navigation)).toEqual([]);
    expect(diagnoseCapture([0, 2000], [], 2000, stall, [])).toEqual([]);
  });

  it("reports a p95 failure even when every gap is below the hard maximum", () => {
    const motion = [{ startMs: 0, endMs: 500 }];
    const frames = [0, 80, 160, 240, 320, 400, 480];
    const stall = checkStalls(frames, motion, 500);
    expect(stall.status).toBe("failed");
    expect(diagnoseCapture(frames, motion, 500, stall, [])[0]?.kind).toBe("capture-stall");
  });
});
