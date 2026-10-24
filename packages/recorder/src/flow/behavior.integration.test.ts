import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
import { ReplayPlan, Timeline, type Flow, type Step } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { runMediaCommand } from "../encode.ts";
import { createActuator } from "./act.ts";
import { recordFlow, FlowRecordingError } from "./compile.ts";
import { installRecordingHygiene, dismissCookieBanner } from "./hygiene.ts";
import { snapshotOutcome, verifyOutcome, OutcomeError } from "./outcome.ts";
import { resolveTarget } from "./locate.ts";
import { waitForSettle, trackSettle } from "./settle.ts";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const available = await access(
  executablePath ?? chromium.executablePath(),
).then(
  () => true,
  () => false,
);
let browser: Browser, context: BrowserContext, page: Page, directory: string;
const signal = () => new AbortController().signal;
const step: Step = {
  id: "create",
  action: "click",
  target: { role: "button", text: "Create project" },
  expect: [{ type: "element", role: "heading", name: "Q4 Launch" }],
};

describe.skipIf(!available)("flow behavior in Chromium", () => {
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
      viewport: { width: 640, height: 360 },
    });
    page = await context.newPage();
    directory = await mkdtemp(join(tmpdir(), "agentcast-behavior-"));
  });
  afterEach(async () => {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("settles after delayed DOM updates and finite animation, with measured motion windows", async () => {
    await page.setContent('<div id="result">Waiting</div>');
    const started = performance.now();
    await page.evaluate(() => {
      document
        .querySelector("div")!
        .animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450 });
      setTimeout(
        () => (document.querySelector("div")!.textContent = "Ready"),
        180,
      );
    });
    const report = await waitForSettle(page, {
      now: () => performance.now() - started,
      timeoutMs: 1500,
    });
    expect(report.reason).toBe("dom-stable");
    expect(report.elapsedMs).toBeGreaterThanOrEqual(430);
    expect(report.elapsedMs).toBeLessThan(1400);
    expect(report.motion.length).toBeGreaterThan(0);
    expect(report.motion.at(-1)!.endMs).toBeLessThan(report.elapsedMs + 100);
  });
  it("caps a never-idle page and removes request listeners on disposal", async () => {
    await page.setContent(
      '<p>Updating</p><script>setInterval(()=>document.querySelector("p").textContent=String(Math.random()),30)</script>',
    );
    const prior = (
        page as unknown as { listenerCount(event: string): number }
      ).listenerCount("request"),
      tracker = trackSettle(page);
    expect(
      (
        page as unknown as { listenerCount(event: string): number }
      ).listenerCount("request"),
    ).toBe(prior + 1);
    const report = await tracker.wait({ timeoutMs: 250 });
    tracker.dispose();
    expect(report.reason).toBe("timeout");
    expect(report.elapsedMs).toBeLessThan(600);
    expect(
      (
        page as unknown as { listenerCount(event: string): number }
      ).listenerCount("request"),
    ).toBe(prior);
  });
  it("honors cancellation during settling", async () => {
    await page.setContent("<p>Ready</p>");
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("cancelled")), 50);
    await expect(
      waitForSettle(page, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });
  it("polls delayed outcomes and learns exact visible headings", async () => {
    await page.setContent("<button>Create project</button><h1 hidden></h1>");
    const before = await snapshotOutcome(page);
    await page.evaluate(() =>
      setTimeout(() => {
        const heading = document.querySelector("h1")!;
        heading.hidden = false;
        heading.textContent = "Q4 Launch";
      }, 150),
    );
    const result = await verifyOutcome(page, step, before, { timeoutMs: 1000 });
    expect(result.learned).toContainEqual({
      type: "element",
      role: "heading",
      name: "Q4 Launch",
    });
  });
  it("rejects an Upgrade modal instead of weakening a learned outcome", async () => {
    await page.setContent("<button>Create project</button>");
    const before = await snapshotOutcome(page);
    await page.evaluate(() =>
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="dialog" aria-label="Upgrade to Pro">Upgrade to Pro</div>',
      ),
    );
    await expect(
      verifyOutcome(page, { ...step, expect: [{ type: "changed" }] }, before, {
        timeoutMs: 180,
        learned: step.expect,
      }),
    ).rejects.toThrow(
      /expected heading.*Q4 Launch.*saw dialog.*Upgrade to Pro/,
    );
  });
  it("ignores spinner/timestamp-only changes and invisible text", async () => {
    await page.setContent(
      '<p>Dashboard</p><div role="progressbar">1%</div><time>10:30:00</time><h1 style="position:absolute;top:2000px">Q4 Launch</h1>',
    );
    const before = await snapshotOutcome(page);
    await page.evaluate(() => {
      document.querySelector("time")!.textContent = "10:30:01";
      document.querySelector('[role="progressbar"]')!.textContent = "2%";
    });
    await expect(
      verifyOutcome(page, { ...step, expect: [{ type: "changed" }] }, before, {
        timeoutMs: 140,
      }),
    ).rejects.toBeInstanceOf(OutcomeError);
    await expect(
      verifyOutcome(page, step, before, { timeoutMs: 140 }),
    ).rejects.toBeInstanceOf(OutcomeError);
  });
  it("checks actual typed values even when an explicit heading succeeds", async () => {
    await page.setContent(
      '<label for="name">Project name</label><input id="name"><h1>Q4 Launch</h1>',
    );
    const before = await snapshotOutcome(page);
    const typing: Step = {
      ...step,
      action: "type",
      target: { label: "Project name" },
      value: "Q4 Launch",
    };
    await expect(
      verifyOutcome(page, typing, before, {
        timeoutMs: 140,
        locator: page.locator("input"),
      }),
    ).rejects.toThrow("expected value");
  });
  it("never learns a secret value when the verifier is used without the flow wrapper", async () => {
    await page.setContent(
      '<label for="password">Password</label><input id="password" type="password" value="initial-private-value">',
    );
    const before = await snapshotOutcome(page);
    expect(JSON.stringify(before)).not.toContain("initial-private-value");
    await page.locator("input").fill("fresh-private-value");
    const result = await verifyOutcome(
      page,
      {
        id: "secret",
        action: "type",
        target: { label: "Password" },
        secret: true,
        value: "fresh-private-value",
      },
      before,
      { locator: page.locator("input") },
    );
    expect(result.learned).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("fresh-private-value");
  });
  it.each([true,false])("handles an intercepting overlay (Escape dismisses it: %s) without forced clicks",async(dismissable)=>{
    await page.setContent(`<h1>Public product</h1><button onclick="document.querySelector('h1').textContent='Visible result'">Open</button><div id="cover" style="position:fixed;inset:0;background:white;z-index:100"></div><script>${dismissable?"document.addEventListener('keydown',event=>{if(event.key==='Escape')document.getElementById('cover')?.remove()})":""}</script>`);
    const action:Step={id:"open",action:"click",target:{role:"button",text:"Open"}};
    const target=await resolveTarget(page,action,{settle:false});
    const started=performance.now();
    const actuator=createActuator(page,{signal:signal(),now:()=>performance.now()-started,motion:async work=>work(),random:()=>0.5});
    if(dismissable){
      await actuator.run(action,target);
      expect(await page.locator("h1").innerText()).toBe("Visible result");
    }else{
      await expect(actuator.run(action,target)).rejects.toThrow();
      expect(await page.locator("h1").innerText()).toBe("Public product");
    }
  },15000);

  it("dispatches paced mouse and key events, then verifies selection by label", async () => {
    await page.setContent(
      '<label for="name">Project name</label><input id="name"><label for="kind">Template</label><select id="kind"><option value="old">Old</option><option value="launch">Product launch</option></select><script>window.keys=[];document.querySelector("input").addEventListener("input",()=>window.keys.push(performance.now()))</script>',
    );
    const started = performance.now(),
      actuator = createActuator(page, {
        signal: signal(),
        now: () => performance.now() - started,
        motion: async (work) => work(),
        random: () => 0.5,
      });
    const typing: Step = {
      id: "name",
      action: "type",
      target: { label: "Project name" },
      value: "Demo",
    };
    const target = await resolveTarget(page, typing, { settle: false });
    const result = await actuator.run(typing, target);
    expect(await page.locator("input").inputValue()).toBe("Demo");
    expect(actuator.samples.length).toBeGreaterThanOrEqual(18);
    expect(
      (result.cursor!.t1 - result.cursor!.t0) * 1000,
    ).toBeGreaterThanOrEqual(290);
    const keys = await page.evaluate(
      () => (window as unknown as { keys: number[] }).keys,
    );
    expect(keys.length).toBe(4);
    expect(keys[3]! - keys[0]!).toBeGreaterThanOrEqual(140);
    const select: Step = {
      id: "kind",
      action: "select",
      target: { label: "Template" },
      value: "Product launch",
    };
    const selection = await resolveTarget(page, select, { settle: false });
    const before = await snapshotOutcome(page),
      action = await actuator.run(select, selection);
    expect(action.selectedValue).toBe("launch");
    await verifyOutcome(page, select, before, {
      locator: selection.locator,
      selectedValue: action.selectedValue,
    });
  });
  it("masks secrets before input, dynamic PII, carets and scrollbars", async () => {
    await installRecordingHygiene(page, {
      secretValues: ["private-demo-key"],
      redactSelectors: [".private"],
    });
    await page.setContent(
      '<input type="password"><input type="email"><p class="private">Private</p><div id="dynamic"></div>',
    );
    await page.evaluate(
      () =>
        (document.querySelector("#dynamic")!.innerHTML =
          '<p id="email">person@example.com</p><p id="token">private-demo-key</p>'),
    );
    await delay(20);
    expect(await page.locator("[data-agentcast-redact]").count()).toBe(5);
    expect(
      await page
        .locator("input")
        .first()
        .evaluate((element) => getComputedStyle(element).caretColor),
    ).toBe("rgba(0, 0, 0, 0)");
    expect(
      await page
        .locator("#email")
        .evaluate((element) => getComputedStyle(element).filter),
    ).toBe("blur(12px)");
    const state = await snapshotOutcome(page, ["private-demo-key"]);
    expect(JSON.stringify(state)).not.toContain("private-demo-key");
    expect(JSON.stringify(state)).not.toContain("person@example.com");
  });
  it("dismisses a cookie banner but leaves unrelated Accept all buttons alone", async () => {
    await page.setContent("<button>Accept all</button>");
    expect(await dismissCookieBanner(page)).toBe(false);
    await page.setContent(
      '<aside id="cookie">We use cookies<button onclick="this.parentElement.remove()">Accept all</button></aside>',
    );
    expect(await dismissCookieBanner(page)).toBe(true);
    expect(await page.locator("aside").count()).toBe(0);
  });
  it("reinstalls hygiene before scripts on each new document", async () => {
    await installRecordingHygiene(page, { secretValues: ["private-demo-key"] });
    await context.route("https://demo.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<input type="password"><p>private-demo-key</p>',
      }),
    );
    for (const path of ["one", "two"]) {
      await page.goto(`https://demo.test/${path}`);
      expect(await page.locator("[data-agentcast-redact]").count()).toBe(2);
      expect(
        await page
          .locator("input")
          .evaluate((element) => getComputedStyle(element).filter),
      ).toBe("blur(12px)");
    }
  });
  it("matches loose text without case/spacing sensitivity and rejects checks for another input", async () => {
    await page.setContent(
      '<p>Q4   LAUNCH created</p><label for="current">Current</label><input id="current" value="Done">',
    );
    const before = await snapshotOutcome(page);
    await verifyOutcome(
      page,
      {
        ...step,
        expect: [{ type: "text", text: "q4 launch", match: "loose" }],
      },
      before,
    );
    await expect(
      verifyOutcome(
        page,
        {
          ...step,
          target: { label: "Current" },
          expect: [{ type: "value", target: "Another field", value: "Done" }],
        },
        before,
        { locator: page.locator("input"), timeoutMs: 180 },
      ),
    ).rejects.toBeInstanceOf(OutcomeError);
  });
});

