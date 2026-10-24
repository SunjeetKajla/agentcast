import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Llm } from "./llm";
import type { FetchResult, TinyFish } from "@agentcast/tinyfish";
import { understand } from "./understand";

const page: FetchResult = {
  url: "https://product.example/",
  final_url: "https://product.example/",
  title: "Public product",
  text: "Explore public components and interactive examples.",
  description: null,
  language: null,
  latency_ms: null,
  links: [],
};
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-read-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resilient product reading", () => {
  const brief = {
    name: "Public product",
    oneLiner: "Try interactive examples.",
    valueProps: ["Preview components", "Explore examples", "Choose a theme"],
    audience: "Developers",
    tone: ["Clear"],
    keyTerms: [],
  };
  const options = () => {
    const fetchPages = vi
      .fn()
      .mockResolvedValue({
        results: [],
        errors: [{ url: page.url, error: "bot_blocked" }],
      });
    const json = vi.fn().mockResolvedValue(brief);
    return {
      tf: { fetchPages } as unknown as TinyFish,
      llm: { json } as unknown as Llm,
      url: page.url,
      dir,
      fetchPages,
      json,
    };
  };

  it.each(["bot_blocked", "timeout", "no_content"])(
    "uses one verified browser read when Fetch returns %s",
    async (error) => {
      const o = options();
      o.fetchPages.mockResolvedValue({
        results: [],
        errors: [{ url: page.url, error }],
      });
      const readPage = vi.fn().mockResolvedValue(page);
      const result = await understand({ ...o, readPage });
      expect(result.brief.name).toBe(brief.name);
      expect(result.pages).toEqual([page]);
      expect(readPage).toHaveBeenCalledTimes(1);
      expect(o.json).toHaveBeenCalledTimes(1);
    },
  );

  it("falls back for an empty SPA shell but rejects a security page as product content", async () => {
    const o = options();
    o.fetchPages.mockResolvedValue({
      results: [{ ...page, text: "" }],
      errors: [],
    });
    await expect(
      understand({
        ...o,
        readPage: async () => ({
          ...page,
          text: "Sorry, you have been blocked",
        }),
      }),
    ).rejects.toMatchObject({ kind: "blocked" });
    expect(o.json).not.toHaveBeenCalled();
  });

  it("keeps readable root content when optional linked pages fail", async () => {
    const o = options();
    o.fetchPages
      .mockResolvedValueOnce({
        results: [{ ...page, links: ["https://product.example/docs"] }],
        errors: [],
      })
      .mockRejectedValueOnce(new Error("connection reset"));
    const result = await understand(o);
    expect(result.pages).toHaveLength(1);
    expect(result.failed).toEqual([
      { url: "https://product.example/docs", error: "connection reset" },
    ]);
  });

  it("never falls back after cancellation", async () => {
    const o = options();
    const signal = AbortSignal.abort(new Error("cancelled"));
    o.fetchPages.mockRejectedValue(signal.reason);
    const readPage = vi.fn();
    await expect(understand({ ...o, readPage, signal })).rejects.toThrow(
      "cancelled",
    );
    expect(readPage).not.toHaveBeenCalled();
  });
});
