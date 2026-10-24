/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  launchRecorderBrowser,
  type RecorderBrowser,
  type RecorderBrowserOptions,
} from "@agentcast/recorder";
import {
  Flow,
  ReplayPlan,
  type LocatorStrategy,
  type Target,
} from "@agentcast/shared";
import { accessProblem, diagnosticUrl, productEntry } from "./access";
import { DESTRUCTIVE, hasSecretTarget } from "./normalize";
import type { BrowserAdapter, BrowserOptions } from "./runtime";
import { signInLocally } from "./sign-in";
import { captureLogo } from "./logo";

type Page = RecorderBrowser["page"];
type Locator = ReturnType<Page["getByText"]>;
export class PageAccessError extends Error {
  constructor(
    readonly kind: "blocked" | "sign-in-required" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PageAccessError";
  }
}
export const safeId = (id: string) => {
  if (!/^[a-z0-9_-][a-z0-9_.-]{0,100}$/i.test(id) || id.includes(".."))
    throw new Error("Unsafe artifact identifier.");
  return id;
};

async function pageIssue(page: Page) {
  const state = await page.evaluate(() => {
    const visible = (element: Element) => {
      for (
        let current: Element | null = element;
        current;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        )
          return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const parts: string[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let size = 0;
    while ((node = walk.nextNode()) && size < 4000) {
      const parent = node.parentElement;
      if (
        !parent ||
        /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName) ||
        !visible(parent)
      )
        continue;
      const text = node.textContent?.trim();
      if (text) {
        parts.push(text);
        size += text.length;
      }
    }
    return {
      title: document.title,
      text: parts.join("\n"),
      password: [...document.querySelectorAll("input[type=password]")].some(
        visible,
      ),
      provider: [...document.querySelectorAll("button,a")]
        .filter(visible)
        .some((element) =>
          /^(continue|sign in|sign up|log in) with (google|github|microsoft|apple|email|sso)/i.test(
            element.textContent?.trim() ?? "",
          ),
        ),
    };
  });
  const challenge = accessProblem(
    `${state.title}\n${state.text.length < 2000 ? state.text : ""}`,
  );
  if (challenge?.kind === "blocked")
    throw new PageAccessError("blocked", challenge.message);
  const authPage = /\/(sign-?in|sign-?up|log-?in|register|auth)(\/|$)/i.test(
    new URL(page.url()).pathname,
  );
  if (
    (state.password && (authPage || state.text.length < 1000)) ||
    (state.provider && authPage)
  )
    throw new PageAccessError(
      "sign-in-required",
      "The product entrance requires sign-in. Use sign-in-once for authenticated features.",
    );
  if (
    state.text.trim().length < 20 &&
    !(await page
      .locator("button:visible, input:visible, canvas:visible")
      .count())
  )
    throw new PageAccessError(
      "unavailable",
      "The product page did not render usable content.",
    );
}

async function readyPage(page: Page, signal?: AbortSignal) {
  // DOMContentLoaded can precede a client-rendered app by several seconds.
  const until = Date.now() + 5000;
  for (;;) {
    signal?.throwIfAborted();
    try {
      await pageIssue(page);
      return;
    } catch (error) {
      if (
        !(error instanceof PageAccessError) ||
        error.kind !== "unavailable" ||
        Date.now() >= until
      )
        throw error;
      await delay(150, undefined, { signal });
    }
  }
}

/** A navigation lifecycle timeout alone is not proof that the product failed to open. */
export async function openProduct(
  page: Page,
  url: string,
  authorized: string,
  signal?: AbortSignal,
) {
  const destination = productEntry(url, authorized);
  signal?.throwIfAborted();
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await page.goto(destination, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      if (response && response.status() >= 400)
        throw new PageAccessError(
          response.status() === 401
            ? "sign-in-required"
            : response.status() === 403 || response.status() === 429
              ? "blocked"
              : "unavailable",
          `The product entrance returned HTTP ${response.status()}.`,
        );
      productEntry(page.url(), authorized);
      await readyPage(page, signal);
      return;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof PageAccessError) throw error;
      last = error;
      if (/timeout/i.test((error as Error).message)) {
        try {
          productEntry(page.url(), authorized);
          await readyPage(page, signal);
          return;
        } catch (issue) {
          if (issue instanceof PageAccessError && issue.kind !== "unavailable")
            throw issue;
        }
      } else break;
    }
  }
  throw new PageAccessError(
    "unavailable",
    `The product entrance could not be opened (${(last as Error)?.name ?? "navigation failure"}); no usable page was confirmed.`,
  );
}

