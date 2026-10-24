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

export type FormFactor = "desktop" | "mobile";

/** In-memory Playwright state; loading/decrypting session artifacts belongs to the worker. */
export type RecorderStorageState = Pick<
  Exclude<NonNullable<BrowserContextOptions["storageState"]>, string>,
  "cookies" | "origins"
>;

export interface RecorderBrowserOptions {
  formFactor?: FormFactor;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  storageState?: RecorderStorageState;
  /** Default auto: dGPU, then iGPU, then verified CPU software rendering. */
  gpu?: GpuPreference;
  /** Puppeteer Extra's stealth plugin, enabled by default. */
  stealth?: boolean;
  /** Bundled Chromium is the default; an explicit executable can be used for local checks. */
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
  gpu: GpuInfo;
  /** Safe to call repeatedly, including from competing cleanup paths. */
  close(): Promise<void>;
}

/** Each call owns a separate headless browser, context and page. */
export async function launchRecorderBrowser(
  options: RecorderBrowserOptions = {},
): Promise<RecorderBrowser> {
  const formFactor = options.formFactor ?? "desktop";
  const mobile = formFactor === "mobile";
  const launcher = addExtra(chromium);
  if (options.stealth !== false) {
    const stealth = StealthPlugin();
    // Never let a spoofed GPU string turn a software fallback into a hardware success.
    stealth.enabledEvasions.delete("webgl.vendor");
    // Keep Playwright's configured mobile/custom UA intact.
    if (mobile || options.userAgent)
      stealth.enabledEvasions.delete("user-agent-override");
    launcher.use(stealth);
  }
  const { browser, gpu } = await launchGpuBrowser(
    (launchOptions) => launcher.launch(launchOptions),
    options.launchOptions,
    options.gpu,
  );

  let context: BrowserContext | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        await context?.close();
      } finally {
        await browser.close();
      }
    })();
    return closing;
  };

  try {
    context = await browser.newContext({
      viewport:
        options.viewport ??
        (mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }),
      deviceScaleFactor: options.deviceScaleFactor ?? (mobile ? 3 : 2),
      userAgent:
        options.userAgent ??
        (mobile ? devices["Pixel 7"]!.userAgent : undefined),
      isMobile: mobile,
      hasTouch: mobile,
    });

    if (options.storageState) {
      await context.addCookies(options.storageState.cookies);
      await context.addInitScript(
        (origins: RecorderStorageState["origins"]) => {
          const state = origins.find(
            ({ origin }) => origin === window.location.origin,
          );
          if (!state) return;
          for (const { name, value } of state.localStorage) {
            window.localStorage.setItem(name, value);
          }
        },
        options.storageState.origins,
      );
    }

    const page = await context.newPage();
    return { formFactor, browser, context, page, gpu, close };
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
