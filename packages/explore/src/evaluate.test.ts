import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { evaluateInPage } from "./evaluate";
import { openProduct } from "./local";
import type { RecorderBrowser } from "@agentcast/recorder";

it("evaluates a callback containing tsx naming helpers without leaking globals into the page", async () => {
  const scope: Record<string, unknown> = {};
  const page = {
    evaluate: async (source: string) => runInNewContext(source, scope),
  } as unknown as RecorderBrowser["page"];
  const callback = (() => {}) as () => string;
  // The emitted callback, rather than the test runner's own transform, supplies the regression input.
  callback.toString = () =>
    '() => { const visible = __name(() => "visible", "visible"); return visible(); }';
  expect(await evaluateInPage(page, callback)).toBe("visible");
  expect(scope).not.toHaveProperty("__name");
});

it("preserves errors from the actual page callback", async () => {
  const page = {
    evaluate: async (source: string) => runInNewContext(source),
  } as unknown as RecorderBrowser["page"];
  await expect(
    evaluateInPage(page, () => {
      throw new Error("real inspection failure");
    }),
  ).rejects.toThrow("real inspection failure");
});

it("reports a missing inspection helper instead of hiding it behind a generic Error", async () => {
  const page = {
    goto: async () => ({ status: () => 200 }),
    url: () => "https://product.example/",
    evaluate: async () => {
      throw new Error(
        "page.evaluate: ReferenceError: missingHelper is not defined",
      );
    },
  } as unknown as RecorderBrowser["page"];
  await expect(
    openProduct(page, "https://product.example/", "https://product.example/"),
  ).rejects.toThrow("ReferenceError: missingHelper is not defined");
});

it("retries read-only inspection when a client navigation destroys its execution context", async () => {
  let calls = 0;
  const page = {
    evaluate: async (source: string) => {
      if (calls++ < 2)
        throw new Error(
          "page.evaluate: Execution context was destroyed, most likely because of a navigation",
        );
      return runInNewContext(source);
    },
  } as unknown as RecorderBrowser["page"];
  expect(await evaluateInPage(page, () => 42)).toBe(42);
  expect(calls).toBe(3);
});

it("waits through a new document without a body during a client redirect", async () => {
  let calls = 0;
  const page = {
    evaluate: async (source: string) =>
      runInNewContext(source, { document: { body: calls++ < 2 ? null : {} } }),
  } as unknown as RecorderBrowser["page"];
  expect(await evaluateInPage(page, () => 42)).toBe(42);
  expect(calls).toBe(3);
});