export function localBrowserAdapter(
  launch: RecorderBrowserOptions = {},
): BrowserAdapter {
  const withPage = async <T>(
    url: string,
    options: BrowserOptions,
    run: (page: Page) => Promise<T>,
  ) => {
    options.signal?.throwIfAborted();
    const session = await launchRecorderBrowser({
      ...launch,
      deviceScaleFactor: 1,
      storageState: options.storageState,
    });
    const abort = () => void session.close().catch(() => {});
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      options.signal?.throwIfAborted();
      session.page.setDefaultTimeout(6000);
      await openProduct(
        session.page,
        url,
        options.authorizedUrl,
        options.signal,
      );
      return await run(session.page);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      await session.close();
    }
  };
  return {
    signIn: signInLocally,
    readPage: (url, options) =>
      withPage(url, options, async (page) => {
        const read = await page.evaluate(() => ({
          title: document.title,
          description:
            document.querySelector<HTMLMetaElement>("meta[name=description]")
              ?.content ?? null,
          language: document.documentElement.lang || null,
          text: (() => {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            const parts: string[] = [];
            let size = 0;
            let node: Node | null;
            while ((node = walker.nextNode()) && size < 40_000) {
              const parent = node.parentElement;
              if (
                !parent ||
                /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName) ||
                !parent.checkVisibility({
                  checkOpacity: true,
                  checkVisibilityCSS: true,
                })
              )
                continue;
              const text = node.textContent?.trim();
              if (text) {
                parts.push(text);
                size += text.length;
              }
            }
            return parts.join("\n").slice(0, 40_000);
          })(),
          links: [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
            .slice(0, 300)
            .map((link) => link.href),
        }));
        // Inputs aren't included by innerText; common credential tokens in ordinary text are masked too.
        read.text = read.text.replace(
          /\b(sk[-_](?:live[-_]|test[-_]|proj[-_])?[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9_.-]{15,})\b/g,
          "[redacted]",
        );
        return {
          ...read,
          url: diagnosticUrl(url),
          final_url: diagnosticUrl(page.url()),
          latency_ms: null,
        };
      }),
    inspect: (url, options) =>
      withPage(url, options, async (page) => {
        const data = await page.evaluate(() => {
          const shown = (element: Element) => {
            const rect = element.getBoundingClientRect();
            for (
              let current: Element | null = element;
              current;
              current = current.parentElement
            ) {
              const style = getComputedStyle(current);
              if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                Number(style.opacity) === 0
              )
                return false;
            }
            return rect.width > 2 && rect.height > 2;
          };
          const name = (element: Element) =>
            (element.getAttribute("aria-label") || element.textContent || "")
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 100);
          const button = [
            ...document.querySelectorAll("button, [role=button]"),
          ].filter(shown);
          const links = [
            ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
          ].filter(shown);
          const heading = document.querySelector("h1");
          const background =
            [document.body, document.documentElement]
              .map((element) => getComputedStyle(element).backgroundColor)
              .find(
                (color) =>
                  color !== "rgba(0, 0, 0, 0)" && color !== "transparent",
              ) || "#ffffff";
          const gradient = [
            ...document.querySelectorAll("main,header,section,body,body>div"),
          ]
            .filter(shown)
            .map((element) => ({
              style: getComputedStyle(element).backgroundImage,
              area:
                element.getBoundingClientRect().width *
                element.getBoundingClientRect().height,
            }))
            .filter((value) => /gradient\(/.test(value.style))
            .sort((a, b) => b.area - a.area)[0]
            ?.style.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi)
            ?.slice(0, 4);
          return {
            facts: {
              url: location.href,
              title: document.title,
              heading: heading?.textContent?.trim(),
              height: document.documentElement.scrollHeight,
              viewport: innerHeight,
              links: links.slice(0, 150).map((link) => ({
                text: name(link),
                href: link.href,
                inNav: Boolean(link.closest("header,nav,[role=navigation]")),
              })),
              tabs: [...document.querySelectorAll("[role=tab]")]
                .filter(shown)
                .map(name),
              buttons: button.slice(0, 60).map(name),
            },
            colors: {
              background,
              text: getComputedStyle(heading ?? document.body).color,
            },
            gradient,
            samples: [
              {
                color:
                  document.querySelector<HTMLMetaElement>(
                    'meta[name="theme-color"]',
                  )?.content || "",
                weight: 100,
                from: "theme-color" as const,
              },
              ...button.slice(0, 40).map((element) => ({
                color: getComputedStyle(element).backgroundColor,
                weight: 20,
                from: "buttons" as const,
              })),
              ...links.slice(0, 40).map((element) => ({
                color: getComputedStyle(element).color,
                weight: 1,
                from: "links" as const,
              })),
            ],
            fonts: {
              display: getComputedStyle(heading ?? document.body).fontFamily,
              text: getComputedStyle(document.body).fontFamily,
            },
            radius:
              parseFloat(
                button[0] ? getComputedStyle(button[0]).borderRadius : "8",
              ) || 0,
          };
        });
        data.facts.url = productEntry(data.facts.url, options.authorizedUrl);
        let hero: string | undefined;
        let logo: Awaited<ReturnType<typeof captureLogo>>;
        if (!options.storageState) {
          await mkdir(join(options.dir, "brief"), { recursive: true });
          hero = "brief/hero.jpg";
          try {
            await page.screenshot({
              path: join(options.dir, hero),
              type: "jpeg",
              quality: 75,
              mask: [page.locator("input,textarea,[contenteditable=true]")],
            });
          } catch {
            options.signal?.throwIfAborted();
            hero = undefined;
          }
          logo = await captureLogo(page, options.dir);
        }
        return { ...data, hero, logo };
      }),
    rehearse: async (source, options) => {
      const flow = Flow.parse(source);
      safeId(flow.id);
      flow.steps.forEach((step) => safeId(step.id));
      if (flow.steps.some(hasSecretTarget))
        return {
          flow: {
            ...flow,
            selected: false,
            rehearsal: {
              ok: false,
              reason:
                "A secret-bearing step cannot be replayed from a public report. Use sign-in-once and omit login steps.",
            },
          },
        };
      if (
        flow.steps.some((step) =>
          DESTRUCTIVE.test(
            [step.target?.text, step.target?.label, step.narrationHint]
              .filter(Boolean)
              .join(" "),
          ),
        )
      )
        return {
          flow: {
            ...flow,
            selected: false,
            rehearsal: {
              ok: false,
              reason:
                "Outward-facing and destructive actions are excluded from automatic rehearsal.",
            },
          },
        };
      const replay = ReplayPlan.parse({
        schemaVersion: 1,
        byFormFactor: { desktop: {} },
      });
      try {
        return await withPage(flow.startUrl, options, async (page) => {
          const started = Date.now();
          const steps = [];
          for (const step of flow.steps) {
            options.signal?.throwIfAborted();
            const before = await page.locator("body").innerText();
            const beforeUrl = page.url();
            let target: Awaited<ReturnType<typeof resolveSemantic>> | undefined;
            if (step.target)
              target = await resolveSemantic(page, step.target, options.signal);
            if (
              ["click", "type", "select", "hover"].includes(step.action) &&
              !target
            )
              throw new Error(
                `Step ${step.id}: no unique visible element matched.`,
              );
            if (target)
              replay.byFormFactor.desktop![`${flow.id}.${step.id}`] = {
                strategy: target.strategy,
                locator: target.selector,
                lastOk: new Date().toISOString(),
              };
            switch (step.action) {
              case "navigate":
                await openProduct(
                  page,
                  step.value || flow.startUrl,
                  options.authorizedUrl,
                  options.signal,
                );
                break;
              case "click":
                await target!.locator.click();
                break;
              case "type":
                await target!.locator.fill(step.value ?? "");
                break;
              case "select":
                await target!.locator.selectOption(step.value ?? "");
                break;
              case "hover":
                await target!.locator.hover();
                break;
              case "press":
                if (target) await target.locator.press(step.value || "Enter");
                else await page.keyboard.press(step.value || "Enter");
                break;
              case "scroll": {
                const distance = Number(step.value ?? "600");
                if (!Number.isFinite(distance) || Math.abs(distance) > 10000)
                  throw new Error("Invalid scroll distance.");
                await page.mouse.wheel(0, distance);
                break;
              }
              case "wait":
                await delay(
                  Math.min(2000, Math.max(0, Number(step.value) * 1000 || 0)),
                  undefined,
                  { signal: options.signal },
                );
                break;
            }
            productEntry(page.url(), options.authorizedUrl);
            await delay(150, undefined, { signal: options.signal });
            await pageIssue(page);
            for (const check of step.expect ?? []) {
              if (check.type === "text")
                await page
                  .getByText(check.text, { exact: check.match === "exact" })
                  .filter({ visible: true })
                  .first()
                  .waitFor({ state: "visible", timeout: 5000 });
              if (check.type === "element")
                await page
                  .getByRole(check.role as "button", {
                    name: check.name,
                    exact: true,
                  })
                  .waitFor({ state: "visible", timeout: 5000 });
              if (check.type === "url" && !page.url().includes(check.pattern))
                throw new Error(`Step ${step.id}: expected URL did not match.`);
              if (
                check.type === "changed" &&
                beforeUrl === page.url() &&
                before === (await page.locator("body").innerText())
              )
                throw new Error(`Step ${step.id}: the page did not change.`);
              if (check.type === "value") {
                const field = await resolveSemantic(
                  page,
                  { label: check.target, placeholder: check.target },
                  options.signal,
                );
                if (
                  !field ||
                  (await field.locator.inputValue()) !== check.value
                )
                  throw new Error(
                    `Step ${step.id}: expected value did not match.`,
                  );
              }
            }
            const next = { ...step };
            if (!options.storageState) {
              const frame = `explore/frames/${flow.id}/${step.id}.jpg`;
              await mkdir(join(options.dir, "explore/frames", flow.id), {
                recursive: true,
              });
              await page.screenshot({
                path: join(options.dir, frame),
                type: "jpeg",
                quality: 70,
                mask: [page.locator("input,textarea,[contenteditable=true]")],
              });
              next.frame = frame;
            }
            steps.push(next);
          }
          return {
            flow: Flow.parse({
              ...flow,
              steps,
              rehearsal: { ok: true, seconds: (Date.now() - started) / 1000 },
            }),
            replay,
          };
        });
      } catch (error) {
        options.signal?.throwIfAborted();
        return {
          flow: {
            ...flow,
            selected: false,
            rehearsal: {
              ok: false,
              reason:
                error instanceof PageAccessError
                  ? error.message
                  : "A reported step or its expected result could not be replayed uniquely in a fresh browser.",
            },
          },
          replay,
        };
      }
    },
  };
}

