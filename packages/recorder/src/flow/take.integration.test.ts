import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { ReplayPlan, type Step } from "@agentcast/shared";
import { readArtifact } from "@agentcast/shared/node";
import { recordLive } from "../live.ts";
import { runMediaCommand } from "../encode.ts";
import { resolveTarget } from "./locate.ts";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const available = await Promise.all([
  access(executablePath ?? chromium.executablePath()).then(
    () => true,
    () => false,
  ),
  ...["ffmpeg", "ffprobe"].map((tool) =>
    runMediaCommand(tool, ["-version"]).then(
      () => true,
      () => false,
    ),
  ),
]);

it.skipIf(available.includes(false))(
  "replays resolved flow steps inside a DPR 2 Live take and persists valid semantic locators",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentcast-flow-take-"));
    const replayPlanPath = join(directory, "replay-plan.json");
    const methods: string[] = [];
    const steps: Step[] = [
      {
        id: "s1",
        action: "click",
        target: { role: "button", text: "New project" },
      },
      {
        id: "s2",
        action: "type",
        target: { label: "Project name" },
        value: "Q4 Launch",
      },
      {
        id: "s3",
        action: "click",
        target: { role: "button", text: "Create project" },
      },
    ];
    try {
      const recording = await recordLive(
        {
          outputPath: join(directory, "recording.mp4"),
          encoding: { encoder: "libx264" },
          browser: {
            gpu: "cpu",
            viewport: { width: 640, height: 360 },
            deviceScaleFactor: 2,
            launchOptions: executablePath ? { executablePath } : undefined,
          },
          prepare: async ({ page }) => {
            await page.setContent(
              '<button id="new">New project</button><section id="form" hidden><label for="name">Project name</label><input id="name"><button id="save">Create project</button></section><h1 id="result"></h1><script>document.getElementById("new").onclick=()=>document.getElementById("form").hidden=false;document.getElementById("save").onclick=()=>document.getElementById("result").textContent=document.getElementById("name").value;</script>',
            );
          },
        },
        async ({ page, signal }) => {
          for (const step of steps) {
            const resolved = await resolveTarget(page, step, {
              replayPlanPath,
              flowId: "create",
              signal,
            });
            methods.push(resolved.method);
            if (step.action === "type")
              await resolved.locator.fill(step.value!);
            else await resolved.locator.click();
          }
          expect(await page.locator("#result").textContent()).toBe("Q4 Launch");
          await delay(150, undefined, { signal });
        },
      );
      expect(methods).toEqual(["role", "label", "role"]);
      expect(recording).toMatchObject({
        mode: "live",
        fps: 30,
        width: 1280,
        height: 720,
      });
      const plan = await readArtifact(replayPlanPath, ReplayPlan);
      expect(Object.keys(plan.byFormFactor.desktop!)).toEqual([
        "create/s1",
        "create/s2",
        "create/s3",
      ]);
      expect((await readdir(directory)).sort()).toEqual([
        "recording.mp4",
        "replay-plan.json",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
