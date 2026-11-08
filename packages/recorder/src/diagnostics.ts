import type { Frame, Page, Request } from "playwright-core";
import { STALL, motionFrameGaps, type MotionWindow, type StallReport } from "./timing.ts";

/** Numeric lifecycle evidence only: never retain URLs, headers, website text or typed values. */
export interface NavigationInterval extends MotionWindow {
  kind: "navigation-wait" | "loading-wait";
  stepId?: string;
  startEvidence: "main-document-request" | "main-frame-commit";
  endEvidence:
    | "main-frame-commit" | "domcontentloaded" | "request-failed"
    | "superseded" | "capture-ended";
}
export interface CaptureDiagnostic extends MotionWindow {
  kind: "capture-stall" | "navigation-wait" | "loading-wait";
  stepId?: string;
  reason: string;
  retryable: boolean;
}

/** Observe actual main-document lifecycle, not subresource traffic or inferred URL changes. */
export function trackNavigation(
  page: Page,
  now: () => number,
  step: () => string | undefined = () => undefined,
  observeRequests = true,
) {
  const intervals: NavigationInterval[] = [];
  let active: {
    request?: Request;
    interval: Omit<NavigationInterval, "endMs" | "endEvidence">;
  } | undefined;
  const close = (endEvidence: NavigationInterval["endEvidence"]) => {
    if (!active) return;
    intervals.push({ ...active.interval, endMs: now(), endEvidence });
    active = undefined;
  };
  const begin = (request: Request) => {
    try {
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    } catch {
      // A detached frame/service worker supplies no safe main-frame evidence.
      return;
    }
    close("superseded");
    active = {
      request,
      interval: {
        startMs: now(), kind: "navigation-wait",
        startEvidence: "main-document-request", stepId: step(),
      },
    };
  };
  const committed = (frame: Frame) => {
    if (frame !== page.mainFrame() || !active || active.interval.kind !== "navigation-wait") return;
    const stepId = active.interval.stepId;
    close("main-frame-commit");
    active = {
      interval: {
        startMs: now(), kind: "loading-wait",
        startEvidence: "main-frame-commit", stepId,
      },
    };
  };
  const loaded = () => {
    if (active?.interval.kind === "loading-wait") close("domcontentloaded");
  };
  const failed = (request: Request) => {
    if (active?.request === request) close("request-failed");
  };
  // No lifecycle-capable Page means no evidence, never inferred exemptions.
  if (observeRequests) page.on?.("request", begin);
  page.on?.("framenavigated", committed);
  page.on?.("domcontentloaded", loaded);
  if (observeRequests) page.on?.("requestfailed", failed);
  return {
    // Settle already owns request listeners; forward them rather than subscribing twice.
    requestStarted: begin,
    requestFailed: failed,
    get pending() { return active !== undefined; },
    snapshot(at = now()): NavigationInterval[] {
      const captured: NavigationInterval[] = [
        ...intervals,
        ...(active ? [{ ...active.interval, endMs: at, endEvidence: "capture-ended" as const }] : []),
      ];
      return captured.map((item) => ({
        ...item,
        endMs: Math.min(at, item.endMs),
        ...(item.endMs > at ? { endEvidence: "capture-ended" as const } : {}),
      })).filter((item) => item.endMs >= item.startMs);
    },
    dispose() {
      if (observeRequests) page.off?.("request", begin);
      page.off?.("framenavigated", committed);
      page.off?.("domcontentloaded", loaded);
      if (observeRequests) page.off?.("requestfailed", failed);
    },
  };
}

/** Explain gaps without changing the strict stall decision or subtracting navigation from motion. */
export function diagnoseCapture(
  frameTimesMs: number[],
  motion: MotionWindow[],
  durationMs: number,
  stall: StallReport,
  navigation: NavigationInterval[],
  steps: (MotionWindow & { stepId: string })[] = [],
): CaptureDiagnostic[] {
  const times = [...new Set([
    0, ...frameTimesMs.filter((t) => t > 0 && t < durationMs), durationMs,
  ])].sort((a, b) => a - b);
  const diagnostics: CaptureDiagnostic[] = [];
  const overlap = (a: MotionWindow, b: MotionWindow) =>
    Math.max(a.startMs, b.startMs) < Math.min(a.endMs, b.endMs);
  if (stall.status === "failed") {
    // Use the checker's exact merged boundaries, including a totally missing capture.
    const gaps = motionFrameGaps(frameTimesMs, motion, durationMs).gaps
      .sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs));
    const worst = gaps[0] ?? { startMs: 0, endMs: durationMs };
    diagnostics.push({
      ...worst,
      kind: "capture-stall",
      stepId: steps.find((s) => overlap(s, worst))?.stepId,
      retryable: true,
      reason: `Measured motion failed capture cadence: longest gap ${Math.round(stall.maxGapMs)} ms, p95 ${Math.round(stall.p95GapMs)} ms (limits ${STALL.maxGapMs}/${STALL.p95GapMs} ms). Retry capture; inspect compositor/capture pressure if repeated. Navigation does not exempt measured motion.`,
    });
  }
  for (let i = 1; i < times.length; i++) {
    const gap = { startMs: times[i - 1]!, endMs: times[i]! };
    if (gap.endMs - gap.startMs <= STALL.maxGapMs || motion.some((m) => overlap(m, gap))) continue;
    const evidence = navigation.find((n) => n.startMs <= gap.startMs && n.endMs >= gap.endMs);
    // Partial overlap does not prove a whole gap was a navigation/loading wait.
    if (!evidence) continue;
    diagnostics.push({
      ...gap,
      kind: evidence.kind,
      stepId: evidence.stepId,
      retryable: false,
      reason: `Frame gap outside measured motion during observed ${evidence.startEvidence} → ${evidence.endEvidence}; retain lifecycle interval for loading-wait editing, not a capture retake.`,
    });
  }
  return diagnostics;
}
