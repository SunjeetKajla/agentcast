import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  newContext: vi.fn(),
  newPage: vi.fn(),
  addCookies: vi.fn(),
  addInitScript: vi.fn(),
  closeContext: vi.fn(),
  closeBrowser: vi.fn(),
  use: vi.fn(),
  stealth: vi.fn(),
  evasions: new Set<string>(),
}));

vi.mock("playwright-core", () => ({
  chromium: { launch: mocks.launch },
  devices: { "Pixel 7": { userAgent: "mobile-chromium" } },
}));
vi.mock("playwright-extra", () => ({
  addExtra: () => ({ launch: mocks.launch, use: mocks.use }),
}));
vi.mock("puppeteer-extra-plugin-stealth", () => ({ default: mocks.stealth }));
vi.mock("./gpu.ts", () => ({
  launchGpuBrowser: async (
    launch: (options: unknown) => Promise<unknown>,
    options: object = {},
  ) => ({
    browser: await launch({
      ...options,
      headless: true,
      handleSIGINT: true,
      handleSIGTERM: true,
      handleSIGHUP: true,
    }),
    gpu: {
      backend: "cpu",
      renderer: "SwiftShader",
      hardwareAccelerated: false,
      attempts: [],
    },
  }),
}));

import { launchRecorderBrowser, withRecorderBrowser } from "./browser.ts";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.evasions = new Set([
    "webgl.vendor",
    "user-agent-override",
    "navigator.webdriver",
  ]);
  mocks.stealth.mockImplementation(() => ({ enabledEvasions: mocks.evasions }));
  mocks.launch.mockResolvedValue({
    newContext: mocks.newContext,
    close: mocks.closeBrowser,
  });
  mocks.newContext.mockResolvedValue({
    newPage: mocks.newPage,
    addCookies: mocks.addCookies,
    addInitScript: mocks.addInitScript,
    close: mocks.closeContext,
  });
  mocks.newPage.mockResolvedValue({});
});

afterEach(() => vi.unstubAllGlobals());

describe("recorder browser lifecycle", () => {
  it("installs stealth while leaving the actual GPU identity visible", async () => {
    const session = await launchRecorderBrowser();
    expect(mocks.use).toHaveBeenCalledOnce();
    expect(mocks.evasions.has("webgl.vendor")).toBe(false);
    expect(mocks.evasions.has("navigator.webdriver")).toBe(true);
    expect(mocks.evasions.has("user-agent-override")).toBe(true);
    await session.close();
  });

  it("allows opting out of stealth", async () => {
    const session = await launchRecorderBrowser({ stealth: false });
    expect(mocks.use).not.toHaveBeenCalled();
    await session.close();
  });

  it.each([{ formFactor: "mobile" as const }, { userAgent: "custom-ua" }])(
    "keeps the configured user agent intact: %o",
    async (options) => {
      const session = await launchRecorderBrowser(options);
      expect(mocks.evasions.has("user-agent-override")).toBe(false);
      await session.close();
    },
  );
  it("enables headless launch and Playwright shutdown handling", async () => {
    const session = await launchRecorderBrowser();
    expect(mocks.launch).toHaveBeenCalledWith({
      args: ["--force-device-scale-factor=2"],
      headless: true,
      handleSIGINT: true,
      handleSIGTERM: true,
      handleSIGHUP: true,
    });
    expect(mocks.newContext).toHaveBeenCalledWith({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      userAgent: undefined,
      isMobile: false,
      hasTouch: false,
    });
    await Promise.all([session.close(), session.close()]);
    expect(mocks.closeContext).toHaveBeenCalledTimes(1);
    expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("uses a separate launch for each form factor and allows context overrides", async () => {
    const desktop = await launchRecorderBrowser();
    const mobile = await launchRecorderBrowser({ formFactor: "mobile" });
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.newContext).toHaveBeenLastCalledWith({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      userAgent: "mobile-chromium",
      isMobile: true,
      hasTouch: true,
    });
    await withRecorderBrowser(
      {
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 1,
        userAgent: "recording-test",
      },
      async () => {
        expect(mocks.newContext).toHaveBeenLastCalledWith(
          expect.objectContaining({
            viewport: { width: 800, height: 600 },
            deviceScaleFactor: 1,
            userAgent: "recording-test",
          }),
        );
      },
    );
    await Promise.all([desktop.close(), mobile.close()]);
  });

  it("seeds cookies and origin-scoped localStorage before creating a page", async () => {
    const state = {
      cookies: [
        {
          name: "session",
          value: "test-session",
          domain: "app.test",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax" as const,
        },
      ],
      origins: [
        {
          origin: "http://app.test",
          localStorage: [{ name: "token", value: "app-token" }],
        },
        {
          origin: "http://other.test",
          localStorage: [{ name: "token", value: "other-token" }],
        },
      ],
    };
    const session = await launchRecorderBrowser({ storageState: state });
    expect(mocks.addCookies).toHaveBeenCalledWith(state.cookies);
    expect(mocks.addCookies.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.newPage.mock.invocationCallOrder[0]!,
    );
    expect(mocks.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.newPage.mock.invocationCallOrder[0]!,
    );
    const [initialize, origins] = mocks.addInitScript.mock.calls[0]!;
    const setItem = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "http://app.test" },
      localStorage: { setItem },
    });
    initialize(origins);
    expect(setItem.mock.calls).toEqual([["token", "app-token"]]);
    setItem.mockClear();
    vi.stubGlobal("window", {
      location: { origin: "http://unrelated.test" },
      localStorage: { setItem },
    });
    initialize(origins);
    expect(setItem).not.toHaveBeenCalled();
    await session.close();
  });

  it.each(["newContext", "addCookies", "addInitScript", "newPage"] as const)(
    "releases resources when %s fails without losing the setup error",
    async (operation) => {
      const failure = new Error("setup failed");
      mocks[operation].mockRejectedValueOnce(failure);
      mocks.closeBrowser.mockRejectedValueOnce(
        new Error("already disconnected"),
      );
      await expect(
        launchRecorderBrowser({ storageState: { cookies: [], origins: [] } }),
      ).rejects.toBe(failure);
      expect(mocks.closeBrowser).toHaveBeenCalledOnce();
      expect(mocks.closeContext).toHaveBeenCalledTimes(
        operation === "newContext" ? 0 : 1,
      );
    },
  );

  it("closes in finally when the worker action fails", async () => {
    const failure = new Error("action failed");
    await expect(
      withRecorderBrowser({}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(mocks.closeContext).toHaveBeenCalledOnce();
    expect(mocks.closeBrowser).toHaveBeenCalledOnce();
  });

  it("still closes the browser when closing the context fails", async () => {
    const session = await launchRecorderBrowser();
    mocks.closeContext.mockRejectedValueOnce(new Error("context close failed"));
    await expect(session.close()).rejects.toThrow("context close failed");
    expect(mocks.closeBrowser).toHaveBeenCalledOnce();
  });
});
