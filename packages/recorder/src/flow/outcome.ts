import { setTimeout as delay } from "node:timers/promises";
import type { Expectation, Step } from "@agentcast/shared";
import type { Locator, Page } from "playwright-core";
import { abortable } from "./control.ts";
import { redactor } from "./heal.ts";
import { isAriaRole } from "./semantic.ts";

export interface OutcomeState {
  url: string;
  aria: string;
  signature: string;
  landmarks: { role: string; name: string }[];
}
export interface OutcomeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
  secretValues?: readonly string[];
  learned?: Expectation[];
  locator?: Locator;
  /** Canonical option value resolved before selecting, including selection by visible label. */
  selectedValue?: string;
  onObservation?: (state: OutcomeState) => void;
}
export class OutcomeError extends Error {
  readonly code = "flow.outcome";
  constructor(
    public readonly failures: string[],
    public readonly after: OutcomeState,
  ) {
    super(`Outcome failed: ${failures.join("; ")}`);
    this.name = "OutcomeError";
  }
}

/** Mask values in memory too: this state can subsequently become model repair context. */
export async function snapshotOutcome(
  page: Page,
  secrets: readonly string[] = [],
): Promise<OutcomeState> {
  const redact = redactor(secrets);
  const [aria, state] = await Promise.all([
    page.locator("body").ariaSnapshot({ timeout: 1000 }),
    page.evaluate(() => {
      const visible = (element: Element) => {
        const box = element.getBoundingClientRect(),
          style = getComputedStyle(element);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity) !== 0
        );
      };
      const ignored = (element: Element) =>
        !!element.closest(
          'script,style,noscript,time,input[type="password"],input[type="email"],[autocomplete="current-password"],[autocomplete="new-password"],[data-secret],[data-agentcast-secret],[role="timer"],[role="progressbar"],[aria-busy="true"],[data-agentcast-style],[data-agentcast-redact],[class*="spinner" i],[class*="loading" i]',
        );
      const normalize = (text: string) =>
        text
          .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "[time]")
          .replace(/\b\d+\s*(?:seconds?|minutes?)\s+ago\b/gi, "[time]")
          .replace(/\s+/g, " ")
          .trim();
      const signature: string[] = [],
        landmarks: { role: string; name: string }[] = [];
      for (const element of Array.from(
        document.querySelectorAll("body *"),
      ).slice(0, 10000)) {
        if (!visible(element) || ignored(element)) continue;
        const text = normalize(
          element.getAttribute("aria-label") || element.textContent || "",
        ).slice(0, 512);
        const role =
          element.getAttribute("role") ||
          (/^H[1-6]$/.test(element.tagName)
            ? "heading"
            : element.tagName === "DIALOG"
              ? "dialog"
              : "");
        // Leaf text avoids counting a spinner's text again through every ancestor.
        if (
          !element.children.length &&
          text &&
          !/^(?:loading|please wait|\d+%)\.*$/i.test(text)
        )
          signature.push(`${element.tagName}:${text}`);
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )
          signature.push(
            `${element.tagName}:${element.value}:${element instanceof HTMLInputElement ? element.checked : ""}`,
          );
        if (
          ["heading", "dialog", "alert", "status"].includes(role) &&
          text &&
          text.length <= 160
        )
          landmarks.push({ role, name: text });
        if (
          element.getAttribute("aria-expanded") ||
          element.getAttribute("aria-pressed") ||
          element.getAttribute("aria-checked") ||
          element.getAttribute("aria-selected")
        )
          signature.push(
            `${text}:${element.getAttribute("aria-expanded")}:${element.getAttribute("aria-pressed")}:${element.getAttribute("aria-checked")}:${element.getAttribute("aria-selected")}`,
          );
        // Count semantic nodes, including identical unnamed list items and controls.
        if (
          role ||
          [
            "LI",
            "UL",
            "OL",
            "BUTTON",
            "SELECT",
            "DETAILS",
            "DIALOG",
            "IMG",
          ].includes(element.tagName)
        )
          signature.push(
            `node:${element.tagName}:${role}:${element.getAttribute("aria-label") ?? ""}:${element instanceof HTMLDetailsElement ? element.open : ""}`,
          );
        if (
          element.scrollHeight > element.clientHeight ||
          element.scrollWidth > element.clientWidth
        )
          signature.push(`scroll:${element.scrollLeft},${element.scrollTop}`);
      }
      // Scroll is a meaningful outcome of a scroll action, but pointer movement/focus is not.
      signature.push(`scroll:${scrollX},${scrollY}`);
      return { signature: signature.join("\n"), landmarks };
    }),
  ]);
  return {
    url: redact(page.url()),
    aria: redact(
      aria.replace(
        /(^[^\n]*\b(?:textbox|searchbox|combobox|spinbutton)\b[^\n]*?):[^\n]*/gm,
        "$1: [redacted-value]",
      ),
    ).slice(0, 64000),
    signature: redact(state.signature),
    landmarks: state.landmarks.filter(
      (item) =>
        redact(item.name) === item.name && !item.name.includes("[redacted"),
    ),
  };
}

