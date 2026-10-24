import { setTimeout as delay } from "node:timers/promises";
import {
  FormFactor,
  ReplayEntry,
  Step,
  type LocatorStrategy,
  type Rect,
} from "@agentcast/shared";
import type { Llm, OnEvent } from "@agentcast/llm";
import type { Locator, Page } from "playwright-core";
import { rankFuzzy, snapshotCandidates } from "./fuzzy.ts";
import { healLocator, redactor, type RepairContext } from "./heal.ts";
import { cachedLocator, replayKey, saveLocator } from "./replay.ts";
import {
  isAriaRole,
  parseLocator,
  serializeLocator,
  toLocator,
  type SemanticLocator,
} from "./semantic.ts";
import { selectMatch, type Match } from "./select.ts";
import { abortable } from "./control.ts";

export interface LocateOptions {
  /** Read the replay cache but defer writes until the entire take succeeds. */
  persist?: boolean;
  /** Retry a semantically wrong but valid locator using the previous failed outcome. */
  repair?: RepairContext;
  signal?: AbortSignal;
  /** Entire deterministic chain, not per-strategy (default 4000 ms). */
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxCandidates?: number;
  settle?: boolean;
  /** Explicit opt-in, matching record --heal. Never used before deterministic exhaustion. */
  heal?: boolean;
  llm?: Pick<Llm, "json">;
  onLlmEvent?: OnEvent;
  healTimeoutMs?: number;
  replayPlanPath?: string;
  formFactor?: FormFactor;
  /** Namespaces step IDs so s1 in two flows cannot collide. */
  flowId?: string;
  secretValues?: readonly string[];
}

export interface ResolvedTarget {
  locator: Locator;
  bbox: Rect;
  method: "cache" | "role" | "label" | "placeholder" | "text" | "fuzzy" | "llm";
  strategy: LocatorStrategy;
  /** Omitted for sensitive names: they may be used locally but are never cached. */
  entry?: ReplayEntry;
  elapsedMs: number;
}

export class LocatorResolutionError extends Error {
  constructor(
    readonly code:
      "locator.not-found" | "locator.ambiguous" | "locator.heal-rejected",
    readonly stepId: string,
  ) {
    super(`${code}: no verified target for step ${stepId}`);
    this.name = "LocatorResolutionError";
  }
}

const observed = new WeakSet<Page>();
const settled = new WeakSet<Page>();
async function settleFirstPage(page: Page): Promise<void> {
  if (!observed.has(page)) {
    observed.add(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) settled.delete(page);
    });
  }
  if (settled.has(page)) return;
  await page.waitForLoadState("domcontentloaded", { timeout: 1_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let quiet: ReturnType<typeof setTimeout>;
        const finish = () => {
          clearTimeout(quiet);
          clearTimeout(cap);
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(finish, 300);
        });
        const cap = setTimeout(finish, 1000);
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        quiet = setTimeout(finish, 300);
      }),
  );
  settled.add(page);
}

function chain(step: Step): SemanticLocator[] {
  const target = step.target!;
  if (!target) return [];
  const name = target.text || target.label || target.placeholder;
  if (!name)
    return target.role && isAriaRole(target.role)
      ? [{ kind: "role", role: target.role, name: "" }]
      : [];
  const result: SemanticLocator[] = [];
  if (target.role && isAriaRole(target.role))
    result.push({ kind: "role", role: target.role, name });
  result.push(
    { kind: "label", name: target.label || name },
    { kind: "placeholder", name: target.placeholder || name },
    { kind: "text", name },
  );
  return result;
}

async function fuzzyCandidates(
  page: Page,
  step: Step,
): Promise<SemanticLocator[]> {
  const snapshot = await page
    .locator("body")
    .ariaSnapshot({ timeout: 500 })
    .catch(() => "");
  const names = snapshotCandidates(snapshot);
  if (step.target?.role && isAriaRole(step.target.role))
    return names.filter(
      (item) => item.kind === "role" && item.role === step.target!.role,
    );
  const text = await page.locator("body *").evaluateAll((elements) => {
    const names: string[] = [];
    for (const element of elements.slice(0, 5_000)) {
      if (
        !(element instanceof HTMLElement) ||
        ["SCRIPT", "STYLE", "NOSCRIPT"].includes(element.tagName)
      )
        continue;
      const name = element.innerText?.trim();
      if (
        !name ||
        name.length > 512 ||
        !element.getClientRects().length ||
        getComputedStyle(element).visibility === "hidden"
      )
        continue;
      if (
        Array.from(element.children).some(
          (child) =>
            child instanceof HTMLElement && child.innerText?.trim() === name,
        )
      )
        continue;
      names.push(name);
      if (names.length >= 500) break;
    }
    return names;
  });
  const textNames = new Set(text);
  return [
    ...names.filter((item) => !textNames.has(item.name)),
    ...text.map((name) => ({ kind: "text" as const, name })),
  ];
}

