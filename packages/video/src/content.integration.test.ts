import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { Storyboard, Timeline } from "@agentcast/shared";
import { shotContent } from "./content.ts";

it("samples inside each flow at a cut and at EOF, rather than reading its neighbour or empty bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-content-"));
  try {
    const file = join(dir, "cuts.mp4");
    await promisify(execFile)("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=144x90:r=30:d=2,drawbox=x=95:y=25:w=40:h=60:color=black:t=fill:enable='lt(t,1)',drawbox=x=5:y=25:w=40:h=60:color=black:t=fill:enable='gte(t,1)'",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      file,
    ]);
    const timeline = Timeline.parse({
      schemaVersion: 2,
      recordingId: "cuts",
      formFactor: "desktop",
      viewport: { w: 1440, h: 900, dpr: 1 },
      fps: 30,
      duration: 2,
      flows: [
        { flowId: "f1", in: 0, out: 1 },
        { flowId: "f2", in: 1, out: 2 },
      ],
      dead: [],
      events: [0, 1].map((i) => ({
        t: i + 0.99,
        flowId: `f${i + 1}`,
        stepId: "s1",
        kind: "settled",
        label: "result",
        url: "https://fixture.test/",
      })),
    });
    const board = Storyboard.parse({
      schemaVersion: 1,
      arc: "launch",
      edit: "trailer",
      beats: [0, 1].map((i) => ({
        id: `b${i + 1}`,
        role: "core",
        flowId: `f${i + 1}`,
        in: i,
        out: i + 1,
        onScreen: [],
        motion: { kind: "hold", emotion: "clear" },
        intent: "Show result",
        maxSeconds: 1,
      })),
    });
    const content = await shotContent(file, board, timeline);
    expect(content.b1!.box[0]).toBeGreaterThan(900);
    expect(content.b2!.box[0]).toBeLessThan(100);
    expect(content.b1!.fill).toBeGreaterThan(0.1);
    expect(content.b2!.fill).toBeGreaterThan(0.1);
    await expect(
      shotContent(
        file,
        { ...board, beats: [{ ...board.beats[0]!, in: 4, out: 5 }] },
        { ...timeline, duration: 5 },
      ),
    ).rejects.toThrow("complete frame");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
