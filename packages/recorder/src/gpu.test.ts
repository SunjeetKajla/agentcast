import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, LaunchOptions } from "playwright-core";

const mocks = vi.hoisted(() => ({ enumerate: vi.fn(), readdir: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: mocks.enumerate,
  }),
}));
vi.mock("node:fs/promises", () => ({ readdir: mocks.readdir }));

import {
  detectGpuAdapters,
  gpuLaunchOptions,
  gpuMismatch,
  launchGpuBrowser,
  parseVulkanAdapters,
} from "./gpu.ts";

const summary = `GPU0:
vendorID = 0x8086
deviceID = 0xa788
deviceType = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU
deviceName = Intel Graphics
GPU1:
vendorID = 0x10de
deviceID = 0x2d59
deviceType = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
deviceName = NVIDIA RTX 5060
GPU2:
vendorID = 0x10005
deviceID = 0x0000
deviceType = PHYSICAL_DEVICE_TYPE_CPU
deviceName = llvmpipe
`;
const adapters = parseVulkanAdapters(summary);
const nvidia = adapters[1]!;
const intel = adapters[0]!;

function fakeBrowser(renderer: string, hardware = true) {
  const context = {
    newPage: vi.fn().mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue({ renderer, vendor: renderer }),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const cdp = {
    send: vi.fn().mockResolvedValue({
      gpu: {
        featureStatus: {
          gpu_compositing: hardware ? "enabled" : "disabled_software",
        },
      },
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    newBrowserCDPSession: vi.fn().mockResolvedValue(cdp),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context, cdp, value: browser as unknown as Browser };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enumerate.mockResolvedValue({ stdout: summary });
  mocks.readdir.mockResolvedValue([]);
});

describe("GPU selection", () => {
  it("classifies physical adapters without mistaking a CPU Vulkan device for a GPU", () => {
    expect(adapters.map((adapter) => adapter.backend)).toEqual([
      "igpu",
      "dgpu",
    ]);
    expect(parseVulkanAdapters("not a Vulkan device report")).toEqual([]);
  });

  it("sets child-only routing and removes inherited dGPU settings before iGPU/CPU fallback", () => {
    const env = {
      __NV_PRIME_RENDER_OFFLOAD: "1",
      __GLX_VENDOR_LIBRARY_NAME: "nvidia",
      DRI_PRIME: "1",
      LIBGL_ALWAYS_SOFTWARE: "1",
      KEPT: "yes",
    };
    const discrete = gpuLaunchOptions({ env }, "dgpu", nvidia);
    expect(discrete.env).toMatchObject({
      __NV_PRIME_RENDER_OFFLOAD: "1",
      __GLX_VENDOR_LIBRARY_NAME: "nvidia",
      KEPT: "yes",
    });
    expect(discrete.env?.LIBGL_ALWAYS_SOFTWARE).toBeUndefined();
    const integrated = gpuLaunchOptions({ env }, "igpu", intel);
    expect(integrated.env?.__NV_PRIME_RENDER_OFFLOAD).toBeUndefined();
    expect(integrated.env).toMatchObject({
      DRI_PRIME: "8086:a788",
      __GLX_VENDOR_LIBRARY_NAME: "mesa",
    });
    const cpu = gpuLaunchOptions({ env }, "cpu");
    expect(cpu.env?.DRI_PRIME).toBeUndefined();
    expect(cpu.args).toContain("--use-angle=swiftshader");
    expect(cpu.env?.LIBGL_ALWAYS_SOFTWARE).toBe("1");
    expect(env.DRI_PRIME).toBe("1");
  });

  it("closes failed dGPU and iGPU browsers before selecting CPU", async () => {
    const discrete = fakeBrowser("SwiftShader", false);
    const integrated = fakeBrowser("llvmpipe", false);
    const cpu = fakeBrowser("ANGLE SwiftShader", false);
    const launch = vi
      .fn()
      .mockResolvedValueOnce(discrete.value)
      .mockImplementationOnce(async () => {
        expect(discrete.browser.close).toHaveBeenCalledOnce();
        return integrated.value;
      })
      .mockImplementationOnce(async () => {
        expect(integrated.browser.close).toHaveBeenCalledOnce();
        return cpu.value;
      });
    const result = await launchGpuBrowser(launch);
    expect(result.gpu.backend).toBe("cpu");
    expect(result.gpu.attempts).toEqual([
      {
        backend: "dgpu",
        status: "failed",
        reason: "hardware-rendering-unavailable",
      },
      {
        backend: "igpu",
        status: "failed",
        reason: "hardware-rendering-unavailable",
      },
      { backend: "cpu", status: "selected" },
    ]);
    expect(cpu.browser.close).not.toHaveBeenCalled();
    for (const instance of [discrete, integrated, cpu]) {
      expect(instance.context.close).toHaveBeenCalledOnce();
      expect(instance.cdp.detach).toHaveBeenCalledOnce();
    }
  });

  it("falls back to the verified iGPU after the dGPU fails to launch", async () => {
    const integrated = fakeBrowser("ANGLE Intel (0x0000A788)");
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error("driver unavailable"))
      .mockResolvedValueOnce(integrated.value);
    const { gpu } = await launchGpuBrowser(launch);
    expect(gpu.backend).toBe("igpu");
    expect(gpu.hardwareAccelerated).toBe(true);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("rejects the wrong physical GPU even when hardware compositing is enabled", () => {
    const info = {
      renderer: "ANGLE Intel (0x0000A788)",
      vendor: "Intel",
      hardwareAccelerated: true,
      featureStatus: {},
    };
    expect(gpuMismatch(info, "dgpu", nvidia)).toBe("wrong-adapter");
    expect(
      gpuMismatch(
        { ...info, renderer: "ANGLE Intel Arc (0x000056A0)" },
        "igpu",
        intel,
      ),
    ).toBe("wrong-adapter");
    expect(gpuMismatch(info, "cpu")).toBe("software-renderer-not-selected");
    expect(gpuMismatch({ ...info, renderer: "Intel Arc" }, "igpu", intel)).toBe(
      "unverified-adapter",
    );
    expect(
      gpuMismatch(
        { ...info, renderer: "ANGLE Mesa Intel Graphics" },
        "igpu",
        intel,
      ),
    ).toBeUndefined();
  });

  it("selects CPU directly without querying hardware when requested", async () => {
    const cpu = fakeBrowser("SwiftShader", false);
    const launch = vi.fn().mockResolvedValue(cpu.value);
    expect((await launchGpuBrowser(launch, {}, "cpu")).gpu.backend).toBe("cpu");
    expect(mocks.enumerate).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledOnce();
  });

  it("starts at iGPU when requested and does not attempt the dGPU", async () => {
    const integrated = fakeBrowser("Intel (0x0000A788)");
    const launch = vi.fn().mockResolvedValue(integrated.value);
    const { gpu } = await launchGpuBrowser(launch, {}, "igpu");
    expect(gpu.attempts).toEqual([{ backend: "igpu", status: "selected" }]);
  });

  it("skips unknown/missing adapters and keeps working without vulkaninfo", async () => {
    mocks.enumerate.mockRejectedValue(new Error("ENOENT"));
    expect(await detectGpuAdapters()).toEqual([]);
    const cpu = fakeBrowser("SwiftShader", false);
    const { gpu } = await launchGpuBrowser(
      vi.fn().mockResolvedValue(cpu.value),
    );
    expect(gpu.attempts.slice(0, 2).map((attempt) => attempt.status)).toEqual([
      "skipped",
      "skipped",
    ]);
  });

  it("closes a browser whose probe crashes and releases its context", async () => {
    const broken = fakeBrowser("NVIDIA");
    broken.context.newPage.mockRejectedValueOnce(
      new Error("GPU process crashed"),
    );
    const integrated = fakeBrowser("Intel (0x0000A788)");
    const launch = vi
      .fn()
      .mockResolvedValueOnce(broken.value)
      .mockResolvedValueOnce(integrated.value);
    expect((await launchGpuBrowser(launch)).gpu.backend).toBe("igpu");
    expect(broken.context.close).toHaveBeenCalledOnce();
    expect(broken.browser.close).toHaveBeenCalledOnce();
  });

  it("times out a hung GPU probe and advances to the next adapter", async () => {
    vi.useFakeTimers();
    try {
      const hung = fakeBrowser("NVIDIA");
      hung.context.newPage.mockReturnValueOnce(new Promise(() => {}));
      const integrated = fakeBrowser("Intel (0x0000A788)");
      const launch = vi
        .fn()
        .mockResolvedValueOnce(hung.value)
        .mockResolvedValueOnce(integrated.value);
      const result = launchGpuBrowser(launch);
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await result).gpu.backend).toBe("igpu");
      expect(hung.browser.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails explicitly when even software rendering is unavailable", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("Chromium missing"));
    await expect(launchGpuBrowser(launch)).rejects.toThrow(
      "No usable Chromium renderer",
    );
  });

  it("rejects conflicting raw GPU flags before starting a browser", async () => {
    const launch = vi.fn<(options: LaunchOptions) => Promise<Browser>>();
    await expect(
      launchGpuBrowser(launch, { args: ["--disable-gpu"] }),
    ).rejects.toThrow("GPU flags are managed");
    expect(launch).not.toHaveBeenCalled();
  });
});
