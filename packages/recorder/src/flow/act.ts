import { setTimeout as delay } from "node:timers/promises";
import type { Point, Rect, Step, TimelineEvent } from "@agentcast/shared";
import type { Page } from "playwright-core";
import type { ResolvedTarget } from "./locate.ts";

export interface CursorSample {
  t: number;
  x: number;
  y: number;
}
export interface ActuatorOptions {
  signal: AbortSignal;
  now(): number;
  motion<T>(work: () => Promise<T>): Promise<T>;
  /** Injectable randomness for reproducible rehearsals. Must return [0,1]. */
  random?: () => number;
}
export interface ActionResult {
  /** Time of the action after movement/hover, in video seconds. */
  at: number;
  bbox?: Rect;
  cursor?: TimelineEvent["cursor"];
  selectedValue?: string;
}

/** A hover menu or modal may cover an otherwise valid target on a fresh take. */
async function clickWithRecovery(
  page: Page,
  locator: NonNullable<ResolvedTarget["locator"]>,
  signal: AbortSignal,
  trial = false,
) {
  try {
    await locator.click({ trial, timeout: 2000 });
  } catch (error) {
    signal.throwIfAborted();
    if (
      !/intercepts pointer events|not stable|not visible|outside of the viewport/i.test(
        (error as Error).message,
      )
    )
      throw error;
    await page.keyboard.press("Escape");
    const viewport = page.viewportSize();
    await page.mouse.move(
      viewport ? viewport.width - 2 : 0,
      viewport ? viewport.height - 2 : 0,
    );
    await delay(300, undefined, { signal });
    await locator.click({ trial, timeout: 2000 });
  }
}

export function cursorDuration(distance: number): number {
  return Math.max(300, Math.min(700, 120 + Math.max(0, distance) * 0.5));
}
export function cubicPoint(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
  t: number,
): Point {
  const u = 1 - t;
  return [
    u * u * u * from[0] +
      3 * u * u * t * control1[0] +
      3 * u * t * t * control2[0] +
      t * t * t * to[0],
    u * u * u * from[1] +
      3 * u * u * t * control1[1] +
      3 * u * t * t * control2[1] +
      t * t * t * to[1],
  ];
}

