import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { createLlm } from "@agentcast/llm";
import { ReplayPlan, type Step } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { resolveTarget, LocatorResolutionError } from "./locate.ts";
import { HealingAnswer } from "./heal.ts";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const available = await access(
  executablePath ?? chromium.executablePath(),
).then(
  () => true,
  () => false,
);
let browser: Browser;
let context: BrowserContext;
let page: Page;
let directory: string;
const opts = { settle: false, timeoutMs: 100, pollIntervalMs: 10 };
const click = (target: Step["target"]): Step => ({
  id: "s1",
  action: "click",
  target,
});
const mockedLlm = (answer: unknown) => ({
  json: vi.fn().mockResolvedValue(answer),
});

describe.skipIf(!available)("locator chain in Chromium", () => {
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
    directory = await mkdtemp(join(tmpdir(), "agentcast-locate-test-"));
  });
  afterEach(async () => {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("prefers the exact role/name before label, placeholder or text", async () => {
    await page.setContent(
      '<button id="correct">Save</button><input aria-label="Save" placeholder="Save"><p>Save</p>',
    );
    const result = await resolveTarget(
      page,
      click({ role: "button", text: "Save" }),
      opts,
    );
    expect(result.method).toBe("role");
    expect(await result.locator.getAttribute("id")).toBe("correct");
  });

  it("takes the match inside an open modal over the same text behind it", async () => {
    await page.setContent(
      '<main><span>Initiatives</span></main><div role="dialog" aria-modal="true" style="position:fixed;inset:40px;background:#fff"><nav><span id="target">Initiatives</span></nav></div>',
    );
    const result = await resolveTarget(page, click({ text: "Initiatives" }), opts);
    expect(await result.locator.getAttribute("id")).toBe("target");
  });

  it("falls back to label and excludes a disabled role match", async () => {
    await page.setContent(
      '<input disabled role="textbox" aria-label="Old name"><label for="field">Project name</label><input id="field">',
    );
    const result = await resolveTarget(
      page,
      {
        id: "type",
        action: "type",
        target: { role: "textbox", text: "Old name", label: "Project name" },
      },
      opts,
    );
    expect(result.method).toBe("label");
    await result.locator.fill("Q4 Launch");
    expect(await page.locator("#field").inputValue()).toBe("Q4 Launch");
  });

  it("uses placeholder before exact text and refuses to type into a button", async () => {
    await page.setContent(
      '<button>Project name</button><input placeholder="Project name">',
    );
    const result = await resolveTarget(
      page,
      { id: "type", action: "type", target: { text: "Project name" } },
      opts,
    );
    expect(result.method).toBe("placeholder");
    expect(await result.locator.evaluate((element) => element.tagName)).toBe(
      "INPUT",
    );
  });

  it("falls back to exact visible text", async () => {
    await page.setContent(
      '<div id="target">Open workspace</div><div hidden>Open workspace</div>',
    );
    const result = await resolveTarget(
      page,
      click({ text: "Open workspace" }),
      opts,
    );
    expect(result.method).toBe("text");
    expect(await result.locator.getAttribute("id")).toBe("target");
  });

  it.each([
    ["Backed by Vercel", "Backed by▲ Vercel"],
    ["Create project", "Create porject"],
  ])("fuzzily resolves %s to %s", async (query, actual) => {
    await page.setContent(`<button id="target">${actual}</button>`);
    const result = await resolveTarget(
      page,
      click({ role: "button", text: query }),
      opts,
    );
    expect(result.method).toBe("fuzzy");
    expect(await result.locator.getAttribute("id")).toBe("target");
  });

  it("handles punctuation-only fuzzy differences without an explicit role", async () => {
    await page.setContent('<button id="target">CREATE—PROJECT!</button>');
    const result = await resolveTarget(
      page,
      click({ text: "Create project" }),
      opts,
    );
    expect(result.method).toBe("fuzzy");
    expect(await result.locator.getAttribute("id")).toBe("target");
  });

  it("uses computed accessible names rather than just innerText", async () => {
    await page.setContent(
      '<button id="target" aria-label="CREATE—PROJECT!">+</button>',
    );
    const result = await resolveTarget(
      page,
      click({ role: "button", text: "Create project" }),
      opts,
    );
    expect(result.method).toBe("fuzzy");
    expect(await result.locator.getAttribute("id")).toBe("target");
  });

  it("waits for a late target within a single deterministic budget", async () => {
    await page.setContent(
      '<script>setTimeout(() => {const b=document.createElement("button");b.textContent="Ready";document.body.append(b)}, 200)</script>',
    );
    const result = await resolveTarget(
      page,
      click({ role: "button", text: "Ready" }),
      { ...opts, timeoutMs: 1000 },
    );
    expect(result.method).toBe("role");
  });

  it("preserves role priority when a target becomes available between chain queries", async () => {
    await page.setContent('<button id="ready">Ready</button>');
    // Simulate the role query just before the button arrives, followed by the text
    // query after it arrives. Subsequent role queries use the actual live DOM.
    const lookup = vi
      .spyOn(page, "getByRole")
      .mockImplementationOnce(() => page.locator("#not-yet-present"));
    try {
      const result = await resolveTarget(
        page,
        click({ role: "button", text: "Ready" }),
        { ...opts, timeoutMs: 1000 },
      );
      expect(result.method).toBe("role");
      expect(await result.locator.getAttribute("id")).toBe("ready");
    } finally {
      lookup.mockRestore();
    }
  });

  it("rejects ambiguous matches rather than blindly choosing the first", async () => {
    await page.setContent("<button>Save</button><button>Save</button>");
    await expect(
      resolveTarget(page, click({ role: "button", text: "Save" }), opts),
    ).rejects.toMatchObject({ code: "locator.ambiguous" });
  });

  it("resolves repeated controls by explicit near context", async () => {
    await page.setContent(
      '<section><h2>Personal plan</h2><button id="personal">Edit</button></section><section style="margin-top:160px"><h2>Business plan</h2><button id="business">Edit</button></section>',
    );
    const result = await resolveTarget(
      page,
      click({ role: "button", text: "Edit", near: "Business plan" }),
      opts,
    );
    expect(await result.locator.getAttribute("id")).toBe("business");
  });

  it("prefers the only on-screen match when no near hint is provided", async () => {
    await page.setContent(
      '<button id="visible">Edit</button><button style="position:absolute;top:1500px">Edit</button>',
    );
    const result = await resolveTarget(
      page,
      click({ role: "button", text: "Edit" }),
      opts,
    );
    expect(await result.locator.getAttribute("id")).toBe("visible");
  });

  it("prefers the main-content duplicate only when every link has the same href", async () => {
    await page.setContent(
      '<nav><a href="https://demo.test/project">Project</a></nav><main><a id="main" href="https://demo.test/project">Project</a></main>',
    );
    const result = await resolveTarget(
      page,
      click({ role: "link", text: "Project" }),
      opts,
    );
    expect(await result.locator.getAttribute("id")).toBe("main");
    await page
      .locator("#main")
      .evaluate((element) =>
        element.setAttribute("href", "https://demo.test/other"),
      );
    await expect(
      resolveTarget(page, click({ role: "link", text: "Project" }), opts),
    ).rejects.toMatchObject({ code: "locator.ambiguous" });
  });

  it("chooses the first below-fold match for a scroll target", async () => {
    await page.setContent(
      '<h2 id="first" style="position:absolute;top:900px">Details</h2><h2 style="position:absolute;top:1700px">Details</h2>',
    );
    const result = await resolveTarget(
      page,
      {
        id: "scroll",
        action: "scroll",
        target: { role: "heading", text: "Details" },
      },
      opts,
    );
    expect(await result.locator.getAttribute("id")).toBe("first");
  });

  it("does not approximate short action names or different numeric identifiers", async () => {
    await page.setContent("<button>No</button><button>Invoice 1235</button>");
    for (const text of ["Go", "Invoice 1234"])
      await expect(
        resolveTarget(page, click({ role: "button", text }), opts),
      ).rejects.toMatchObject({ code: "locator.not-found" });
  });

  it("rejects equally good fuzzy guesses", async () => {
    await page.setContent(
      "<button>Create-project!</button><button>CREATE PROJECT</button>",
    );
    await expect(
      resolveTarget(
        page,
        click({ role: "button", text: "Create project" }),
        opts,
      ),
    ).rejects.toBeInstanceOf(LocatorResolutionError);
  });

  it("supports open shadow DOM", async () => {
    await page.setContent(
      '<div id="host"></div><script>document.getElementById("host").attachShadow({mode:"open"}).innerHTML="<button>Launch</button>"</script>',
    );
    expect(
      (
        await resolveTarget(
          page,
          click({ role: "button", text: "Launch" }),
          opts,
        )
      ).method,
    ).toBe("role");
  });

  it("accepts only editable typing targets and native select targets", async () => {
    await page.setContent(
      '<input readonly aria-label="Name"><input disabled aria-label="Name"><button>Plan</button><select aria-label="Plan"><option>Pro</option></select>',
    );
    await expect(
      resolveTarget(
        page,
        { id: "type", action: "type", target: { label: "Name" } },
        opts,
      ),
    ).rejects.toBeInstanceOf(LocatorResolutionError);
    expect(
      (
        await resolveTarget(
          page,
          { id: "select", action: "select", target: { label: "Plan" } },
          opts,
        )
      ).method,
    ).toBe("label");
  });

  it("reuses, validates and repairs a cached locator without executing its contents", async () => {
    const replayPlanPath = join(directory, "replay-plan.json");
    await page.setContent('<button id="first">Create project</button>');
    const step = click({ role: "button", text: "Create project" });
    expect(
      (await resolveTarget(page, step, { ...opts, replayPlanPath })).method,
    ).toBe("role");
    expect(
      (await resolveTarget(page, step, { ...opts, replayPlanPath })).method,
    ).toBe("cache");
    const plan = await readArtifact(replayPlanPath, ReplayPlan);
    plan.byFormFactor.desktop!.s1!.locator += ";globalThis.pwned=true";
    plan.byFormFactor.desktop!.s1!.learnedExpect = [{ type: "changed" }];
    await writeArtifact(replayPlanPath, ReplayPlan, plan);
    expect(
      (await resolveTarget(page, step, { ...opts, replayPlanPath })).method,
    ).toBe("role");
    expect(
      (await readArtifact(replayPlanPath, ReplayPlan)).byFormFactor.desktop!.s1!
        .learnedExpect,
    ).toEqual([{ type: "changed" }]);
    expect(await page.evaluate(() => "pwned" in globalThis)).toBe(false);
  });

  it("does not call the LLM when deterministic resolution works or healing is disabled", async () => {
    const llm = mockedLlm({ role: "button", name: "New name" });
    await page.setContent("<button>Save</button>");
    await resolveTarget(page, click({ role: "button", text: "Save" }), {
      ...opts,
      heal: true,
      llm,
    });
    await expect(
      resolveTarget(page, click({ role: "button", text: "Missing" }), {
        ...opts,
        llm,
      }),
    ).rejects.toThrow();
    expect(llm.json).not.toHaveBeenCalled();
  });

  it("heals a renamed control with the real LLM runner and a fake CLI, then caches the verified result", async () => {
    await page.setContent('<button id="renamed">Launch workspace</button>');
    const saved = { ...process.env };
    const log = join(directory, "calls.ndjson");
    Object.assign(process.env, {
      AGENTCAST_CLAUDE_BIN: fileURLToPath(
        new URL("../../../llm/src/test/fake-claude.mjs", import.meta.url),
      ),
      FAKE_LOG: log,
      FAKE_STATE: join(directory, "state"),
      FAKE_MODES: "ok",
      FAKE_ANSWER: JSON.stringify({ role: "button", name: "Launch workspace" }),
    });
    try {
      const replayPlanPath = join(directory, "replay-plan.json");
      const step = click({ role: "button", text: "Begin project" });
      const result = await resolveTarget(page, step, {
        ...opts,
        replayPlanPath,
        heal: true,
        llm: createLlm({
          backend: "claude-code",
          env: { AGENTCAST_LLM_FAST: "claude-code" },
        }),
      });
      expect(result.method).toBe("llm");
      expect(result.strategy).toBe("llm");
      expect(await result.locator.getAttribute("id")).toBe("renamed");
      expect(
        (await resolveTarget(page, step, { ...opts, replayPlanPath })).method,
      ).toBe("cache");
      const calls = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(
        expect.arrayContaining(["--model", "haiku", "--json-schema"]),
      );
      expect(calls[0].stdin).toContain("untrusted_site_content");
    } finally {
      for (const key of Object.keys(process.env))
        if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  }, 15_000);

  it.each([
    { role: "button", name: "Invented" },
    { role: null, name: null },
    { role: "button", name: "Duplicate" },
  ])(
    "verifies and rejects an unsafe/missing/ambiguous healed target: %o",
    async (answer) => {
      await page.setContent(
        "<button>Duplicate</button><button>Duplicate</button>",
      );
      await expect(
        resolveTarget(page, click({ role: "button", text: "Begin project" }), {
          ...opts,
          heal: true,
          llm: mockedLlm(answer),
        }),
      ).rejects.toMatchObject({ code: "locator.heal-rejected" });
    },
  );

  it("redacts secret values from prompts/scratch inputs and cleans up after healing", async () => {
    const secret = "private-login-token-123456";
    await page.setContent(
      `<input type="password" value="${secret}"><input aria-label="Email" value="person@example.com"><p>${secret}</p><button>Launch workspace</button>`,
    );
    let image = "";
    const llm = mockedLlm({ role: "button", name: "Launch workspace" });
    llm.json.mockImplementation(async (task) => {
      image = task.images[0];
      expect(task.prompt).not.toContain(secret);
      expect(task.prompt).not.toContain("person@example.com");
      expect(task.prompt).toContain("[redacted");
      expect(task.tier).toBe("fast");
      expect(
        HealingAnswer.safeParse({ role: "button", name: "Launch workspace" })
          .success,
      ).toBe(true);
      for (const file of ["TASK.md", "snapshot.txt"])
        expect(
          await readFile(join(dirname(image), file), "utf8"),
        ).not.toContain(secret);
      expect((await readFile(image)).subarray(1, 4).toString()).toBe("PNG");
      return { role: "button", name: "Launch workspace" };
    });
    await resolveTarget(
      page,
      {
        ...click({ role: "button", text: "Begin project" }),
        secret: true,
        value: secret,
      },
      { ...opts, heal: true, llm },
    );
    await expect(access(image)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never persists a locator containing a known secret or email", async () => {
    await page.setContent("<button>person@example.com</button>");
    const result = await resolveTarget(
      page,
      click({ role: "button", text: "person@example.com" }),
      { ...opts, replayPlanPath: join(directory, "replay-plan.json") },
    );
    expect(result.entry).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it("honors cancellation during polling and caps a healing runner that ignores its signal", async () => {
    await page.setContent("<p>Nothing here</p>");
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("cancelled")), 30);
    await expect(
      resolveTarget(page, click({ text: "Missing" }), {
        ...opts,
        timeoutMs: 1000,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    const llm = mockedLlm(undefined);
    let image = "";
    llm.json.mockImplementation((task) => {
      image = task.images[0];
      return new Promise(() => {});
    });
    await expect(
      resolveTarget(page, click({ text: "Missing" }), {
        ...opts,
        heal: true,
        llm,
        healTimeoutMs: 1000,
      }),
    ).rejects.toThrow("timed out");
    expect(llm.json).toHaveBeenCalledOnce();
    await expect(access(image)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an empty target without invoking healing", async () => {
    await expect(
      resolveTarget(
        page,
        { id: "s1", action: "click" },
        { ...opts, heal: true },
      ),
    ).rejects.toMatchObject({ code: "locator.not-found" });
  });
});
