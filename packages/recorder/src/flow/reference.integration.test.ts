// Behavioral ports of ../AgentCast/packages/recorder/src/{flow,drive}.test.ts.
// The current API records a verified take directly instead of compiling a SceneDriver scene.
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Flow, ReplayPlan, Timeline, type Step } from "@agentcast/shared";
import { readArtifact } from "@agentcast/shared/node";
import { runMediaCommand } from "../encode.ts";
import { createActuator } from "./act.ts";
import { recordFlow, FlowRecordingError } from "./compile.ts";
import { resolveTarget } from "./locate.ts";
import { snapshotOutcome, verifyOutcome } from "./outcome.ts";
import { parseLocator, serializeLocator } from "./semantic.ts";
import { miniBoardFlow, startMiniBoard } from "./test/miniboard.ts";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const available = await access(
  executablePath ?? chromium.executablePath(),
).then(
  () => true,
  () => false,
);
const media = await Promise.all(
  ["ffmpeg", "ffprobe"].map((tool) =>
    runMediaCommand(tool, ["-version"]).then(
      () => true,
      () => false,
    ),
  ),
);
const lookup = { settle: false, timeoutMs: 350, pollIntervalMs: 20 };
let browser: Browser, context: BrowserContext, page: Page;

describe.skipIf(!available)(
  "reference flow/driver compatibility in Chromium",
  () => {
    beforeAll(async () => {
      browser = await chromium.launch({
        executablePath,
        channel: executablePath ? undefined : "chromium",
        headless: true,
      });
    });
    afterAll(async () => {
      await browser?.close();
    });
    beforeEach(async () => {
      context = await browser.newContext({
        viewport: { width: 800, height: 600 },
      });
      page = await context.newPage();
    });
    afterEach(async () => {
      await context?.close();
    });

    it("notices added identical unnamed list items and custom checkbox state changes", async () => {
      await page.setContent(
        '<ul><li style="height:20px"><div role="checkbox" aria-checked="false" style="width:20px;height:20px"></div></li></ul>',
      );
      const step: Step = { id: "change", action: "press" },
        before = await snapshotOutcome(page);
      await page.evaluate(() =>
        document
          .querySelector("ul")!
          .insertAdjacentHTML(
            "beforeend",
            document.querySelector("li")!.outerHTML,
          ),
      );
      expect(
        (await verifyOutcome(page, step, before, { timeoutMs: 300 })).learned,
      ).toContainEqual({ type: "changed" });
      const unchanged = await snapshotOutcome(page);
      await page.evaluate(() =>
        document
          .querySelector('[role="checkbox"]')!
          .setAttribute("aria-checked", "true"),
      );
      await verifyOutcome(page, step, unchanged, { timeoutMs: 300 });
      await expect(
        verifyOutcome(page, step, await snapshotOutcome(page), {
          timeoutMs: 150,
        }),
      ).rejects.toThrow("meaningful page change");
    });
    it("resolves an unnamed role by nearby text and round-trips its safe cache grammar", async () => {
      await page.setContent(
        '<label><input type="checkbox">Buy milk</label><label style="display:block;margin-top:150px"><input id="correct" type="checkbox">Plan launch</label>',
      );
      const result = await resolveTarget(
        page,
        {
          id: "toggle",
          action: "click",
          target: { role: "checkbox", near: "Plan launch" },
        },
        lookup,
      );
      expect(await result.locator.getAttribute("id")).toBe("correct");
      expect(result.strategy).toBe("role");
      expect(parseLocator(result.entry!.locator)).toEqual({
        kind: "role",
        role: "checkbox",
        name: "",
      });
      expect(serializeLocator(parseLocator(result.entry!.locator)!)).toBe(
        result.entry!.locator,
      );
      await expect(
        resolveTarget(
          page,
          { id: "toggle", action: "click", target: { role: "checkbox" } },
          lookup,
        ),
      ).rejects.toMatchObject({ code: "locator.ambiguous" });
    });
    it("clicks the visible duplicate but scrolls to the next one below it", async () => {
      await page.setContent(
        '<base href="https://demo.test"><main><a id="top" href="/blocks">Explore blocks</a><div style="height:3000px"></div><a id="below" href="/blocks">Explore blocks</a></main>',
      );
      for (const [action, id] of [
        ["click", "top"],
        ["scroll", "below"],
      ] as const) {
        const result = await resolveTarget(
          page,
          {
            id: action,
            action,
            target: { text: "Explore blocks", role: "link" },
          },
          lookup,
        );
        expect(await result.locator.getAttribute("id")).toBe(id);
      }
    });
    it("treats missing nearby text as optional, retaining safe link disambiguation", async () => {
      await page.setContent(
        '<base href="https://demo.test"><nav><a href="/button">Button</a></nav><main><a id="correct" href="/button">Button</a></main>',
      );
      const step: Step = {
        id: "button",
        action: "click",
        target: {
          role: "link",
          text: "Button",
          near: "A section the agent imagined",
        },
      };
      const result = await resolveTarget(page, step, lookup);
      expect(await result.locator.getAttribute("id")).toBe("correct");
      await page.setContent(
        '<base href="https://demo.test"><nav><a href="/one">Button</a></nav><main><a href="/two">Button</a></main>',
      );
      await expect(resolveTarget(page, step, lookup)).rejects.toMatchObject({
        code: "locator.ambiguous",
      });
    });
    it("aims at the visible part of a nested scroll container and dispatches native key chords", async () => {
      await page.setContent(
        '<div id="scroller" style="height:100px;overflow:auto"><div style="height:1000px"></div><button id="target" onclick="this.textContent=\'Clicked\'">Target</button></div>',
      );
      const now = () => performance.now(),
        actuator = createActuator(page, {
          signal: new AbortController().signal,
          now,
          motion: async (run) => run(),
        });
      const step: Step = {
        id: "nested",
        action: "click",
        target: { role: "button", text: "Target" },
      };
      const target = await resolveTarget(page, step, lookup);
      const action = await actuator.run(step, target);
      expect(await page.locator("#target").textContent()).toBe("Clicked");
      expect(action.bbox![1]).toBeLessThan(110);
      expect(action.cursor!.to[1]).toBeLessThan(110);
      expect(action.cursor!.t1).toBeLessThanOrEqual(action.at);
      await page.evaluate(() =>
        document.addEventListener("keydown", (event) => {
          if (event.ctrlKey && event.key === "k") {
            event.preventDefault();
            document.querySelector("#target")!.textContent = "Shortcut";
          }
        }),
      );
      await actuator.run({
        id: "shortcut",
        action: "press",
        value: "Control+k",
      });
      expect(await page.locator("#target").textContent()).toBe("Shortcut");
    });
    it("counts scrolling a nested container as a meaningful outcome", async () => {
      await page.setContent(
        '<div id="scroller" style="height:100px;overflow:auto"><div style="height:1000px"></div><button id="target">Target</button></div>',
      );
      const step: Step = {
        id: "nested",
        action: "scroll",
        target: { role: "button", text: "Target" },
      };
      const before = await snapshotOutcome(page),
        target = await resolveTarget(page, step, lookup);
      const actuator = createActuator(page, {
        signal: new AbortController().signal,
        now: () => performance.now(),
        motion: async (run) => run(),
      });
      const action = await actuator.run(step, target);
      expect(action.bbox![1]).toBeLessThan(110);
      expect(
        await page
          .locator("#scroller")
          .evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
      await verifyOutcome(page, step, before, { timeoutMs: 300 });
    });
  },
);

describe.skipIf(!available || media.includes(false))(
  "reference MiniBoard flows through the current Live API",
  () => {
    let app: Awaited<ReturnType<typeof startMiniBoard>>, directory: string;
    beforeAll(async () => {
      app = await startMiniBoard();
    });
    afterAll(async () => {
      await app?.close();
    });
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "agentcast's-reference-flow-"));
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    const options = () => ({
      outputPath: join(directory, "recording.mp4"),
      maxTakes: 1,
      browser: {
        gpu: "cpu" as const,
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 1,
        launchOptions: executablePath ? { executablePath } : undefined,
      },
      encoding: { encoder: "libx264" as const },
      outcomeTimeoutMs: 1000,
    });
    it("resolves all four steps, learns outcomes and emits a valid paced timeline", async () => {
      const result = await recordFlow(
        Flow.parse(miniBoardFlow(app.url)),
        options(),
      );
      const plan = (
        await readArtifact(join(directory, "replay-plan.json"), ReplayPlan)
      ).byFormFactor.desktop!;
      expect(
        ["s1", "s2", "s3", "s4"].map(
          (id) => plan[`create-project/${id}`]!.strategy,
        ),
      ).toEqual(["role", "text", "label", "role"]);
      expect(plan["create-project/s1"]!.learnedExpect).toContainEqual({
        type: "element",
        role: "dialog",
        name: "Choose a template",
      });
      expect(plan["create-project/s3"]!.learnedExpect).toContainEqual({
        type: "value",
        target: "Project name",
        value: "Q4 Launch",
      });
      expect(plan["create-project/s4"]!.learnedExpect).toContainEqual({
        type: "url",
        pattern: "/projects/*",
      });
      expect(
        result.timeline.events.map((event) => `${event.stepId}:${event.kind}`),
      ).toEqual([
        "s1:click",
        "s1:settled",
        "s2:click",
        "s2:settled",
        "s3:type",
        "s3:settled",
        "s4:click",
        "s4:settled",
      ]);
      expect(
        result.timeline.events.every(
          (event, i, events) => !i || event.t >= events[i - 1]!.t,
        ),
      ).toBe(true);
      for (const event of result.timeline.events)
        if (event.cursor) expect(event.cursor.t1).toBeLessThanOrEqual(event.t);
      expect(
        await readArtifact(join(directory, "timeline.json"), Timeline),
      ).toEqual(result.timeline);
    }, 30000);
    it("learns the new heading and route without declared expectations, then replays cached learning", async () => {
      const raw = miniBoardFlow(app.url);
      delete (raw.steps[3] as { expect?: unknown }).expect;
      const flow = Flow.parse(raw),
        first = await recordFlow(flow, options());
      const before = await readArtifact(
        join(directory, "replay-plan.json"),
        ReplayPlan,
      );
      expect(
        before.byFormFactor.desktop!["create-project/s4"]!.learnedExpect,
      ).toContainEqual({ type: "url", pattern: "/projects/*" });
      expect(
        before.byFormFactor.desktop!["create-project/s4"]!.learnedExpect,
      ).toContainEqual({ type: "element", role: "heading", name: "Q4 Launch" });
      const again = await recordFlow(flow, {
        ...options(),
        outputPath: join(directory, "second.mp4"),
        timelinePath: join(directory, "second.timeline.json"),
      });
      expect(again.flowTakes).toEqual([{ attempt: 1, status: "ok" }]);
      const after = await readArtifact(
        join(directory, "replay-plan.json"),
        ReplayPlan,
      );
      for (const key of Object.keys(before.byFormFactor.desktop!))
        expect(after.byFormFactor.desktop![key]!.locator).toEqual(
          before.byFormFactor.desktop![key]!.locator,
        );
      expect(again.timeline.events.map((event) => event.kind)).toEqual(
        first.timeline.events.map((event) => event.kind),
      );
    }, 40000);
    it("catches the wrong Create outcome and discards learning from all preceding successful steps", async () => {
      const err = await recordFlow(
        Flow.parse(miniBoardFlow(app.url + "?broken=1")),
        { ...options(), outcomeTimeoutMs: 300 },
      ).catch((error: unknown) => error);
      expect(err).toBeInstanceOf(FlowRecordingError);
      expect((err as FlowRecordingError).takes[0]).toMatchObject({
        stepId: "s4",
        status: "failed",
      });
      expect((err as Error).message).toMatch(
        /expected URL.*projects.*Upgrade to Pro/,
      );
      expect(await readdir(directory)).toEqual([]);
    }, 30000);
    it("heals a missing initial control once and stores an llm locator", async () => {
      const raw = miniBoardFlow(app.url);
      raw.steps[0]!.target = { text: "Start a fresh project", role: "button" };
      const llm = {
        json: vi
          .fn()
          .mockResolvedValue({ role: "button", name: "New project" }),
      };
      await recordFlow(Flow.parse(raw), {
        ...options(),
        locate: { heal: true, llm, timeoutMs: 500, settle: false },
      });
      expect(llm.json).toHaveBeenCalledTimes(1);
      expect(llm.json.mock.calls[0]![0].prompt).toContain("New project");
      const plan = await readArtifact(
        join(directory, "replay-plan.json"),
        ReplayPlan,
      );
      expect(plan.byFormFactor.desktop!["create-project/s1"]!.strategy).toBe(
        "llm",
      );
    }, 30000);
    it("waits for a delayed first control before starting the capture clock", async () => {
      const raw = miniBoardFlow(app.url + "?delayed=1");
      raw.steps = raw.steps.slice(0, 1);
      const result = await recordFlow(Flow.parse(raw), options());
      expect(result.timeline.events[0]!.cursor!.t0).toBeLessThan(0.3);
      expect(result.sourceDurationMs).toBeLessThan(2000);
    }, 30000);
    it("shares the three-take limit when the initial target fails before capture", async () => {
      const raw = miniBoardFlow(app.url);
      raw.steps = [
        {
          id: "missing",
          action: "click",
          target: { role: "button", text: "Missing initial target" },
        },
      ];
      const prepare = vi.fn(async ({ page }: { page: Page }) => {
        await page.goto(app.url);
      });
      const error = await recordFlow(Flow.parse(raw), {
        ...options(),
        maxTakes: 3,
        prepare,
        locate: { timeoutMs: 150, settle: false },
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(FlowRecordingError);
      expect((error as FlowRecordingError).takes).toHaveLength(3);
      expect(prepare).toHaveBeenCalledTimes(3);
      expect(
        (error as FlowRecordingError).takes.every(
          (take) => take.stepId === "missing",
        ),
      ).toBe(true);
      expect(await readdir(directory)).toEqual([]);
    }, 30000);
    it("cancels during pre-capture hydration lookup without retries or artifacts", async () => {
      const raw = miniBoardFlow(app.url + "?delayed=1");
      raw.steps = raw.steps.slice(0, 1);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const prepare = vi.fn(async ({ page }: { page: Page }) => {
        await page.goto(raw.startUrl);
        timer = setTimeout(
          () => controller.abort(new Error("cancelled before capture")),
          800,
        );
      });
      try {
        await expect(
          recordFlow(Flow.parse(raw), {
            ...options(),
            maxTakes: 3,
            signal: controller.signal,
            prepare,
          }),
        ).rejects.toThrow("cancelled before capture");
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(await readdir(directory)).toEqual([]);
      } finally {
        clearTimeout(timer);
      }
    }, 30000);
    it("encodes relative output paths with spaces and apostrophes", async () => {
      const raw = miniBoardFlow(app.url);
      raw.steps = raw.steps.slice(0, 1);
      const path = join(directory, "clip's video.mp4");
      const result = await recordFlow(Flow.parse(raw), {
        ...options(),
        outputPath: relative(process.cwd(), path),
      });
      expect(result.path).toBe(path);
      expect((await readFile(path)).subarray(4, 8).toString()).toBe("ftyp");
      expect(result.frameCount).toBeGreaterThan(10);
    }, 30000);
  },
);