const mediaAvailable = await Promise.all(
  ["ffmpeg", "ffprobe"].map((tool) =>
    runMediaCommand(tool, ["-version"]).then(
      () => true,
      () => false,
    ),
  ),
);
const flow: Flow = {
  id: "create-project",
  title: "Create project",
  whyItMatters: "Launch work",
  startUrl: "https://demo.test",
  requiresAuth: false,
  rank: 1,
  selected: true,
  source: "user",
  steps: [step],
};
const browserOptions = {
  gpu: "cpu" as const,
  viewport: { width: 640, height: 360 },
  deviceScaleFactor: 1,
  launchOptions: executablePath ? { executablePath } : undefined,
};

describe.skipIf(!available || mediaAvailable.includes(false))(
  "verified Live flow takes",
  () => {
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "agentcast-compiled-flow-"));
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    it("discards the wrong outcome, restarts fresh and commits only clean learning and timeline", async () => {
      const contexts: BrowserContext[] = [],
        progress = vi.fn();
      const result = await recordFlow(flow, {
        outputPath: join(directory, "recording.mp4"),
        browser: browserOptions,
        encoding: { encoder: "libx264" },
        outcomeTimeoutMs: 200,
        onTake: progress,
        prepare: async ({ page, context }, attempt) => {
          contexts.push(context);
          expect(await readdir(directory)).not.toContain("replay-plan.json");
          await page.setContent(
            `<button onclick="document.querySelector('h1').textContent='${attempt === 1 ? "Upgrade to Pro" : "Q4 Launch"}'">Create project</button><h1></h1>`,
          );
        },
      });
      expect(result.flowTakes.map((take) => take.status)).toEqual([
        "failed",
        "ok",
      ]);
      expect(new Set(contexts).size).toBe(2);
      expect(contexts.every((context) => context.pages().length === 0)).toBe(
        true,
      );
      expect(result.cursorSamples.length).toBeGreaterThan(10);
      expect(result.timeline.events.map((event) => event.kind)).toEqual([
        "click",
        "settled",
      ]);
      expect(result.timeline.events[0]!.cursor).toBeDefined();
      expect(result.timeline.events[0]!.bbox).toBeDefined();
      expect(result.path).toBe(join(directory, "recording.mp4"));
      expect(result.fps).toBe(30);
      expect(progress).toHaveBeenCalledTimes(2);
      const replay = await readArtifact(
        join(directory, "replay-plan.json"),
        ReplayPlan,
      );
      expect(
        replay.byFormFactor.desktop!["create-project/create"]!.learnedExpect,
      ).toContainEqual({ type: "element", role: "heading", name: "Q4 Launch" });
      expect(
        await readArtifact(join(directory, "timeline.json"), Timeline),
      ).toEqual(result.timeline);
      expect((await readdir(directory)).sort()).toEqual([
        "recording.mp4",
        "replay-plan.json",
        "timeline.json",
      ]);
    }, 30000);
    it("never replaces an existing learned expectation after three wrong takes", async () => {
      const planPath = join(directory, "replay-plan.json");
      await writeArtifact(planPath, ReplayPlan, {
        schemaVersion: 1,
        byFormFactor: {
          desktop: {
            "create-project/create": {
              strategy: "role",
              locator:
                'getByRole("button", { name: "Create project", exact: true })',
              lastOk: "yesterday",
              learnedExpect: step.expect,
            },
          },
        },
      });
      const original = await readFile(planPath, "utf8"),
        prepare = vi.fn(async ({ page }: { page: Page }) => {
          await page.setContent(
            "<button onclick=\"document.querySelector('h1').textContent='Upgrade to Pro'\">Create project</button><h1></h1>",
          );
        });
      const error = await recordFlow(
        { ...flow, steps: [{ ...step, expect: [{ type: "changed" }] }] },
        {
          outputPath: join(directory, "recording.mp4"),
          browser: browserOptions,
          outcomeTimeoutMs: 150,
          prepare,
        },
      ).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(FlowRecordingError);
      expect((error as FlowRecordingError).takes).toHaveLength(3);
      expect(prepare).toHaveBeenCalledTimes(3);
      expect(await readFile(planPath, "utf8")).toBe(original);
      expect(await readdir(directory)).toEqual(["replay-plan.json"]);
    }, 30000);
    it("redacts secret typing from footage controls and every persisted artifact", async () => {
      const secret = "private-demo-key";
      const maskChecks: boolean[] = [];
      const result = await recordFlow(
        {
          ...flow,
          steps: [
            {
              id: "key",
              action: "type",
              target: { label: "API key" },
              value: secret,
              secret: true,
            },
          ],
        },
        {
          outputPath: join(directory, "recording.mp4"),
          browser: browserOptions,
          encoding: { encoder: "libx264" },
          prepare: async ({ page }) => {
            await page.setContent(
              '<label for="key">API key</label><input id="key"><script>window.unmasked=0;document.querySelector("input").addEventListener("input",(e)=>{if(getComputedStyle(e.target).filter!=="blur(12px)")window.unmasked++})</script>',
            );
            await page.exposeFunction("assertMask", (masked: boolean) => {
              maskChecks.push(masked);
            });
            await page.evaluate(() =>
              document
                .querySelector("input")!
                .addEventListener("input", (event) => {
                  void (
                    window as unknown as {
                      assertMask(masked: boolean): Promise<void>;
                    }
                  ).assertMask(
                    getComputedStyle(event.target as Element).filter ===
                      "blur(12px)",
                  );
                }),
            );
          },
        },
      );
      expect(maskChecks).toHaveLength(secret.length);
      expect(maskChecks.every(Boolean)).toBe(true);
      expect(result.timeline.events[0]!.value).toEqual({ redacted: true });
      const artifacts = await Promise.all(
        ["timeline.json", "replay-plan.json"].map((file) =>
          readFile(join(directory, file), "utf8"),
        ),
      );
      expect(artifacts.join("\n")).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(secret);
    }, 30000);
    it("heals a semantically wrong cached target using failure context on the next take", async () => {
      const llm = {
        json: vi
          .fn()
          .mockResolvedValue({ role: "button", name: "Create workspace" }),
      };
      const result = await recordFlow(flow, {
        outputPath: join(directory, "recording.mp4"),
        browser: browserOptions,
        encoding: { encoder: "libx264" },
        outcomeTimeoutMs: 150,
        locate: { heal: true, llm, timeoutMs: 1000, settle: false },
        prepare: async ({ page }) => {
          await page.setContent(
            "<button onclick=\"document.querySelector('h1').textContent='Upgrade to Pro'\">Create project</button><button onclick=\"document.querySelector('h1').textContent='Q4 Launch'\">Create workspace</button><h1></h1>",
          );
        },
      });
      expect(result.flowTakes.map((take) => take.status)).toEqual([
        "failed",
        "ok",
      ]);
      expect(llm.json).toHaveBeenCalledTimes(1);
      const input = llm.json.mock.calls[0]![0] as {
        prompt: string;
        images: string[];
      };
      expect(input.prompt).toContain("previous failed outcome");
      expect(input.prompt).toContain("Q4 Launch");
      expect(input.prompt).toContain("Upgrade to Pro");
      expect(input.images).toHaveLength(3);
      for (const path of input.images)
        await expect(access(path)).rejects.toThrow();
    }, 30000);
    it("records eased scrolling with stall checks and learns non-locator steps", async () => {
      const result = await recordFlow(
        { ...flow, steps: [{ id: "scroll", action: "scroll", value: "500" }] },
        {
          outputPath: join(directory, "recording.mp4"),
          browser: browserOptions,
          encoding: { encoder: "libx264" },
          prepare: async ({ page }) => {
            await page.setContent(
              '<main style="height:2500px;background:repeating-linear-gradient(#eee 0px,#abc 50px,#345 100px)">Dashboard</main>',
            );
          },
        },
      );
      expect(result.stall.status).toBe("passed");
      const plan = await readArtifact(
        join(directory, "replay-plan.json"),
        ReplayPlan,
      );
      expect(
        plan.byFormFactor.desktop!["create-project/scroll"]!.learnedExpect,
      ).toEqual([{ type: "changed" }]);
    }, 30000);
    it("checks finite animation motion without treating the static settle tail as a stall", async () => {
      const result = await recordFlow(flow, {
        outputPath: join(directory, "recording.mp4"),
        browser: browserOptions,
        encoding: { encoder: "libx264" },
        prepare: async ({ page }) => {
          await page.setContent(
            "<button onclick=\"document.querySelector('h1').textContent='Q4 Launch';document.querySelector('#box').animate([{transform:'translateX(0)'},{transform:'translateX(350px)'}],{duration:650,fill:'forwards'})\">Create project</button><h1></h1><div id=\"box\" style=\"width:80px;height:80px;background:blue\"></div>",
          );
        },
      });
      expect(result.stall.status).toBe("passed");
      expect(result.timeline.dead).toEqual([]);
    }, 30000);
    it("marks the static portion of a slow outcome as dead time", async () => {
      const result = await recordFlow(flow, {
        outputPath: join(directory, "recording.mp4"),
        browser: browserOptions,
        encoding: { encoder: "libx264" },
        outcomeTimeoutMs: 3000,
        prepare: async ({ page }) => {
          await page.setContent(
            "<button onclick=\"setTimeout(()=>document.querySelector('h1').textContent='Q4 Launch',1500)\">Create project</button><h1></h1>",
          );
        },
      });
      expect(result.timeline.dead).toHaveLength(1);
      const [from, to] = result.timeline.dead[0]!;
      expect(to - from).toBeGreaterThan(0.3);
      expect(to).toBeLessThan(result.timeline.events[1]!.t);
    }, 30000);
    it("cancels during typing without retrying or publishing partial artifacts", async () => {
      const controller = new AbortController();
      const prepare = vi.fn(async ({ page }: { page: Page }) => {
        await page.setContent(
          '<label for="name">Name</label><input id="name">',
        );
        await page.exposeFunction("cancelTake", () =>
          controller.abort(new Error("cancelled during input")),
        );
        await page.evaluate(() =>
          document.querySelector("input")!.addEventListener(
            "input",
            () => {
              void (
                window as unknown as { cancelTake(): Promise<void> }
              ).cancelTake();
            },
            { once: true },
          ),
        );
      });
      await expect(
        recordFlow(
          {
            ...flow,
            steps: [
              {
                id: "name",
                action: "type",
                target: { label: "Name" },
                value: "Long project name",
              },
            ],
          },
          {
            outputPath: join(directory, "recording.mp4"),
            browser: browserOptions,
            prepare,
            signal: controller.signal,
          },
        ),
      ).rejects.toThrow("cancelled during input");
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(await readdir(directory)).toEqual([]);
    }, 30000);
  },
);