async function resolveSemantic(
  page: Page,
  target: Target,
  signal?: AbortSignal,
): Promise<
  { locator: Locator; selector: string; strategy: LocatorStrategy } | undefined
> {
  const candidates: Array<{
    locator: Locator;
    selector: string;
    strategy: LocatorStrategy;
  }> = [];
  if (target.role) {
    const role = target.role as "button";
    const name = target.text || target.label;
    if (name)
      candidates.push({
        locator: page.getByRole(role, { name, exact: true }),
        selector: `role=${target.role}[name=${JSON.stringify(name)}]`,
        strategy: "role",
      });
  }
  if (target.label)
    candidates.push({
      locator: page.getByLabel(target.label, { exact: true }),
      selector: `label=${JSON.stringify(target.label)}`,
      strategy: "label",
    });
  if (target.placeholder)
    candidates.push({
      locator: page.getByPlaceholder(target.placeholder, { exact: true }),
      selector: `placeholder=${JSON.stringify(target.placeholder)}`,
      strategy: "placeholder",
    });
  if (target.text)
    candidates.push({
      locator: page.getByText(target.text, { exact: true }),
      selector: `text=${JSON.stringify(target.text)}`,
      strategy: "text",
    });
  for (let attempt = 0; attempt < 8; attempt++) {
    signal?.throwIfAborted();
    for (const candidate of candidates) {
      const visible = candidate.locator.filter({ visible: true });
      if ((await visible.count()) === 1)
        return { ...candidate, locator: visible };
    }
    await delay(250, undefined, { signal });
  }
  return undefined;
}
