import { expect, it, vi } from "vitest";
import { safeUserAgentOverride } from "./stealth";

it("awaits the upstream fire-and-forget UA override and safely handles cancellation closing CDP", async () => {
  let reject!: (error: Error) => void;
  const send = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const factory = () => ({
    onPageCreated: async (page: {
      _client(): { send(method: string): Promise<unknown> };
    }) => {
      void page._client().send("Network.setUserAgentOverride");
    },
  });
  const plugin = safeUserAgentOverride({}, factory);
  let finished = false;
  const work = plugin
    .onPageCreated({ _client: () => ({ send }), isClosed: () => true })
    .then(() => {
      finished = true;
    });
  await Promise.resolve();
  expect(finished).toBe(false);
  reject(new Error("Target page, context or browser has been closed"));
  await work;
  expect(finished).toBe(true);
  expect(send).toHaveBeenCalledExactlyOnceWith(
    "Network.setUserAgentOverride",
    undefined,
  );
});

it("does not hide unrelated protocol errors", async () => {
  const send = () => Promise.reject(new Error("Invalid user agent parameters"));
  const plugin = safeUserAgentOverride({}, () => ({
    onPageCreated: async (page: {
      _client(): { send(method: string): Promise<unknown> };
    }) => {
      void page._client().send("Network.setUserAgentOverride");
    },
  }));
  await expect(
    plugin.onPageCreated({ _client: () => ({ send }), isClosed: () => false }),
  ).rejects.toThrow("Invalid user agent parameters");
});
