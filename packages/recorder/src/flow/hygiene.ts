import type { Locator, Page } from "playwright-core";
import { abortable } from "./control.ts";

export interface HygieneOptions {
  secretValues?: readonly string[];
  redactSelectors?: readonly string[];
  dismissCookies?: boolean;
  signal?: AbortSignal;
}
type Config = { secretValues: string[]; selectors: string[] };

/** Runs before website scripts on every document. Keep all helpers inside for serialization. */
function install(config: Config) {
  const key = "__agentcastHygiene";
  const host = window as unknown as Record<string, { dispose(): void }>;
  host[key]?.dispose();
  const style = document.createElement("style");
  style.setAttribute("data-agentcast-style", "");
  style.textContent =
    "*{caret-color:transparent!important;scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}[data-agentcast-redact]{filter:blur(12px)!important;color:transparent!important;text-shadow:none!important}";
  const sensitive =
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:sk-[\w-]{8,}|(?:tf|el)[_-][\w-]{8,}|eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?)\b/i;
  const selector = [
    'input[type="password"]',
    'input[type="email"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]',
    "[data-secret]",
    "[data-agentcast-secret]",
    'input[name*="token" i]',
    'input[name*="api_key" i]',
    ...config.selectors,
  ].join(",");
  let queued = false;
  const privateText = (text: string) =>
    sensitive.test(text) ||
    config.secretValues.some((value) => value && text.includes(value));
  const mark = (element: Element) => {
    if (!element.hasAttribute("data-agentcast-redact"))
      element.setAttribute("data-agentcast-redact", "");
  };
  const scan = () => {
    queued = false;
    if (!style.isConnected && document.documentElement)
      document.documentElement.append(style);
    document.querySelectorAll(selector).forEach(mark);
    for (const input of document.querySelectorAll("input,textarea"))
      if (privateText((input as HTMLInputElement).value)) mark(input);
    if (!document.body) return;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement;
      if (
        parent &&
        !parent.closest("script,style,noscript,textarea") &&
        privateText(node.textContent ?? "")
      )
        mark(parent);
    }
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      queueMicrotask(scan);
    }
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type !== "attributes" ||
          !record.attributeName?.startsWith("data-agentcast-"),
      )
    )
      queue();
  });
  observer.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  document.addEventListener("input", scan, true);
  scan();
  host[key] = {
    dispose() {
      observer.disconnect();
      document.removeEventListener("input", scan, true);
      style.remove();
    },
  };
}

export async function installRecordingHygiene(
  page: Page,
  options: HygieneOptions = {},
) {
  options.signal?.throwIfAborted();
  const config: Config = {
    secretValues: [...(options.secretValues ?? [])].filter(Boolean),
    selectors: [...(options.redactSelectors ?? [])],
  };
  const valid = await page.evaluate(
    (selectors) =>
      selectors.every((selector) => {
        try {
          document.querySelector(selector);
          return true;
        } catch {
          return false;
        }
      }),
    config.selectors,
  );
  if (!valid) throw new Error("Invalid recording redaction selector");
  await page.context().addInitScript(install, config);
  await page.evaluate(install, config);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return {
    async mask(locator: Locator) {
      await locator.evaluate(
        (element) => element.setAttribute("data-agentcast-redact", ""),
        undefined,
        { timeout: 1000 },
      );
    },
    async ready() {
      options.signal?.throwIfAborted();
      await page.evaluate(() =>
        Promise.race([
          document.fonts.ready.then(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]),
      );
      if (options.dismissCookies !== false) await dismissCookieBanner(page);
      options.signal?.throwIfAborted();
    },
  };
}

export async function dismissCookieBanner(page: Page): Promise<boolean> {
  const buttons = page.getByRole("button", {
    name: /^(accept (?:all )?cookies|allow all cookies|accept all)$/i,
  });
  const count = Math.min(await buttons.count(), 20);
  const safe: Locator[] = [];
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (
      !(await button.isVisible()) ||
      !(await button.isEnabled({ timeout: 300 }))
    )
      continue;
    const context = await button.evaluate(
      (element) => {
        const explicit = /cookies/i.test(element.textContent ?? "");
        const parent = element.closest(
          '[role="dialog"],[role="banner"],dialog,aside,[id*="cookie" i],[class*="cookie" i],[id*="consent" i]',
        );
        return (
          explicit ||
          (!!parent && /cookie|consent|privacy/i.test(parent.textContent ?? ""))
        );
      },
      undefined,
      { timeout: 300 },
    );
    if (context) safe.push(button);
  }
  if (safe.length !== 1) return false;
  await safe[0]!.click({ timeout: 1000 });
  return true;
}

export async function maskedScreenshot(
  page: Page,
  secretValues: readonly string[],
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  const work = page.screenshot({
    type: "png",
    timeout: 2000,
    mask: [
      page.locator(
        'input,textarea,[contenteditable="true"],[data-agentcast-redact]',
      ),
      ...secretValues
        .filter(Boolean)
        .map((value) => page.getByText(value, { exact: false })),
    ],
  });
  return signal ? abortable(work, signal) : work;
}
