import { setTimeout as delay } from "node:timers/promises";
import type { Page, Request } from "playwright-core";
import type { MotionWindow } from "../timing.ts";
import { abortable } from "./control.ts";

export interface SettleOptions {
  timeoutMs?: number;
  domQuietMs?: number;
  networkQuietMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}
export interface SettleReport {
  reason: "dom-stable" | "network-idle" | "timeout";
  elapsedMs: number;
  motion: MotionWindow[];
  /** First observed DOM mutation after the initial sample, on the supplied scene clock. */
  firstChangeMs?: number;
}

/** Start tracking before the action so short requests are not missed. Dispose after verification. */
export function trackSettle(page: Page, defaults: SettleOptions = {}) {
  const pending = new Set<Request>();
  let lastNetwork = performance.now();
  const begin = (request: Request) => {
    if (["websocket", "eventsource", "media"].includes(request.resourceType()))
      return;
    pending.add(request);
    lastNetwork = performance.now();
  };
  const end = (request: Request) => {
    if (pending.delete(request)) lastNetwork = performance.now();
  };
  page.on("request", begin);
  page.on("requestfinished", end);
  page.on("requestfailed", end);
  return {
    async wait(overrides: SettleOptions = {}): Promise<SettleReport> {
      const options = { ...defaults, ...overrides };
      const timeoutMs = options.timeoutMs ?? 4000,
        domQuietMs = options.domQuietMs ?? 300;
      const networkQuietMs = options.networkQuietMs ?? 500,
        pollMs = options.pollMs ?? 50;
      if (
        ![timeoutMs, domQuietMs, networkQuietMs, pollMs].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      )
        throw new Error("Invalid settle budget");
      const controller = new AbortController();
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      const timer = setTimeout(
        () => controller.abort(new Error("Settle deadline")),
        timeoutMs,
      );
      const start = performance.now(),
        now = options.now ?? (() => performance.now() - start);
      let changed = start,
        previous: string | undefined,
        lastPoll = now(),
        wasMoving = false;
      const motion: MotionWindow[] = [];
      let firstChangeMs: number | undefined;
      try {
        while (true) {
          options.signal?.throwIfAborted();
          if (page.isClosed()) throw new Error("Page closed while settling");
          try {
            const state = await abortable(
              page.evaluate(() => {
                // Hash in the browser: input values and website copy never leave as raw settle data.
                const text =
                  (document.body?.innerText ?? "") +
                  "|" +
                  document.querySelectorAll("body *").length +
                  "|" +
                  scrollX +
                  "," +
                  scrollY;
                let hash = 2166136261;
                for (let i = 0; i < text.length; i++)
                  hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
                const moving = document.getAnimations().some((animation) => {
                  const timing = animation.effect?.getComputedTiming();
                  return (
                    animation.playState === "running" &&
                    timing &&
                    Number.isFinite(timing.endTime)
                  );
                });
                return { signature: String(hash), moving };
              }),
              signal,
            );
            const t = now();
            if (wasMoving) motion.push({ startMs: lastPoll, endMs: t });
            lastPoll = t;
            wasMoving = state.moving;
            if (state.signature !== previous) {
              if (previous !== undefined) firstChangeMs ??= t;
              previous = state.signature;
              changed = performance.now();
            }
            if (!state.moving && performance.now() - changed >= domQuietMs)
              return {
                reason: "dom-stable",
                elapsedMs: performance.now() - start,
                motion,
                firstChangeMs,
              };
            if (
              !state.moving &&
              !pending.size &&
              performance.now() - Math.max(start, lastNetwork) >= networkQuietMs
            )
              return {
                reason: "network-idle",
                elapsedMs: performance.now() - start,
                motion,
                firstChangeMs,
              };
          } catch (error) {
            options.signal?.throwIfAborted();
            if (controller.signal.aborted) break;
            if (
              page.isClosed() ||
              !/Execution context was destroyed|Cannot find context|frame was detached/i.test(
                String(error),
              )
            )
              throw error;
            changed = performance.now();
            previous = undefined;
          }
          await delay(pollMs, undefined, { signal });
        }
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!controller.signal.aborted) throw error;
      } finally {
        clearTimeout(timer);
      }
      if (wasMoving) motion.push({ startMs: lastPoll, endMs: now() });
      return {
        reason: "timeout",
        elapsedMs: performance.now() - start,
        motion,
        firstChangeMs,
      };
    },
    dispose() {
      page.off("request", begin);
      page.off("requestfinished", end);
      page.off("requestfailed", end);
      pending.clear();
    },
  };
}

export async function waitForSettle(
  page: Page,
  options: SettleOptions = {},
): Promise<SettleReport> {
  const tracker = trackSettle(page, options);
  try {
    return await tracker.wait();
  } finally {
    tracker.dispose();
  }
}
