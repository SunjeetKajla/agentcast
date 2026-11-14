import { describe, expect, it } from "vitest";
import { readArtifact, FIXTURE_JOB_DIR } from "@agentcast/shared/node";
import {
  FlowsFile,
  Timeline,
  EvidenceFile,
  AssetPath,
} from "@agentcast/shared";
import { join } from "node:path";
import { evidenceOf } from "./evidence";
import { groundedFallback } from "./grounding";
import { Storyboard } from "@agentcast/shared";

describe("local film evidence", () => {
  it("does not promote guided tours or an agent's narrative into observed completed work", async () => {
    const { flows } = await readArtifact(
      join(FIXTURE_JOB_DIR, "explore/flows.json"),
      FlowsFile,
    );
    const timeline = await readArtifact(
      join(FIXTURE_JOB_DIR, "record/desktop/timeline.json"),
      Timeline,
    );
    const evidence = evidenceOf({
      inputHash: "test",
      flows: flows.map((f) => ({
        ...f,
        source: "tour",
        whyItMatters: "Automatically completes all work",
      })),
      timeline,
      outputs: [],
    });
    expect(evidence.approach).toBe("showcase");
    expect(evidence.moments.length).toBeGreaterThan(0);
    expect(JSON.stringify(evidence)).not.toContain(
      "Automatically completes all work",
    );
    expect(evidence.limitations.join()).toContain("Do not claim");
    const board = await readArtifact(
      join(FIXTURE_JOB_DIR, "script/storyboard.json"),
      Storyboard,
    );
    const grounded = groundedFallback(board, evidence);
    expect(
      grounded.beats
        .filter((b) => b.flowId)
        .every((b) => b.intent.includes("no completed workflow")),
    ).toBe(true);
    expect(grounded.beats.map((b) => [b.in, b.out])).toEqual(
      board.beats.map((b) => [b.in, b.out]),
    );
    expect(EvidenceFile.parse(evidence)).toEqual(evidence);
  });
  it("rejects traversal and provider URLs as asset references", () => {
    for (const file of [
      "../secret",
      "record/../../secret",
      "/tmp/out.mp3",
      "https://provider/file?token=abc",
    ])
      expect(AssetPath.safeParse(file).success).toBe(false);
    expect(AssetPath.parse("record/output/f1-01.mp3")).toBe(
      "record/output/f1-01.mp3",
    );
  });
});
