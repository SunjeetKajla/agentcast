import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { recordFlow } from "./flow/compile";
import { Flow, Timeline } from "@agentcast/shared";
import { readArtifact } from "@agentcast/shared/node";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const available = await access(
  executablePath ?? chromium.executablePath(),
).then(
  () => true,
  () => false,
);
it.skipIf(!available)(
  "records verified action/result states with honest provenance and a playable result hold",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentcast-states-test-"));
    try {
      const flow = Flow.parse({
        id: "create",
        title: "Create a result",
        whyItMatters: "A real local result",
        startUrl: "https://example.com/",
        requiresAuth: false,
        rank: 1,
        selected: true,
        steps: [
          {
            id: "type",
            action: "type",
            target: { label: "Name" },
            value: "Launch",
          },
          {
            id: "create",
            action: "click",
            target: { role: "button", text: "Create" },
            expect: [{ type: "text", text: "Created Launch", match: "exact" }],
          },
        ],
      });
      const recording = await recordFlow(flow, {
        outputPath: join(dir, "states.mp4"),
        captureMode: "states",
        maxTakes: 1,
        encoding: { encoder: "libx264" },
        browser: {
          gpu: "cpu",
          viewport: { width: 640, height: 360 },
          deviceScaleFactor: 1,
          ...(executablePath ? { launchOptions: { executablePath } } : {}),
        },
        prepare: async ({ page }) => {
          await page.setContent(
            "<label>Name<input aria-label=\"Name\"></label><button onclick=\"document.querySelector('h1').textContent='Created '+document.querySelector('input').value\">Create</button><h1></h1>",
          );
        },
      });
      expect(recording.mode).toBe("states");
      expect(recording.stall.status).toBe("not-applicable");
      expect(recording.sourceFrameCount).toBe(4);
      const timeline = await readArtifact(join(dir, "timeline.json"), Timeline);
      expect(timeline.events.filter((e) => e.kind === "settled")).toHaveLength(
        2,
      );
      expect(timeline.duration - timeline.events.at(-1)!.t).toBeGreaterThan(
        0.9,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000,
);

it.skipIf(!available)(
  "keeps late generated audio and associates it with the action which requested it",
  async () => {
    const { createServer } = await import("node:http");
    const { readFile } = await import("node:fs/promises");
    const { runMediaCommand } = await import("./encode");
    const { OutputIndex } = await import("@agentcast/shared");
    const dir = await mkdtemp(join(tmpdir(), "agentcast-late-output-"));
    let server: ReturnType<typeof createServer> | undefined;
    try {
      await runMediaCommand("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.8",
        "-ar",
        "8000",
        "-ac",
        "1",
        join(dir, "voice.wav"),
      ]);
      const audio = (await readFile(join(dir, "voice.wav"))).toString("base64");
      server = createServer((req, res) => {
        if (req.url === "/generate") {
          setTimeout(() => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ data: { audioContent: audio } }));
          }, 2200);
        } else {
          res.setHeader("content-type", "text/html");
          res.end(
            "<h1>Voice demo</h1><button onclick=\"document.querySelector('p').textContent='Generating';fetch('/generate').then(r=>r.json()).then(()=>document.querySelector('p').textContent='Voice ready')\">Generate</button><p>Ready</p>",
          );
        }
      });
      await new Promise<void>((resolve) =>
        server!.listen(0, "127.0.0.1", resolve),
      );
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
      const flow = Flow.parse({
        id: "voice",
        title: "Generate a voice",
        whyItMatters: "Hear a real output",
        startUrl: url,
        requiresAuth: false,
        rank: 1,
        selected: true,
        steps: [
          {
            id: "generate",
            action: "click",
            target: { role: "button", text: "Generate" },
            expect: [{ type: "text", text: "Generating", match: "exact" }],
          },
        ],
      });
      const recording = await recordFlow(flow, {
        outputPath: join(dir, "voice.mp4"),
        captureMode: "states",
        maxTakes: 1,
        outputs: { dir: join(dir, "outputs") },
        encoding: { encoder: "libx264" },
        browser: {
          gpu: "cpu",
          viewport: { width: 640, height: 360 },
          deviceScaleFactor: 1,
          ...(executablePath ? { launchOptions: { executablePath } } : {}),
        },
      });
      const index = await readArtifact(
        join(dir, "outputs/voice.json"),
        OutputIndex,
      );
      expect(index.outputs).toHaveLength(1);
      expect(index.outputs[0]!.stepId).toBe("generate");
      expect(index.outputs[0]!.t).toBeLessThan(recording.duration);
      expect(
        recording.timeline.events.findLast((e) => e.kind === "settled")!.t,
      ).toBeGreaterThanOrEqual(index.outputs[0]!.t);
      expect(
        (await readFile(join(dir, "outputs", index.outputs[0]!.file)))
          .subarray(0, 4)
          .toString(),
      ).toBe("RIFF");
    } finally {
      server?.closeAllConnections();
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000,
);
