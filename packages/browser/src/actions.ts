/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { z } from "zod";
import { Expectation, type Step } from "@agentcast/shared";
import { resolveTarget } from "@agentcast/recorder/flow/locate";
import { parseLocator } from "@agentcast/recorder/flow/semantic";
import {
  snapshotOutcome,
  verifyOutcome,
} from "@agentcast/recorder/flow/outcome";
import { trackSettle } from "@agentcast/recorder/flow/settle";
import { checkControlAction } from "./safety.ts";

export const BrowserTarget = z.object({
  id: z.string(),
  role: z.string(),
  text: z.string(),
  label: z.string(),
  placeholder: z.string(),
  near: z.string().optional(),
  inViewport: z.boolean().optional(),
  href: z.string().optional(),
  options: z
    .array(z.object({ value: z.string(), text: z.string() }))
    .optional(),
});
export type BrowserTarget = z.infer<typeof BrowserTarget>;
export const BrowserAction = z
  .object({
    action: z.enum([
      "click",
      "type",
      "select",
      "press",
      "scroll",
      "hover",
      "wait",
    ]),
    target: z
      .string()
      .regex(/^o\d+-\d+$/)
      .optional(),
    value: z.string().max(500).optional(),
    waitFor: z.array(Expectation).max(4).optional(),
  })
  .strict();
export type BrowserAction = z.infer<typeof BrowserAction>;

export class BrowserActionFailure extends Error {
  constructor(
    readonly step: Step,
    readonly performed: boolean,
    readonly kind: "locator" | "action" | "outcome",
    readonly uncertain = false,
  ) {
    super(
      `browser.${kind}: ${performed ? "The action executed but its result was not verified; observe before deciding what to do next." : uncertain ? "The action may have executed before the timeout; do not repeat it. Observe before deciding what to do next." : "The target could not be safely acted on; observe the page again."}`,
    );
  }
}

/** Trusted worker execution: the same semantic resolver and outcome checks used by the recorder. */
export async function performBrowserAction(
  page: Page,
  action: BrowserAction,
  target: BrowserTarget | undefined,
  signal: AbortSignal,
  checkUrl: (url: string) => unknown = (url) => {
    if (new URL(url).origin !== new URL(page.url()).origin)
      throw new Error("Navigation must stay on the authorized site");
  },
) {
  const started = performance.now();
  const step: Step = {
    id: "observed",
    action: action.action,
    ...(target
      ? {
          target: {
            ...(target.text ? { text: target.text } : {}),
            ...(target.role !== "other" ? { role: target.role } : {}),
            ...(target.label ? { label: target.label } : {}),
            ...(target.placeholder ? { placeholder: target.placeholder } : {}),
            ...(target.near ? { near: target.near } : {}),
          },
        }
      : {}),
    ...(action.value === undefined
      ? {}
      : {
          value:
            action.action === "wait"
              ? `${Number(action.value) * 1000}ms`
              : action.value,
        }),
    ...(action.waitFor?.length ? { expect: action.waitFor } : {}),
  };
  let kind: "locator" | "action" | "outcome" = "locator",
    performed = false,
    dispatchStarted = false;
  const dispatch = async <T>(work: () => Promise<T>) => {
    dispatchStarted = true;
    return work();
  };
  const tracker = trackSettle(page, { signal, timeoutMs: 4000 });
  try {
    signal.throwIfAborted();
    const resolved = target
      ? await resolveTarget(page, step, {
          signal,
          persist: false,
          timeoutMs: 5000,
        })
      : undefined;
    const locator = resolved?.locator;
    if (locator && target) {
      // Refuse a resolver result that points to another already-observed element with the same name.
      const original = page.locator(`[data-agentcast-target="${target.id}"]`);
      if (await original.count()) {
        const same = await locator.evaluate(
          (element, id) => element.getAttribute("data-agentcast-target") === id,
          target.id,
        );
        if (!same)
          throw new Error(
            "Observed target is ambiguous under replay semantics",
          );
      }
      const actualHref = await locator.evaluate((element) =>
        element instanceof HTMLAnchorElement ? element.href : undefined,
      );
      if (target.href && actualHref !== target.href)
        throw new Error("The observed link destination changed");
      const spec = resolved?.entry && parseLocator(resolved.entry.locator);
      if (spec?.kind === "role")
        step.target = { ...step.target, role: spec.role, text: spec.name };
    }
    const before = await snapshotOutcome(page);
    if (action.action === "press" || action.action === "click")
      await checkControlAction(
        page,
        locator,
        action.action === "click" ? "click" : action.value!,
        checkUrl,
      );
    kind = "action";
    let selectedValue: string | undefined;
    switch (action.action) {
      case "click":
        if (!locator) throw new Error("Target required");
        await dispatch(() => locator.click({ timeout: 5000 }));
        break;
      case "hover":
        if (!locator) throw new Error("Target required");
        await dispatch(() => locator.hover({ timeout: 5000 }));
        break;
      case "type":
        if (!locator || action.value === undefined)
          throw new Error("Target and value required");
        await dispatch(() => locator.fill(action.value!, { timeout: 5000 }));
        break;
      case "select": {
        if (!locator || action.value === undefined)
          throw new Error("Target and value required");
        const option = target?.options?.filter(
          (o) => o.value === action.value || o.text === action.value,
        );
        if (!option || option.length !== 1)
          throw new Error("Observed option is missing or ambiguous");
        selectedValue = option[0]!.value;
        step.value = selectedValue;
        await dispatch(() =>
          locator.selectOption({ value: selectedValue }, { timeout: 5000 }),
        );
        break;
      }
      case "press":
        if (locator)
          await dispatch(() => locator.press(action.value!, { timeout: 5000 }));
        else await dispatch(() => page.keyboard.press(action.value!));
        break;
      case "scroll":
        if (locator)
          await dispatch(() =>
            locator.scrollIntoViewIfNeeded({ timeout: 5000 }),
          );
        else await dispatch(() => page.mouse.wheel(0, Number(action.value)));
        break;
      case "wait":
        if (!action.waitFor?.length)
          await delay(Number(action.value ?? 1) * 1000, undefined, { signal });
        break;
    }
    performed = true;
    kind = "outcome";
    const settled = await tracker.wait();
    const result = await verifyOutcome(page, step, before, {
      signal,
      timeoutMs: 5000,
      locator,
      selectedValue,
    });
    return {
      step,
      expect: result.learned,
      settle: settled.reason,
      elapsedMs: performance.now() - started,
      url: (() => {
        const url = new URL(result.after.url);
        return (
          url.origin +
          url.pathname +
          (url.hash.startsWith("#/") ? url.hash.split("?")[0] : "")
        );
      })(),
    };
  } catch (error) {
    if (!dispatchStarted && !performed) signal.throwIfAborted();
    throw new BrowserActionFailure(
      step,
      performed,
      kind,
      dispatchStarted && !performed,
    );
  } finally {
    tracker.dispose();
  }
}
