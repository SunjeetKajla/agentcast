import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
type Client = { send(method: string, params?: unknown): Promise<unknown> };
type CompatPage = { _client: Client | (() => Client); isClosed(): boolean };

/** The upstream UA plugin starts a CDP send without awaiting it. Track it so closing Chrome cannot
 * leave an unhandled rejection. Preserve the upstream UA/platform/language configuration. */
export function safeUserAgentOverride(
  options?: unknown,
  factory = require("puppeteer-extra-plugin-stealth/evasions/user-agent-override"),
) {
  const plugin = factory(options);
  const original = plugin.onPageCreated.bind(plugin);
  plugin.onPageCreated = async (page: CompatPage) => {
    const pending: Promise<unknown>[] = [];
    const client =
      typeof page._client === "function" ? page._client() : page._client;
    const tracked = Object.create(client) as Client;
    tracked.send = (method, params) => {
      const command = client.send(method, params);
      // Attach the handler immediately; the original plugin intentionally does not await this call.
      void command.catch(() => {});
      pending.push(command);
      return command;
    };
    const proxy = new Proxy(page, {
      get(target, prop) {
        if (prop === "_client") return () => tracked;
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      await original(proxy);
      await Promise.all(pending);
    } catch (error) {
      if (
        !page.isClosed() &&
        !/target.*closed|session closed|browser has been closed/i.test(
          (error as Error).message,
        )
      )
        throw error;
    }
  };
  return plugin;
}
