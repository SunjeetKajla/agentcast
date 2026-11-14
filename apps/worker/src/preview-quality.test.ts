import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Edl, JobConfig, Timeline, jobPaths } from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import type { VideoInput } from "@agentcast/video";
import type { StageContext } from "./context";
import { reviewPreview } from "./preview-quality";
import { PipelineRepair } from "./recovery";

it("stops an unchanged automatic repair instead of rewinding indefinitely", async () => {
  vi.stubEnv("AGENTCAST_DIRECTOR", "on");
  const dir = await mkdtemp(join(tmpdir(), "agentcast-preview-quality-"));
  try {
    await cp(FIXTURE_JOB_DIR, dir, { recursive: true });
    await mkdir(join(dir, "out"), { recursive: true });
    await cp(
      join(dir, jobPaths.recording("desktop")),
      join(dir, jobPaths.preview),
    );
    const timeline = await readArtifact(
      join(dir, jobPaths.timeline("desktop")),
      Timeline,
    );
    const edl = await readArtifact(join(dir, jobPaths.edl), Edl);
    edl.intro.seconds = 0;
    edl.segments = [
      {
        id: "result",
        kind: "primitive",
        seconds: 2,
        transitionIn: "cut",
        primitive: {
          type: "proof",
          flowId: timeline.flows[0]!.flowId,
          in: 0,
          out: 2,
          frame: [0, 0, timeline.viewport.w, timeline.viewport.h],
          tilt: "none",
        },
      },
    ];
    const io: Pick<StageContext, "read" | "write" | "path"> = {
      path: (f) => join(dir, f),
      read: (f, s) => readArtifact(join(dir, f), s),
      write: (f, s, d) => writeArtifact(join(dir, f), s, d),
    };
    const ctx = {
      ...io,
      dir,
      config: JobConfig.parse({ url: "https://example.com" }),
      signal: new AbortController().signal,
      artifact: vi.fn(),
      log: vi.fn(),
      llmProgress: vi.fn(),
      llm: {
        json: vi.fn(async () => ({
          issues: [
            {
              sceneId: "result",
              reason: "Subject is clipped at rest",
              repair: "reframe",
            },
          ],
        })),
      },
    } as unknown as StageContext;
    const input = {
      edl,
      narration: [],
      footage: { src: jobPaths.recording("desktop"), timeline },
    } as unknown as VideoInput;
    await expect(reviewPreview(ctx, input)).rejects.toBeInstanceOf(
      PipelineRepair,
    );
    try {
      await reviewPreview(ctx, input);
      throw new Error("Unexpected quality pass");
    } catch (error) {
      expect(error).not.toBeInstanceOf(PipelineRepair);
      expect((error as Error).message).toContain(
        "did not pass after bounded recovery",
      );
    }
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
