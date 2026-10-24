import { setTimeout as delay } from "node:timers/promises";
import {
  chromium,
  devices,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from "playwright-core";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { launchGpuBrowser, type GpuInfo, type GpuPreference } from "./gpu.ts";
import { safeUserAgentOverride } from './stealth';

export type FormFactor = "desktop" | "mobile";

/** In-memory Playwright state; loading/decrypting session artifacts belongs to the worker. */
export type RecorderStorageState = Pick<
  Exclude<NonNullable<BrowserContextOptions["storageState"]>, string>,
  "cookies" | "origins"
>;

export interface RecorderBrowserOptions {
  signal?: AbortSignal;
  formFactor?: FormFactor;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  storageState?: RecorderStorageState;
  /** Default auto: dGPU, then iGPU, then verified CPU software rendering. */
  gpu?: GpuPreference;
  /** Puppeteer Extra's stealth plugin, enabled by default. */
  stealth?: boolean;
  /** Google Chrome stable by default (licensed codecs), bundled Chromium if Chrome isn't installed. */
  launchOptions?: Omit<
    LaunchOptions,
    "headless" | "handleSIGINT" | "handleSIGTERM" | "handleSIGHUP"
  >;
}

export interface RecorderBrowser {
  formFactor: FormFactor;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** The DPR the recorder configured. Trust this, not the page's window.devicePixelRatio. */
  deviceScaleFactor: number;
  gpu: GpuInfo;
  /** Safe to call repeatedly, including from competing cleanup paths. */
  close(): Promise<void>;
}

const KEEP_NAMES = "globalThis.__name ??= (target) => target;";

/** Each call owns a separate headless browser, context and page. */
export async function launchRecorderBrowser(
  options: RecorderBrowserOptions = {},
): Promise<RecorderBrowser> {
  options.signal?.throwIfAborted();
  const formFactor = options.formFactor ?? "desktop";
  const mobile = formFactor === "mobile";
  const deviceScaleFactor = options.deviceScaleFactor ?? (mobile ? 3 : 2);
  if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0)
    throw new Error("Device scale factor must be positive");
  if (
    options.launchOptions?.args?.some((arg) =>
      arg.startsWith("--force-device-scale-factor"),
    )
  )
    throw new Error(
      "Use deviceScaleFactor instead of a raw device-scale-factor flag",
    );
  const launcher = addExtra(chromium);
  if (options.stealth !== false) {
    launcher.plugins.setDependencyResolution('stealth/evasions/user-agent-override', safeUserAgentOverride);
    const stealth = StealthPlugin();
    // Never let a spoofed GPU string turn a software fallback into a hardware success.
    stealth.enabledEvasions.delete("webgl.vendor");
    // Keep Playwright's configured mobile/custom UA intact.
    if (mobile || options.userAgent)
      stealth.enabledEvasions.delete("user-agent-override");
    launcher.use(stealth);
  }
  let launchingBrowser: Browser | undefined;
  let closeOnAbort: (() => Promise<void>) | undefined;
  const onAbort = () => {
    void (closeOnAbort?.() ?? launchingBrowser?.close())?.catch(() => {});
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let launched: Awaited<ReturnType<typeof launchGpuBrowser>>;
  try {
    launched = await launchGpuBrowser(
      async (launchOptions) => {
        options.signal?.throwIfAborted();
        const browser = await launcher.launch(launchOptions);
        launchingBrowser = browser;
        if (options.signal?.aborted) {
          launchingBrowser = undefined;
          await browser.close().catch(() => {});
          options.signal.throwIfAborted();
        }
        return browser;
      },
      {
        ...options.launchOptions,
        // Match the real compositor DSF to the emulated DPR. Changing emulation's
        // view scale instead produces larger frames but breaks Playwright hit tests.
        args: [
          ...(options.launchOptions?.args ?? []),
          `--force-device-scale-factor=${deviceScaleFactor}`,
        ],
      },
      options.gpu,
    );
  } catch (error) {
    options.signal?.removeEventListener("abort", onAbort);
    await launchingBrowser?.close().catch(() => {});
    options.signal?.throwIfAborted();
    throw error;
  }
  const { browser, gpu } = launched;

  let context: BrowserContext | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    options.signal?.removeEventListener("abort", onAbort);
    closing ??= (async () => {
      let contextError: unknown;
      const contextClosed=Promise.resolve().then(()=>context?.close()).catch(error=>{contextError=error;});
      // A frozen renderer may never acknowledge context.close. Do not let it prevent closing
      // the browser process, and initiate browser shutdown immediately for cancellation.
      try {
        if(!options.signal?.aborted) await Promise.race([contextClosed,delay(1000,undefined,{ref:false})]);
      } finally {await browser.close();}
      if(contextError) throw contextError;
    })();
    return closing;
  };
  closeOnAbort = close;

  try {
    options.signal?.throwIfAborted();
    context = await browser.newContext({
      viewport:
        options.viewport ??
        (mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }),
      deviceScaleFactor,
      userAgent:
        options.userAgent ??
        (mobile ? devices["Pixel 7"]!.userAgent : undefined),
      isMobile: mobile,
      hasTouch: mobile,
      // Playwright sets cookies and each origin's localStorage once, before any page loads.
      // (An init script would write the saved values again on every navigation and undo
      // whatever the app stored since, such as a refreshed token.)
      storageState: options.storageState
        ? {
            cookies: options.storageState.cookies,
            origins: options.storageState.origins,
          }
        : undefined,
    });
    options.signal?.throwIfAborted();

    // tsx (the worker's runtime) wraps named functions in __name(), which then breaks every
    // page.evaluate that defines one. Give pages a no-op __name; a string is never rewritten.
    await context.addInitScript({ content: KEEP_NAMES });
    const page = await context.newPage();
    await page.evaluate(KEEP_NAMES);
    options.signal?.throwIfAborted();
    return {
      formFactor,
      browser,
      context,
      page,
      deviceScaleFactor,
      gpu,
      close,
    };
  } catch (error) {
    // Preserve the setup error, including when a disconnected browser cannot close.
    await close().catch(() => {});
    throw error;
  }
}

/** Worker stages use this helper so failed actions release their browser too. */
export async function withRecorderBrowser<T>(
  options: RecorderBrowserOptions,
  run: (session: RecorderBrowser) => Promise<T>,
): Promise<T> {
  const session = await launchRecorderBrowser(options);
  try {
    return await run(session);
  } finally {
    await session.close();
  }
}
