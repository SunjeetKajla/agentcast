import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { Browser, LaunchOptions } from "playwright-core";

export type GpuBackend = "dgpu" | "igpu" | "cpu";
export type GpuPreference = "auto" | GpuBackend;

export interface GpuAdapter {
  backend: Exclude<GpuBackend, "cpu">;
  vendorId: number;
  deviceId: number;
  name: string;
}

export interface GpuAttempt {
  backend: GpuBackend;
  status: "selected" | "failed" | "skipped";
  reason?: string;
}

export interface GpuInfo {
  backend: GpuBackend;
  renderer: string;
  vendor: string;
  hardwareAccelerated: boolean;
  featureStatus: Record<string, string>;
  attempts: GpuAttempt[];
}

const execFileAsync = promisify(execFile);
const softwareRenderer =
  /swiftshader|llvmpipe|softpipe|software|lavapipe|microsoft basic render/i;

/** Vulkan reports physical adapter types, unlike PCI boot_vga (which only means primary). */
export function parseVulkanAdapters(summary: string): GpuAdapter[] {
  const adapters: GpuAdapter[] = [];
  for (const block of summary.split(/GPU\d+:/).slice(1)) {
    const type = block.match(
      /deviceType\s*=\s*(?:VK_)?PHYSICAL_DEVICE_TYPE_(\w+)/,
    )?.[1];
    const vendorId = block.match(/vendorID\s*=\s*(0x[\da-f]+)/i)?.[1];
    const deviceId = block.match(/deviceID\s*=\s*(0x[\da-f]+)/i)?.[1];
    const name = block.match(/deviceName\s*=\s*([^\r\n]+)/)?.[1]?.trim();
    if (
      !vendorId ||
      !deviceId ||
      !name ||
      !["DISCRETE_GPU", "INTEGRATED_GPU"].includes(type ?? "")
    )
      continue;
    adapters.push({
      backend: type === "DISCRETE_GPU" ? "dgpu" : "igpu",
      vendorId: Number(vendorId),
      deviceId: Number(deviceId),
      name,
    });
  }
  return adapters;
}

export async function detectGpuAdapters(): Promise<GpuAdapter[]> {
  // Optional utility, never a runtime prerequisite. Bound both time and output.
  try {
    const { stdout } = await execFileAsync("vulkaninfo", ["--summary"], {
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
      env: gpuEnvironment(),
    });
    const adapters = parseVulkanAdapters(stdout);
    if (adapters.length) return adapters;
  } catch {
    /* Missing utility/driver: inspect Linux PCI devices instead. */
  }

  if (process.platform !== "linux") return [];
  const cards = await readdir("/sys/class/drm").catch(() => [] as string[]);
  const devices = await Promise.all(
    cards
      .filter((card) => /^card\d+$/.test(card))
      .map(async (card) => {
        try {
          const path = `/sys/class/drm/${card}/device`;
          const [vendor, device, pciPath] = await Promise.all([
            readFile(`${path}/vendor`, "utf8"),
            readFile(`${path}/device`, "utf8"),
            realpath(path),
          ]);
          const vendorId = Number(vendor.trim());
          // Intel chipset graphics live at device 00:02.0; do not mislabel Arc as integrated.
          const backend =
            vendorId === 0x10de
              ? "dgpu"
              : vendorId === 0x8086 && /\/\d{4}:00:02\.0$/.test(pciPath)
                ? "igpu"
                : undefined;
          if (!backend) return undefined; // Unknown topology is not proof of an adapter type.
          return {
            backend,
            vendorId,
            deviceId: Number(device.trim()),
            name: card,
          } satisfies GpuAdapter;
        } catch {
          return undefined;
        }
      }),
  );
  return devices.filter((device): device is GpuAdapter => device !== undefined);
}

const routingVariables = [
  "__NV_PRIME_RENDER_OFFLOAD",
  "__NV_PRIME_RENDER_OFFLOAD_PROVIDER",
  "__GLX_VENDOR_LIBRARY_NAME",
  "__VK_LAYER_NV_optimus",
  "DRI_PRIME",
  "LIBGL_ALWAYS_SOFTWARE",
  "MESA_LOADER_DRIVER_OVERRIDE",
  "MESA_VK_DEVICE_SELECT",
];

function gpuEnvironment(overrides?: LaunchOptions["env"]): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides };
  for (const key of routingVariables) delete env[key];
  return env;
}

/** Set routing per child process; never modify the worker's environment. */
export function gpuLaunchOptions(
  base: LaunchOptions,
  backend: GpuBackend,
  adapter?: GpuAdapter,
): LaunchOptions {
  const env = gpuEnvironment(base.env);
  const args = [...(base.args ?? [])];
  if (backend === "cpu") {
    args.push(
      "--disable-gpu",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    );
    env.LIBGL_ALWAYS_SOFTWARE = "1";
  } else {
    args.push(
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--disable-software-rasterizer",
      backend === "dgpu"
        ? "--force-high-performance-gpu"
        : "--force-low-power-gpu",
    );
    if (process.platform === "linux") {
      args.push("--use-gl=angle", "--use-angle=gl");
      if (adapter?.vendorId === 0x10de) {
        env.__NV_PRIME_RENDER_OFFLOAD = "1";
        env.__GLX_VENDOR_LIBRARY_NAME = "nvidia";
        env.__VK_LAYER_NV_optimus = "NVIDIA_only";
      } else if (adapter) {
        // Mesa accepts vendor:device selectors for both GL and Vulkan.
        env.DRI_PRIME = `${adapter.vendorId.toString(16).padStart(4, "0")}:${adapter.deviceId.toString(16).padStart(4, "0")}`;
        env.__GLX_VENDOR_LIBRARY_NAME = "mesa";
      }
    }
  }
  return {
    ...base,
    env,
    args,
    // Full Chromium uses modern headless mode; the old headless shell can force software.
    channel: base.channel ?? (base.executablePath ? undefined : "chromium"),
    timeout:
      base.timeout && base.timeout > 0
        ? Math.min(base.timeout, 15_000)
        : 15_000,
    headless: true,
    handleSIGINT: true,
    handleSIGTERM: true,
    handleSIGHUP: true,
  };
}

