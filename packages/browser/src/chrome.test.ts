import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, LaunchOptions } from "playwright-core";

const mocks = vi.hoisted(() => ({ launch: vi.fn(), route: vi.fn() }));
vi.mock("playwright-core", () => ({
  chromium: { launchPersistentContext: mocks.launch },
}));
vi.mock("@agentcast/recorder/gpu", () => ({ launchGpuBrowser: mocks.route }));
import { launchExplorationChrome } from "./chrome.ts";

const gpu = {
  backend: "dgpu",
  channel: "chrome",
  renderer: "verified NVIDIA",
  vendor: "NVIDIA",
  hardwareAccelerated: true,
  featureStatus: { gpu_compositing: "enabled" },
  attempts: [{ backend: "dgpu", status: "selected" }],
};

function fakeContext() {
  const events = new EventEmitter();
  const close = vi.fn(async () => {
    events.emit("close");
  });
  const browser = { close } as unknown as Browser;
  const context = Object.assign(events, {
    close,
    browser: () => browser,
    addInitScript: vi.fn(async () => {}),
    pages: () => [],
  }) as unknown as BrowserContext;
  return { context, browser, close };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.route.mockImplementation(async (launch, options) => ({
    browser: await launch({
      ...options,
      channel: "chrome",
      headless: true,
      timeout: 15_000,
    }),
    gpu,
  }));
});

describe("exploration Chrome ownership", () => {
  it("delegates verification and routing, retaining profile, video, CDP and context options", async () => {
    const owned = fakeContext();
    mocks.launch.mockResolvedValue(owned.context);
    const launchOptions = {
      args: [
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
      ],
    };
    const contextOptions = {
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: "/tmp/videos" },
    };
    const result = await launchExplorationChrome("/tmp/task/profile", {
      gpu: "auto",
      launchOptions,
      contextOptions,
    });
    expect(result).toEqual({ context: owned.context, gpu });
    expect(mocks.route).toHaveBeenCalledWith(
      expect.any(Function),
      launchOptions,
      "auto",
    );
    expect(mocks.launch).toHaveBeenCalledWith("/tmp/task/profile", {
      ...contextOptions,
      ...launchOptions,
      channel: "chrome",
      headless: true,
      timeout: 15_000,
    });
    expect(owned.close).not.toHaveBeenCalled();
    await result.context.close();
  });

  it("honors an explicitly headed worker-owned launch", async () => {
    mocks.launch.mockResolvedValue(fakeContext().context);
    const { context } = await launchExplorationChrome("/tmp/profile", {
      launchOptions: { headless: false },
    });
    expect(mocks.launch.mock.calls[0]![1].headless).toBe(false);
    await context.close();
  });

  it("closes the selected persistent context on cancellation after handoff", async () => {
    const owned = fakeContext(),
      controller = new AbortController();
    mocks.launch.mockResolvedValue(owned.context);
    await launchExplorationChrome("/tmp/profile", {
      signal: controller.signal,
    });
    controller.abort();
    await Promise.resolve();
    expect(owned.close).toHaveBeenCalledOnce();
  });

  it("releases its cancellation listener when the caller closes the context", async () => {
    const owned = fakeContext(),
      controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    mocks.launch.mockResolvedValue(owned.context);
    const { context } = await launchExplorationChrome("/tmp/profile", {
      signal: controller.signal,
    });
    await context.close();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(owned.close).toHaveBeenCalledOnce();
  });

  it("rejects promptly during a pending launch and closes the eventual process", async () => {
    const owned = fakeContext(),
      controller = new AbortController();
    let resolveLaunch!: (context: BrowserContext) => void;
    mocks.launch.mockReturnValue(
      new Promise((resolve) => {
        resolveLaunch = resolve;
      }),
    );
    const result = launchExplorationChrome("/tmp/profile", {
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toThrow("Cancelled task");
    controller.abort(new Error("Cancelled task"));
    await rejected;
    resolveLaunch(owned.context);
    await vi.waitFor(() => expect(owned.close).toHaveBeenCalledOnce());
  });

  it("cancels during verification without waiting for a hung GPU probe", async () => {
    const owned = fakeContext(),
      controller = new AbortController();
    let probing!: () => void;
    const started = new Promise<void>((resolve) => {
      probing = resolve;
    });
    mocks.launch.mockResolvedValue(owned.context);
    mocks.route.mockImplementation(async (launch) => {
      await launch({});
      probing();
      return new Promise(() => {});
    });
    const result = launchExplorationChrome("/tmp/profile", {
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toThrow("Stop probe");
    await started;
    controller.abort(new Error("Stop probe"));
    await rejected;
    expect(owned.close).toHaveBeenCalledOnce();
  });

  it("hands off the persistent context selected after recorder fallback", async () => {
    const failed = fakeContext(),
      selected = fakeContext();
    mocks.launch
      .mockResolvedValueOnce(failed.context)
      .mockResolvedValueOnce(selected.context);
    mocks.route.mockImplementation(
      async (launch: (options: LaunchOptions) => Promise<Browser>) => {
        const first = await launch({ args: ["--force-high-performance-gpu"] });
        await first.close();
        return {
          browser: await launch({ args: ["--force-low-power-gpu"] }),
          gpu: { ...gpu, backend: "igpu" },
        };
      },
    );
    const result = await launchExplorationChrome("/tmp/profile");
    expect(result.context).toBe(selected.context);
    expect(result.gpu.backend).toBe("igpu");
    expect(failed.close).toHaveBeenCalledOnce();
    await result.context.close();
  });

  it("closes any owned context when verification fails", async () => {
    const owned = fakeContext();
    mocks.launch.mockResolvedValue(owned.context);
    mocks.route.mockImplementation(async (launch) => {
      await launch({});
      throw new Error("No verified renderer");
    });
    await expect(launchExplorationChrome("/tmp/profile")).rejects.toThrow(
      "No verified renderer",
    );
    expect(owned.close).toHaveBeenCalledOnce();
  });

  it("never launches for an already cancelled task or an empty profile", async () => {
    await expect(
      launchExplorationChrome("/tmp/profile", { signal: AbortSignal.abort() }),
    ).rejects.toBeDefined();
    await expect(launchExplorationChrome(" ")).rejects.toThrow(
      "isolated Chrome profile",
    );
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });
});
