import { describe, expect, it } from "vitest";
import { Pool } from "./pool";

describe("LLM queue cancellation", () => {
  it("removes a cancelled queued request without waiting for the active job or starting its task", async () => {
    const pool = new Pool(1);
    let release!: () => void;
    let ran = false;
    const active = pool.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const abort = new AbortController();
    const pending = pool.run(async () => {
      ran = true;
    }, abort.signal);
    abort.abort();
    try {
      const result = await Promise.race([
        pending.then(
          () => "ran",
          () => "cancelled",
        ),
        new Promise((resolve) =>
          setTimeout(() => resolve("still waiting"), 100),
        ),
      ]);
      expect(result).toBe("cancelled");
      expect(ran).toBe(false);
    } finally {
      release();
      await active;
      await pending.catch(() => {});
    }
  });
});
