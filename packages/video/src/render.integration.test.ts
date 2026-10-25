import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Edl, Timeline, jobPaths } from "@agentcast/shared";
import { FIXTURE_JOB_DIR, readArtifact } from "@agentcast/shared/node";
import { renderVideo } from "./render";

it.skipIf(process.env.AGENTCAST_RENDER_TESTS !== "1").each(["hyperframes", "remotion"])(
  "renders actual fixture footage into an H.264 video through %s",
  async (renderer) => {
    process.env.AGENTCAST_RENDERER = renderer;
    const root = await mkdtemp(join(tmpdir(), "agentcast-render-integration-"));
    try {
      await cp(FIXTURE_JOB_DIR, root, { recursive: true });
      const edl = await readArtifact(join(root, jobPaths.edl), Edl);
      const timeline = await readArtifact(
        join(root, jobPaths.timeline("desktop")),
        Timeline,
      );
      const shot = edl.segments.find((segment) => segment.kind === "shot")!;
      edl.segments = [
        {
          ...shot,
          in: 0,
          out: 2,
          ramps: [],
          camera: [],
          callouts: [],
          lowerThirds: [],
          transitionIn: "cut",
        },
      ];
      edl.intro.seconds = 1;
      edl.outro.seconds = 1;
      edl.style.sfx = "none";
      edl.style.fonts = { display: "League Spartan", text: "Figtree" };
      const out = join(root, "rendered.mp4");
      const rendered = await renderVideo({
        root,
        out,
        concurrency: 2,
        signal: AbortSignal.timeout(120000),
        input: {
          edl,
          aspect: "16x9",
          lang: "en",
          footage: { src: jobPaths.recording("desktop"), timeline },
          narration: [],
          captions: [],
          copy: { title: "Render fixture", cta: "Explore" },
          brand: { name: "Render fixture", site: "fixture.example" },
          height: 540,
        },
      });
      expect(rendered.frames).toBeGreaterThan(60);
      expect((await stat(out)).size).toBeGreaterThan(1000);
    } finally {
      delete process.env.AGENTCAST_RENDERER;
      await rm(root, { recursive: true, force: true });
    }
  },
  130000,
);