/** Resolve, verify and cache a target. This function never clicks, types, or executes cached code. */
export async function resolveTarget(
  page: Page,
  input: Step,
  options: LocateOptions = {},
): Promise<ResolvedTarget> {
  const step = Step.parse(input);
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? 4000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const maxCandidates = options.maxCandidates ?? 100;
  const healTimeoutMs = options.healTimeoutMs ?? 45_000;
  if (
    ![timeoutMs, pollIntervalMs, healTimeoutMs].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    !Number.isInteger(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > 500
  )
    throw new Error("Invalid locator lookup budget");
  const formFactor = FormFactor.parse(options.formFactor ?? "desktop");
  const secretValues = [
    ...(options.secretValues ?? []),
    ...(step.secret && step.value ? [step.value] : []),
  ];
  const redact = redactor(secretValues);
  const safeId = redact(step.id);
  const specs = chain(step);
  if (!specs.length)
    throw new LocatorResolutionError("locator.not-found", safeId);
  options.signal?.throwIfAborted();
  const key = replayKey(step.id, options.flowId);
  const cacheAllowed =
    redact(key) === key &&
    redact(step.id) === step.id &&
    (!options.flowId || redact(options.flowId) === options.flowId);
  const cached =
    options.replayPlanPath && cacheAllowed
      ? await cachedLocator(options.replayPlanPath, formFactor, key)
      : undefined;
  const cachedSpec = cached ? parseLocator(cached.locator) : undefined;
  let ambiguous = false;
  type Found = {
    match: Match;
    spec: SemanticLocator;
    method: ResolvedTarget["method"];
    strategy: LocatorStrategy;
  };
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("Locator deterministic lookup timed out")),
    timeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const check = async (
    spec: SemanticLocator,
    method: ResolvedTarget["method"],
    strategy: LocatorStrategy = spec.kind,
  ): Promise<Found | undefined> => {
    signal.throwIfAborted();
    const selected = await selectMatch(
      page,
      toLocator(page, spec),
      step,
      maxCandidates,
    );
    ambiguous ||= selected.ambiguous;
    return selected.match
      ? { match: selected.match, spec, method, strategy }
      : undefined;
  };
  let found: Found | undefined;
  try {
    if (options.repair && options.heal) deadline.abort();
    else
      found = await abortable(
        (async () => {
          while (true) {
            signal.throwIfAborted();
            if (page.isClosed())
              throw new Error("The page closed during locator resolution");
            try {
              if (options.settle !== false) await settleFirstPage(page);
              if (
                cachedSpec &&
                cached &&
                (cached.strategy === "llm" ||
                  cached.strategy === cachedSpec.kind)
              ) {
                const hit = await check(cachedSpec, "cache", cached.strategy);
                if (hit) return hit;
              }
              for (const [index, spec] of specs.entries()) {
                const match = await check(spec, spec.kind);
                if (match) {
                  // A delayed target can arrive between role and text queries. Preserve
                  // chain priority by rechecking earlier strategies before accepting it.
                  for (const earlier of specs.slice(0, index)) {
                    const preferred = await check(earlier, earlier.kind);
                    if (preferred) return preferred;
                  }
                  return match;
                }
              }
              const ranked = rankFuzzy(
                specs[0]!.name,
                await fuzzyCandidates(page, step),
              );
              if (
                ranked.length &&
                (!ranked[1] || ranked[0]!.score - ranked[1].score >= 0.08)
              ) {
                const best = ranked[0]!.spec;
                for (const spec of specs) {
                  const preferred = await check(spec, spec.kind);
                  if (preferred) return preferred;
                }
                // A target can appear between the exact query and ARIA snapshot.
                // Report its original exact strategy instead of calling that a fuzzy repair.
                const exact = specs.find(
                  (spec) => serializeLocator(spec) === serializeLocator(best),
                );
                const match = await check(best, exact?.kind ?? "fuzzy");
                if (match) return match;
              } else if (ranked.length) ambiguous = true;
            } catch (error) {
              signal.throwIfAborted();
              if (page.isClosed())
                throw new Error("The page closed during locator resolution");
              const message = error instanceof Error ? error.message : "";
              if (
                !/Execution context was destroyed|Cannot find context|frame was detached|Timeout .* exceeded/i.test(
                  message,
                )
              )
                throw error;
            }
            await delay(pollIntervalMs, undefined, { signal });
          }
        })(),
        signal,
      );
  } catch (error) {
    options.signal?.throwIfAborted();
    if (!deadline.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!found && options.heal) {
    const controller = new AbortController();
    const healingSignal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const healingTimer = setTimeout(
      () => controller.abort(new Error("Locator healing timed out")),
      healTimeoutMs,
    );
    try {
      const spec = await healLocator(page, step, {
        llm: options.llm,
        onLlmEvent: options.onLlmEvent,
        signal: healingSignal,
        timeoutMs: healTimeoutMs,
        secretValues,
        repair: options.repair,
      });
      if (spec) {
        const result = await abortable(
          selectMatch(page, toLocator(page, spec), step, maxCandidates),
          healingSignal,
        );
        if (result.match)
          found = { match: result.match, spec, method: "llm", strategy: "llm" };
      }
      if (!found)
        throw new LocatorResolutionError("locator.heal-rejected", safeId);
    } finally {
      clearTimeout(healingTimer);
    }
  }
  if (!found)
    throw new LocatorResolutionError(
      ambiguous ? "locator.ambiguous" : "locator.not-found",
      safeId,
    );
  options.signal?.throwIfAborted();
  const safe =
    redact(found.spec.name) === found.spec.name &&
    !found.spec.name.includes("[redacted");
  const entry = safe
    ? ReplayEntry.parse({
        strategy: found.strategy,
        locator: serializeLocator(found.spec),
        lastOk: new Date().toISOString(),
      })
    : undefined;
  if (
    entry &&
    options.replayPlanPath &&
    cacheAllowed &&
    options.persist !== false
  )
    await saveLocator(
      options.replayPlanPath,
      formFactor,
      key,
      entry,
      options.signal,
    );
  return {
    ...found.match,
    strategy: found.strategy,
    method: found.method,
    entry,
    elapsedMs: performance.now() - started,
  };
}