/** Escaped glob matching via an NFA: '*' stays in a segment, '**' crosses '/'. */
export function matchesUrl(pattern: string, actual: string): boolean {
  let value: string;
  try {
    const url = new URL(actual);
    value = pattern.includes("://")
      ? url.href
      : url.pathname +
        (pattern.includes("?") ? url.search : "") +
        (url.hash.startsWith("#/") || pattern.includes("#")
          ? pattern.includes("?")
            ? url.hash
            : url.hash.split("?")[0]!
          : "");
  } catch {
    value = actual;
  }
  // Bound untrusted patterns; no regex evaluation or exponential wildcard backtracking.
  if (pattern.length > 16384 || value.length > 65536) return false;
  const tokens = Array.from(pattern.matchAll(/\*{2,}|\*|[^*]/gu), (match) =>
    match[0].startsWith("**") ? "**" : match[0],
  );
  const closure = (states: Set<number>) => {
    for (const state of states)
      if (tokens[state] === "*" || tokens[state] === "**")
        states.add(state + 1);
    return states;
  };
  const match = (candidate: string) => {
    let states = closure(new Set([0]));
    for (const char of candidate) {
      const next = new Set<number>();
      for (const state of states) {
        const token = tokens[state];
        if (token === "**" || (token === "*" && char !== "/")) next.add(state);
        else if (token === char) next.add(state + 1);
      }
      states = closure(next);
      if (!states.size) return false;
    }
    return states.has(tokens.length);
  };
  return (
    match(value) ||
    (value.endsWith("/") && !pattern.endsWith("/") && match(value.slice(0, -1)))
  );
}

export function learnedUrl(actual: string): string {
  const url = new URL(actual);
  // Keep SPA hash routes, omitting query values from both router styles.
  const route =
    url.pathname + (url.hash.startsWith("#/") ? url.hash.split("?")[0]! : "");
  return route
    .split("/")
    .map((part) =>
      /^(?:\d+|[\da-f]{8}-[\da-f-]{27,}|[\da-f]{12,})$/i.test(part)
        ? "*"
        : part,
    )
    .join("/");
}

async function visibleInViewport(locator: Locator): Promise<boolean> {
  const count = Math.min(await locator.count(), 100);
  for (let i = 0; i < count; i++) {
    if (
      await locator
        .nth(i)
        .evaluate(
          (element) => {
            const b = element.getBoundingClientRect(),
              s = getComputedStyle(element);
            return (
              b.width > 0 &&
              b.height > 0 &&
              b.bottom > 0 &&
              b.right > 0 &&
              b.top < innerHeight &&
              b.left < innerWidth &&
              s.visibility !== "hidden" &&
              s.display !== "none" &&
              Number(s.opacity) !== 0
            );
          },
          undefined,
          { timeout: 300 },
        )
        .catch(() => false)
    )
      return true;
  }
  return false;
}

async function controlValue(locator: Locator): Promise<string | undefined> {
  if ((await locator.count()) !== 1) return undefined;
  return locator
    .evaluate(
      (element) => {
        if (
          element instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(element.type)
        )
          return String(element.checked);
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )
          return element.value;
        if (element instanceof HTMLElement && element.isContentEditable)
          return element.innerText;
        return undefined;
      },
      undefined,
      { timeout: 300 },
    )
    .catch(() => undefined);
}

async function check(
  page: Page,
  expectation: Expectation,
  before: OutcomeState,
  after: OutcomeState,
  options: OutcomeOptions,
  step: Step,
): Promise<boolean> {
  switch (expectation.type) {
    case "url":
      return matchesUrl(expectation.pattern, page.url());
    case "changed":
      return before.url !== after.url || before.signature !== after.signature;
    case "text":
      return visibleInViewport(
        expectation.match === "exact"
          ? page.getByText(expectation.text, { exact: true })
          : page.getByText(
              new RegExp(
                expectation.text
                  .trim()
                  .split(/\s+/)
                  .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                  .join("\\s+"),
                "i",
              ),
            ),
      );
    case "element":
      return (
        isAriaRole(expectation.role) &&
        visibleInViewport(
          page.getByRole(expectation.role, {
            name: expectation.name,
            exact: true,
          }),
        )
      );
    case "value": {
      const byLabel = page.getByLabel(expectation.target, { exact: true });
      const sameTarget = [
        step.target?.label,
        step.target?.text,
        step.target?.placeholder,
        "",
      ].includes(expectation.target);
      const locator =
        (await byLabel.count()) === 1
          ? byLabel
          : sameTarget
            ? options.locator
            : undefined;
      return !!locator && (await controlValue(locator)) === expectation.value;
    }
  }
}

