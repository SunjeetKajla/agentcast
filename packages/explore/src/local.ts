/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  launchRecorderBrowser,
  replayKey,
  serializeLocator,
  snapshotOutcome,
  type SemanticLocator,
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
  // DOMContentLoaded can precede a client-rendered app by a long way: Linear's public demo shows
  // "Loading…" for ~15 s and its workspace at ~25 s. A page that renders returns at once.
  const until = Date.now() + 30_000;
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
      }
      // Any other navigation error (an aborted load, a dropped connection) gets one more try.
      await delay(1000, undefined, { signal });
    }
  }
  const reason = (last as Error | undefined)?.message
    ?.split("\n")[0]
    ?.slice(0, 160);
  throw new PageAccessError(
    "unavailable",
    `The product entrance could not be opened (${reason || "navigation failure"}); no usable page was confirmed.`,
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
          const dropped: string[] = [];
          for (const step of flow.steps) {
            options.signal?.throwIfAborted();
            const before = await page.locator("body").innerText();
            const beforeUrl = page.url();
            let target: Awaited<ReturnType<typeof resolveSemantic>> | undefined;
            // The first step waits for the app to finish building (Linear's demo takes ~25 s);
            // later ones allow for a client-side navigation.
            if (step.target)
              target = await resolveSemantic(
                page,
                step.target,
                options.signal,
                step === flow.steps[0] ? 30_000 : 8000,
              );
            if (
              ["click", "type", "select", "hover"].includes(step.action) &&
              !target
            )
              throw new Error(
                `Step ${step.id}: no unique visible element matched.`,
              );
            if (target)
              // The recorder's key and locator format, so it tries first what replayed here.
              replay.byFormFactor.desktop![replayKey(step.id, flow.id)] = {
                strategy: target.strategy,
                locator: serializeLocator(target.spec),
                lastOk: new Date().toISOString(),
              };
            // A click with no stated outcome must change the page, as the recorder will demand.
            const shape =
              step.action === "click" && !step.expect?.length
                ? await snapshotOutcome(page, [])
                : undefined;
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
                // The recorder scrolls the window only. A page whose window can't move that way
                // (an app that scrolls an inner panel, or already at the end) would fail every
                // take, so the scroll is left out of the flow.
                if (!step.target) {
                  const room = await page.evaluate(
                    (d) =>
                      d > 0
                        ? document.documentElement.scrollHeight -
                          innerHeight -
                          scrollY
                        : scrollY,
                    distance,
                  );
                  if (room < 40) {
                    dropped.push(step.id);
                    continue;
                  }
                }
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
            // A click that changes nothing (a toast that ignores clicks and closes on its own) adds
            // nothing to a video and would fail every recording take: leave it out of the flow.
            if (shape && !(await pageChanged(page, shape, options.signal))) {
              dropped.push(step.id);
              continue;
            }
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
          if (!steps.some((s) => !["wait", "navigate"].includes(s.action)))
            throw new Error(
              `Step ${dropped[0] ?? flow.steps[0]?.id}: the page did not change.`,
            );
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
              // Our own step messages say which step failed and how; anything else (a browser
              // error that may quote page content) stays generic.
              reason:
                error instanceof PageAccessError ||
                /^Step [\w-]+: /.test((error as Error).message)
                  ? (error as Error).message
                  : "A reported step or its expected result could not be replayed uniquely in a fresh browser.",
            },
          },
          replay,
        };
      }
    },
  };
}

/** Whether the page (its URL or the recorder's outcome signature) changes within 2.5 s. */
async function pageChanged(
  page: Page,
  before: Awaited<ReturnType<typeof snapshotOutcome>>,
  signal?: AbortSignal,
): Promise<boolean> {
  const until = Date.now() + 2500;
  for (;;) {
    const after = await snapshotOutcome(page, []);
    if (after.url !== before.url || after.signature !== before.signature)
      return true;
    if (Date.now() >= until) return false;
    await delay(200, undefined, { signal });
  }
}

/**
 * The one visible element a target names, by role, label, placeholder or exact text, retried until
 * `waitMs` passes: a client-rendered app can still be building its UI when the page counts as loaded.
 */
async function resolveSemantic(
  page: Page,
  target: Target,
  signal?: AbortSignal,
  waitMs = 2000,
): Promise<
  | { locator: Locator; spec: SemanticLocator; strategy: LocatorStrategy }
  | undefined
> {
  const specs: SemanticLocator[] = [];
  const name = target.text || target.label;
  if (target.role && name)
    specs.push({ kind: "role", role: target.role as "button", name });
  if (target.label) specs.push({ kind: "label", name: target.label });
  if (target.placeholder)
    specs.push({ kind: "placeholder", name: target.placeholder });
  if (target.text) specs.push({ kind: "text", name: target.text });
  // Agents mix up links and buttons (Linear's sidebar "Agent" is a link reported as a button,
  // beside two real "Agent" buttons): the same name under another clickable role, if unique.
  if (target.role && name)
    for (const role of ["link", "button", "tab", "menuitem"] as const)
      if (role !== target.role) specs.push({ kind: "role", role, name });
  const candidates = specs.map((spec) => ({
    spec,
    strategy: spec.kind as LocatorStrategy,
    locator:
      spec.kind === "role"
        ? page.getByRole(spec.role, { name: spec.name, exact: true })
        : spec.kind === "label"
          ? page.getByLabel(spec.name, { exact: true })
          : spec.kind === "placeholder"
            ? page.getByPlaceholder(spec.name, { exact: true })
            : page.getByText(spec.name, { exact: true }),
  }));
  const until = Date.now() + waitMs;
  for (;;) {
    signal?.throwIfAborted();
    for (const candidate of candidates) {
      const visible = candidate.locator.filter({ visible: true });
      if ((await visible.count()) === 1)
        return { ...candidate, locator: visible };
    }
    if (Date.now() >= until) return undefined;
    await delay(250, undefined, { signal });
  }
}
