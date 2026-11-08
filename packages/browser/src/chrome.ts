/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import {
  chromium,
  type BrowserContext,
  type LaunchOptions,
} from "playwright-core";
import {
  launchGpuBrowser,
  type GpuInfo,
  type GpuPreference,
} from "@agentcast/recorder/gpu";

type PersistentOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

export interface ExplorationChromeOptions {
  /** Auto verifies dGPU, then iGPU, then CPU; routing and probes belong to the recorder. */
  gpu?: GpuPreference;
  launchOptions?: LaunchOptions;
  /** Viewport, video capture, permissions, etc. Profile location is always userDataDir. */
  contextOptions?: Omit<PersistentOptions, keyof LaunchOptions>;
  signal?: AbortSignal;
}

/** Owns a persistent Chrome process, never attaches to the user's browser.
 * The caller supplies an isolated profile and any video/CDP flags, and closes context in finally.
 * Verification happens in a separate, empty context before any site credentials are restored.
 */
export async function launchExplorationChrome(
  userDataDir: string,
  options: ExplorationChromeOptions = {},
): Promise<{ context: BrowserContext; gpu: GpuInfo }> {
  if (!userDataDir.trim())
    throw new Error("An isolated Chrome profile directory is required");
  const { signal } = options;
  signal?.throwIfAborted();
  const owned = new Set<BrowserContext>();
  const closing = new WeakMap<BrowserContext, Promise<void>>();
  const close = (context: BrowserContext): Promise<void> => {
    let pending = closing.get(context);
    if (!pending) {
      pending = context.close().catch(() => {});
      closing.set(context, pending);
    }
    return pending;
  };
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    for (const context of owned) void close(context);
    rejectAbort?.(signal!.reason);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  let selected: BrowserContext | undefined;
  try {
    signal?.throwIfAborted();
    // Reuse the recorder's channel selection, bounded launches/probes, verified adapter
    // matching and fallback. Only adapt its browser factory to persistent contexts.
    const work = launchGpuBrowser(
      async (launchOptions) => {
        signal?.throwIfAborted();
        const context = await chromium.launchPersistentContext(userDataDir, {
          ...options.contextOptions,
          ...launchOptions,
          headless: options.launchOptions?.headless ?? launchOptions.headless,
        });
        owned.add(context);
        context.once("close", () => {
          owned.delete(context);
          if (context === selected)
            signal?.removeEventListener("abort", onAbort);
        });
        // A launch may finish after cancellation; close this late process as well.
        if (signal?.aborted) {
          void close(context);
          signal.throwIfAborted();
        }
        const browser = context.browser();
        if (!browser) {
          void close(context);
          throw new Error("Persistent Chrome did not expose its owned browser");
        }
        return browser;
      },
      options.launchOptions,
      options.gpu,
    );
    const { browser, gpu } = await Promise.race([work, aborted]);
    signal?.throwIfAborted();
    selected = [...owned].find((context) => context.browser() === browser);
    if (!selected)
      throw new Error("Verified Chrome context closed before handoff");
    // tsx preserves function names inside trusted page.evaluate callbacks using this helper.
    // Match the recorder's page environment so production CLI runs behave like rehearsal/tests.
    const keepNames = "globalThis.__name ??= (target) => target;";
    await selected.addInitScript({ content: keepNames });
    for (const page of selected.pages()) await page.evaluate(keepNames);
    return { context: selected, gpu };
  } catch (error) {
    signal?.removeEventListener("abort", onAbort);
    for (const context of owned) void close(context);
    signal?.throwIfAborted();
    throw error;
  }
}