/** Probe a separate context before restoring credentials or visiting a product. */
export async function probeGpu(
  browser: Browser,
): Promise<Omit<GpuInfo, "backend" | "attempts">> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const gl = canvas.getContext("webgl");
      if (!gl) throw new Error("WebGL unavailable");
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      if (!debug) throw new Error("WebGL renderer unavailable");
      gl.clearColor(1, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[0] !== 255 || gl.isContextLost())
        throw new Error("WebGL render failed");
      return {
        renderer: String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
        vendor: String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
      };
    });
    const cdp = await browser.newBrowserCDPSession();
    try {
      const { gpu } = await cdp.send("SystemInfo.getInfo");
      const featureStatus = (gpu.featureStatus ?? {}) as Record<string, string>;
      return {
        ...webgl,
        featureStatus,
        hardwareAccelerated:
          !softwareRenderer.test(webgl.renderer) &&
          featureStatus.gpu_compositing === "enabled",
      };
    } finally {
      await cdp.detach();
    }
  } finally {
    await context.close();
  }
}

/** Chrome must render on the requested physical adapter, not just accept its flags. */
export function gpuMismatch(
  info: Omit<GpuInfo, "backend" | "attempts">,
  backend: GpuBackend,
  adapter?: GpuAdapter,
): string | undefined {
  if (backend === "cpu")
    return softwareRenderer.test(info.renderer)
      ? undefined
      : "software-renderer-not-selected";
  if (!info.hardwareAccelerated) return "hardware-rendering-unavailable";
  if (!adapter) return "adapter-not-detected";
  const renderer = `${info.vendor} ${info.renderer}`;
  const vendor =
    adapter.vendorId === 0x10de
      ? /nvidia/i
      : adapter.vendorId === 0x8086
        ? /intel/i
        : adapter.vendorId === 0x1002
          ? /amd|ati|radeon/i
          : undefined;
  if (vendor && !vendor.test(renderer)) return "wrong-adapter";
  const ids = [...info.renderer.matchAll(/0x([\da-f]{4,8})/gi)].map((match) =>
    parseInt(match[1]!, 16),
  );
  if (ids.length && !ids.includes(adapter.deviceId)) return "wrong-adapter";
  // Vendor alone cannot distinguish an Intel iGPU from an Intel Arc dGPU.
  // If ANGLE omits PCI IDs, require the physical adapter's reported model name.
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ids.length && !normalize(renderer).includes(normalize(adapter.name)))
    return "unverified-adapter";
  return undefined;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("GPU probe timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function launchGpuBrowser(
  launch: (options: LaunchOptions) => Promise<Browser>,
  options: LaunchOptions = {},
  preference: GpuPreference = "auto",
): Promise<{ browser: Browser; gpu: GpuInfo }> {
  const conflict = options.args?.find((arg) =>
    /^(--use-gl|--use-angle|--disable-gpu|--enable-gpu|--force-high-performance-gpu|--force-low-power-gpu|--disable-software-rasterizer|--enable-unsafe-swiftshader)(=|$)/.test(
      arg,
    ),
  );
  if (conflict)
    throw new Error(
      "GPU flags are managed by the recorder; use the gpu option instead",
    );
  const adapters = preference === "cpu" ? [] : await detectGpuAdapters();
  const order: GpuBackend[] =
    preference === "cpu"
      ? ["cpu"]
      : preference === "igpu"
        ? ["igpu", "cpu"]
        : ["dgpu", "igpu", "cpu"];
  const attempts: GpuAttempt[] = [];
  const errors: unknown[] = [];
  for (const backend of order) {
    const adapter = adapters.find((item) => item.backend === backend);
    if (backend !== "cpu" && !adapter) {
      attempts.push({
        backend,
        status: "skipped",
        reason: "adapter-not-detected",
      });
      continue;
    }
    let browser: Browser | undefined;
    try {
      browser = await launch(gpuLaunchOptions(options, backend, adapter));
      const info = await withTimeout(probeGpu(browser), 5_000);
      const mismatch = gpuMismatch(info, backend, adapter);
      if (mismatch) {
        attempts.push({ backend, status: "failed", reason: mismatch });
      } else {
        attempts.push({ backend, status: "selected" });
        return { browser, gpu: { ...info, backend, attempts } };
      }
    } catch (error) {
      errors.push(error);
      // No raw launch logs or command lines in diagnostics (they can contain secrets).
      attempts.push({
        backend,
        status: "failed",
        reason: browser ? "probe-failed" : "launch-failed",
      });
    }
    await browser?.close(); // Never start the next browser until this one is released.
  }
  throw new AggregateError(
    errors,
    `No usable Chromium renderer (${attempts.map((item) => `${item.backend}: ${item.reason}`).join(", ")})`,
  );
}