/** Real input events, with separate cursor samples for the post-production cursor overlay. */
export function createActuator(page: Page, options: ActuatorOptions) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Flow actions require a viewport");
  let position: Point = [viewport.width / 2, viewport.height / 2];
  const samples: CursorSample[] = [];
  const random = () => {
    const value = (options.random ?? Math.random)();
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("Invalid actuator randomness");
    return value;
  };
  const pause = (ms: number) =>
    delay(Math.max(0, ms), undefined, { signal: options.signal });
  const move = async (
    to: Point,
  ): Promise<NonNullable<TimelineEvent["cursor"]>> => {
    const from: Point = [...position],
      started = options.now();
    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      distance = Math.hypot(dx, dy);
    const duration = cursorDuration(distance),
      bend = (random() - 0.5) * Math.min(50, distance * 0.15);
    const c1: Point = [
      from[0] + dx * 0.3 - (dy / (distance || 1)) * bend,
      from[1] + dy * 0.3 + (dx / (distance || 1)) * bend,
    ];
    // A control point just beyond the destination creates a small natural overshoot.
    const c2: Point = [to[0] + dx * 0.035, to[1] + dy * 0.035];
    const count = Math.ceil(duration / (1000 / 60));
    for (let frame = 1; frame <= count; frame++) {
      await pause(started + (duration * frame) / count - options.now());
      options.signal.throwIfAborted();
      const [x, y] = cubicPoint(from, c1, c2, to, frame / count);
      const point: Point = [
        Math.max(1, Math.min(viewport.width - 1, x)),
        Math.max(1, Math.min(viewport.height - 1, y)),
      ];
      await page.mouse.move(...point);
      position = point;
      samples.push({ t: options.now() / 1000, x: point[0], y: point[1] });
    }
    return { from, to: position, t0: started / 1000, t1: options.now() / 1000 };
  };
  const scroll = async (distance: number) => {
    const duration = Math.max(350, Math.min(1000, Math.abs(distance) * 0.6));
    const count = Math.ceil(duration / (1000 / 60)),
      start = options.now();
    await options.motion(async () => {
      let previous = 0;
      for (let frame = 1; frame <= count; frame++) {
        await pause(start + (duration * frame) / count - options.now());
        const t = frame / count,
          eased = t * t * (3 - 2 * t),
          amount = distance * eased;
        await page.mouse.wheel(0, amount - previous);
        previous = amount;
      }
    });
  };
  return {
    samples,
    async run(step: Step, target?: ResolvedTarget): Promise<ActionResult> {
      options.signal.throwIfAborted();
      const locator = target?.locator;
      let cursor: TimelineEvent["cursor"], bbox: Rect | undefined;
      if (locator && step.action !== "scroll") {
        let box = await locator.boundingBox({ timeout: 1000 });
        if (!box) throw new Error("Action target has no visible bounds");
        if (box.y + box.height > viewport.height || box.y < 0) {
          const current = await page.evaluate(() => ({
            y: scrollY,
            max: Math.max(
              0,
              document.documentElement.scrollHeight - innerHeight,
            ),
          }));
          const distance = Math.max(
            -current.y,
            Math.min(
              current.max - current.y,
              box.y + box.height / 2 - viewport.height / 2,
            ),
          );
          if (Math.abs(distance) > 1) await scroll(distance);
        }
        await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
        if (
          step.action === "click" ||
          step.action === "type" ||
          step.action === "select"
        )
          await clickWithRecovery(page, locator, options.signal, true);
        box = await locator.boundingBox({ timeout: 1000 });
        if (!box) throw new Error("Action target disappeared");
        bbox = [box.x, box.y, box.width, box.height];
        cursor = await move([box.x + box.width / 2, box.y + box.height / 2]);
        await pause(150);
        const latest = await locator.boundingBox({ timeout: 1000 });
        if (!latest) throw new Error("Action target disappeared during hover");
        const center: Point = [
          latest.x + latest.width / 2,
          latest.y + latest.height / 2,
        ];
        if (Math.hypot(center[0] - position[0], center[1] - position[1]) > 4) {
          const adjustment = await move(center);
          cursor = { ...adjustment, from: cursor.from, t0: cursor.t0 };
        }
        bbox = [latest.x, latest.y, latest.width, latest.height];
      }
      const at = options.now() / 1000;
      switch (step.action) {
        case "click":
          if (!locator) throw new Error("Click requires a target");
          await clickWithRecovery(page, locator, options.signal);
          break;
        case "hover":
          if (!locator) throw new Error("Hover requires a target");
          await locator.hover({ timeout: 2000 });
          break;
        case "type":
          if (!locator || step.value === undefined)
            throw new Error("Type requires a target and value");
          await clickWithRecovery(page, locator, options.signal);
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.press("Backspace");
          for (const character of step.value) {
            options.signal.throwIfAborted();
            await page.keyboard.type(character);
            await pause(35 + random() * 35);
          }
          break;
        case "select": {
          if (!locator || step.value === undefined)
            throw new Error("Select requires a target and value");
          const value = await locator.evaluate(
            (element, requested) => {
              if (!(element instanceof HTMLSelectElement) || element.multiple)
                throw new Error("Select requires a single native select");
              const options = Array.from(element.options).filter(
                (option) =>
                  !option.disabled &&
                  !(
                    option.parentElement instanceof HTMLOptGroupElement &&
                    option.parentElement.disabled
                  ),
              );
              const byValue = options.filter(
                (option) => option.value === requested,
              );
              const choices = byValue.length
                ? byValue
                : options.filter((option) => option.label === requested);
              if (choices.length !== 1)
                throw new Error("Select option is missing or ambiguous");
              return choices[0]!.value;
            },
            step.value,
            { timeout: 1000 },
          );
          await locator.selectOption({ value }, { timeout: 2000 });
          return { at, bbox, cursor, selectedValue: value };
        }
        case "press":
          if (!step.value) throw new Error("Press requires a key");
          if (locator) await locator.press(step.value, { timeout: 2000 });
          else await page.keyboard.press(step.value);
          break;
        case "navigate": {
          if (!step.value) throw new Error("Navigate requires a URL");
          const url = new URL(step.value, page.url());
          if (!["http:", "https:"].includes(url.protocol))
            throw new Error("Navigation requires an HTTP(S) URL");
          await page.goto(url.href, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          break;
        }
        case "scroll": {
          let distance =
            step.value === undefined
              ? viewport.height * 0.7
              : Number(step.value.replace(/px$/, ""));
          if (locator) {
            const box = await locator.boundingBox({ timeout: 1000 });
            if (!box) throw new Error("Scroll target disappeared");
            bbox = [box.x, box.y, box.width, box.height];
            distance = box.y + box.height / 2 - viewport.height / 2;
          }
          if (!Number.isFinite(distance) || Math.abs(distance) > 100000)
            throw new Error("Invalid scroll distance");
          const current = await page.evaluate(() => ({
            y: scrollY,
            max: Math.max(
              0,
              document.documentElement.scrollHeight - innerHeight,
            ),
          }));
          distance = Math.max(
            -current.y,
            Math.min(current.max - current.y, distance),
          );
          if (Math.abs(distance) > 1) await scroll(distance);
          if (locator) {
            await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
            const visibleBox = await locator.boundingBox({ timeout: 1000 });
            if (!visibleBox) throw new Error("Scroll target disappeared");
            bbox = [
              visibleBox.x,
              visibleBox.y,
              visibleBox.width,
              visibleBox.height,
            ];
          }
          break;
        }
        case "wait": {
          const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(step.value ?? "300");
          const duration = match
            ? Number(match[1]) * (match[2] === "s" ? 1000 : 1)
            : NaN;
          if (!Number.isFinite(duration) || duration > 10000)
            throw new Error("Wait must be between 0 and 10000 ms");
          await pause(duration);
          break;
        }
      }
      return { at, bbox, cursor };
    },
  };
}
