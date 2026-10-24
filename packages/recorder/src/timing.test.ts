import { describe, expect, it } from "vitest";
import {
  alignFrames,
  buildCfrPlan,
  checkStalls,
  type CapturedFrame,
} from "./timing.ts";

function frame(index: number, timestampMs: number): CapturedFrame {
  return {
    file: `frame-${String(index).padStart(8, "0")}.jpg`,
    timestampMs,
    receivedAtMs: timestampMs + 20,
  };
}

describe("screencast timing", () => {
  it("maps epoch-based CDP milliseconds onto a local monotonic scene clock", () => {
    const frames = [
      { ...frame(0, 1_800_000_000_000), receivedAtMs: 100 },
      { ...frame(1, 1_800_000_000_020), receivedAtMs: 120 },
      { ...frame(2, 1_800_000_000_040), receivedAtMs: 145 },
    ];
    expect(alignFrames(frames, 100).map((item) => item.sceneMs)).toEqual([
      0, 20, 40,
    ]);
  });

  it("preserves real gaps rather than assigning every input JPEG one output frame", () => {
    const plan = buildCfrPlan(
      [frame(0, 1000), frame(1, 1100), frame(2, 1500)],
      1020,
      1000,
    );
    expect(plan.frameCount).toBe(30);
    expect(plan.duration).toBe(1);
    expect(plan.manifest).toContain("duration 0.100000000");
    expect(plan.manifest).toContain("duration 0.400000000");
    expect(plan.manifest).toContain("duration 0.500000000");
    expect(plan.manifest.match(/file /g)).toHaveLength(4);
    expect(plan.manifest).toContain("option framerate 1000");
  });

  it("holds a single static frame for the entire clip, including the final fractional frame", () => {
    const plan = buildCfrPlan([frame(0, 1000)], 1020, 1010);
    expect(plan.frameCount).toBe(31);
    expect(plan.duration).toBeCloseTo(31 / 30);
    expect(plan.manifest).toContain("duration 1.033333333");
  });

  it("chooses the last pre-roll frame and removes post-stop frames", () => {
    const plan = buildCfrPlan(
      [frame(0, 1000), frame(1, 1100), frame(2, 2000)],
      1170,
      500,
    );
    expect(plan.manifest).not.toContain("frame-00000000");
    expect(plan.manifest).not.toContain("frame-00000002");
    expect(plan.manifest).toContain("frame-00000001");
  });

  it("rejects reversed clocks, missing frames and unsafe filenames", () => {
    expect(() => buildCfrPlan([], 0, 100)).toThrow();
    expect(() => buildCfrPlan([frame(0, 2), frame(1, 1)], 0, 100)).toThrow(
      "increase",
    );
    expect(() =>
      buildCfrPlan([{ ...frame(0, 1), file: "../escape.jpg" }], 0, 100),
    ).toThrow("Invalid");
  });
});

describe("Live stall check", () => {
  it("does not fail a static page that produces one frame", () => {
    expect(checkStalls([0], [], 5000).status).toBe("not-applicable");
  });

  it("accepts smooth motion and ignores long static holds between windows", () => {
    const times = [
      ...Array.from({ length: 31 }, (_, i) => (i * 1000) / 60),
      ...Array.from({ length: 31 }, (_, i) => 3000 + (i * 1000) / 60),
    ];
    const report = checkStalls(
      times,
      [
        { startMs: 0, endMs: 500 },
        { startMs: 3000, endMs: 3500 },
      ],
      4000,
    );
    expect(report.status).toBe("passed");
    expect(report.motionDurationMs).toBe(1000);
    expect(report.p95GapMs).toBeLessThan(17);
    expect(report.effectiveFps).toBeGreaterThan(30);
  });

  it("fails a gap over 250 ms even when the p95 is small", () => {
    const times = Array.from({ length: 400 }, (_, i) => i * 16).filter(
      (time) => time < 1000 || time > 1300,
    );
    const report = checkStalls(times, [{ startMs: 0, endMs: 6400 }], 6400);
    expect(report.maxGapMs).toBeGreaterThan(250);
    expect(report.p95GapMs).toBeLessThan(60);
    expect(report.status).toBe("failed");
  });

  it("fails uneven motion whose p95 exceeds 60 ms without a 250 ms gap", () => {
    const report = checkStalls(
      [0, 80, 160, 240, 320, 400, 480],
      [{ startMs: 0, endMs: 500 }],
      500,
    );
    expect(report.maxGapMs).toBe(80);
    expect(report.status).toBe("failed");
  });

  it("detects missing leading, trailing and entire motion captures", () => {
    const windows = [{ startMs: 0, endMs: 1000 }];
    for (const times of [[0, 16, 32], [900, 916, 932], []])
      expect(checkStalls(times, windows, 1000).status).toBe("failed");
  });

  it("merges nested windows instead of counting their frames twice", () => {
    const report = checkStalls(
      [0, 50, 100, 150, 200],
      [
        { startMs: 0, endMs: 200 },
        { startMs: 50, endMs: 150 },
      ],
      200,
    );
    expect(report.motionDurationMs).toBe(200);
    expect(report.status).toBe("passed");
  });
});
