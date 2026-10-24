import { setTimeout as delay } from "node:timers/promises";
import type { RecorderBrowser } from "@agentcast/recorder";

/** tsx/esbuild may add __name calls to nested functions. A serialized callback does not carry that
 * module helper into Chrome. Keep the helper lexical to this evaluation, without changing site globals. */
export async function evaluateInPage<T>(
  page: Pick<RecorderBrowser["page"], "evaluate">,
  callback: () => T | Promise<T>,
): Promise<T> {
  const source = `(() => {
    const __name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });
    if(typeof document !== "undefined" && !document.body) throw new Error("AGENTCAST_PAGE_NOT_READY");
    return (${callback.toString()})();
  })()`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate<T>(source);
    } catch (error) {
      // Read-only inspections may race a normal client redirect. Programming errors still fail.
      if (
        attempt >= 9 ||
        !/Execution context was destroyed|Cannot find context with specified id|most likely because of a navigation|AGENTCAST_PAGE_NOT_READY/i.test(
          (error as Error).message,
        )
      )
        throw error;
      await delay(150);
    }
  }
}
