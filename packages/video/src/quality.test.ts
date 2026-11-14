import { expect, it } from "vitest";
import { readArtifact, FIXTURE_JOB_DIR } from "@agentcast/shared/node";
import { Edl, Timeline } from "@agentcast/shared";
import { join } from "node:path";
import { repairTemporalEdl, temporalIssues } from "./quality";
import { stutterWindows } from "./motion-quality";
import { playbackCorrelation } from "./output-quality";

it("repairs the crop through a scrolling interval, keeping other scene design intact", async () => {
  const edl = await readArtifact(join(FIXTURE_JOB_DIR, "render/edl.json"), Edl);
  const timeline = await readArtifact(
    join(FIXTURE_JOB_DIR, "record/desktop/timeline.json"),
    Timeline,
  );
  const flowId = timeline.flows[0]!.flowId;
  timeline.events = [
    {
      t: 1,
      flowId,
      stepId: "scroll",
      kind: "scroll",
      url: "https://example.com",
      label: "scroll",
    },
    {
      t: 4,
      flowId,
      stepId: "scroll",
      kind: "settled",
      url: "https://example.com",
      label: "scroll",
    },
  ];
  edl.segments = [
    {
      id: "moving",
      kind: "primitive",
      seconds: 3,
      transitionIn: "cut",
      primitive: {
        type: "proof",
        flowId,
        in: 1,
        out: 4,
        frame: [400, 100, 500, 400],
        tilt: "strong",
        path: [{ at: 1, frame: [500, 200, 500, 400] }],
        hops: [[420, 200, 50, 30]],
        headline: "Real content",
      },
    },
  ];
  const result = repairTemporalEdl(edl, timeline);
  const p = result.edl.segments[0]!;
  expect(result.issues.map((i) => i.code)).toContain("frame.moving-page");
  expect(p.kind === "primitive" && p.primitive).toMatchObject({
    frame: [0, 0, timeline.viewport.w, timeline.viewport.h],
    tilt: "none",
    headline: "Real content",
  });
  expect(temporalIssues(result.edl, timeline)).toEqual([]);
});
it("distinguishes static holds and smooth motion from a visible stop-and-jump", () => {
  const frame = (v: number) => new Uint8Array(100).fill(v);
  expect(
    stutterWindows(
      Array.from({ length: 30 }, () => frame(40)),
      30,
    ),
  ).toEqual([]);
  expect(
    stutterWindows(
      Array.from({ length: 30 }, (_, i) => frame(40 + i)),
      30,
    ),
  ).toEqual([]);
  expect(
    stutterWindows(
      [...Array.from({ length: 12 }, () => frame(40)), frame(80)],
      30,
    ),
  ).toHaveLength(1);
});
it("requires the product signal in the mix, allowing music and encoder offsets", () => {
  const source = Float32Array.from(
    { length: 8000 },
    (_, i) => Math.sin(i * 0.293) * Math.sin(i * 0.017),
  );
  const mix = Float32Array.from(
    source,
    (v, i) => v * 0.5 + Math.sin(i * 0.487) * 0.3,
  );
  const musicOnly = Float32Array.from(
    source,
    (_, i) => Math.sin(i * 0.487) * 0.3,
  );
  expect(playbackCorrelation(source, mix)).toBeGreaterThan(0.5);
  expect(playbackCorrelation(source, musicOnly)).toBeLessThan(0.12);
  expect(playbackCorrelation(new Float32Array(8000), musicOnly)).toBe(0);
});