function description(check: Expectation): string {
  switch (check.type) {
    case "url":
      return `expected URL ${JSON.stringify(check.pattern)}`;
    case "text":
      return `expected visible text ${JSON.stringify(check.text)}`;
    case "element":
      return `expected ${check.role} ${JSON.stringify(check.name)}`;
    case "value":
      return `expected value for ${JSON.stringify(check.target)}`;
    case "changed":
      return "expected a meaningful page change";
  }
}

export async function verifyOutcome(
  page: Page,
  step: Step,
  before: OutcomeState,
  options: OutcomeOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 5000,
    pollMs = options.pollMs ?? 100;
  if (![timeoutMs, pollMs].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("Invalid outcome budget");
  const secrets = [
    ...(options.secretValues ?? []),
    ...(step.secret && step.value ? [step.value] : []),
  ];
  const redact = redactor(secrets);
  const implied: Expectation[] =
    (step.action === "type" || step.action === "select") &&
    step.value !== undefined
      ? [
          {
            type: "value",
            target:
              step.target?.label ??
              step.target?.text ??
              step.target?.placeholder ??
              "",
            value: options.selectedValue ?? step.value,
          },
        ]
      : [];
  const selected = options.learned?.length
    ? options.learned
    : step.expect?.length
      ? step.expect
      : implied.length
        ? implied
        : ["wait", "hover"].includes(step.action)
          ? []
          : [{ type: "changed" } as const];
  // Stronger checks never replace action correctness: a visible heading cannot hide a rejected input.
  const expectations = [
    ...selected,
    ...implied.filter(
      (item) =>
        !selected.some((s) => JSON.stringify(s) === JSON.stringify(item)),
    ),
  ];
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  let after = before,
    failures = expectations.map((item) => redact(description(item)));
  try {
    while (true) {
      options.signal?.throwIfAborted();
      try {
        after = await abortable(snapshotOutcome(page, secrets), signal);
        options.onObservation?.(after);
        const observedFailures: string[] = [];
        for (const expectation of expectations)
          if (
            !(await abortable(
              check(page, expectation, before, after, options, step),
              signal,
            ))
          )
            observedFailures.push(redact(description(expectation)));
        failures = observedFailures;
        if (!failures.length) break;
      } catch (error) {
        options.signal?.throwIfAborted();
        if (deadline.signal.aborted) throw error;
        if (
          !/Execution context was destroyed|Cannot find context|frame was detached/i.test(
            String(error),
          )
        )
          throw error;
      }
      await delay(pollMs, undefined, { signal });
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    if (!deadline.signal.aborted) throw error;
    if (!failures.length) failures.push("outcome verification timed out");
    const observed = after.landmarks
      .map((item) => `${item.role} ${JSON.stringify(item.name)}`)
      .join(", ");
    if (observed) failures.push(`saw ${observed.slice(0, 512)}`);
    throw new OutcomeError(failures, after);
  } finally {
    clearTimeout(timer);
  }

  const learned: Expectation[] = [];
  if (after.url !== before.url && /^https?:/.test(after.url)) {
    const pattern = learnedUrl(after.url);
    if (redact(pattern) === pattern && !pattern.includes("[redacted"))
      learned.push({ type: "url", pattern });
  }
  for (const item of after.landmarks) {
    if (
      before.landmarks.some(
        (old) => old.role === item.role && old.name === item.name,
      )
    )
      continue;
    if (
      !isAriaRole(item.role) ||
      !(await visibleInViewport(
        page.getByRole(item.role, { name: item.name, exact: true }),
      ))
    )
      continue;
    learned.push({ type: "element", ...item });
    if (learned.length >= 4) break;
  }
  if (!step.secret)
    learned.push(
      ...implied.filter(
        (item) => redact(JSON.stringify(item)) === JSON.stringify(item),
      ),
    );
  // Keep existing/explicit checks as well; learning may strengthen, never weaken them.
  const safe = [...selected, ...learned].filter(
    (item) => redact(JSON.stringify(item)) === JSON.stringify(item),
  );
  return {
    after,
    learned: Array.from(
      new Map(safe.map((item) => [JSON.stringify(item), item])).values(),
    ),
  };
}
