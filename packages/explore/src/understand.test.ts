import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Llm } from "./llm";
import type { PageRead } from "@agentcast/browser";
import { understand } from "./understand";

const page: PageRead = {
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
    const readPage = vi.fn(async () => page);
    const json = vi.fn().mockResolvedValue(brief);
    return {
      readPage,
      llm: { json } as unknown as Llm,
      url: page.url,
      dir,

      json,
    };
  };

  it("reads verified local content once", async () => {
    const o = options();
    const result = await understand(o);
    expect(result.brief.name).toBe(brief.name);
    expect(o.readPage).toHaveBeenCalledTimes(1);
  });
  it("rejects security pages without inventing a brief", async () => {
    const o = options();
    o.readPage.mockResolvedValue({
      ...page,
      text: "Sorry, you have been blocked",
    });
    await expect(understand(o)).rejects.toMatchObject({ kind: "blocked" });
    expect(o.json).not.toHaveBeenCalled();
  });
  it("keeps readable root content when optional linked pages fail", async () => {
    const o = options();
    o.readPage
      .mockResolvedValueOnce({
        ...page,
        links: ["https://product.example/docs"],
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
    const readPage = vi.fn();
    await expect(understand({ ...o, readPage, signal })).rejects.toThrow(
      "cancelled",
    );
    expect(readPage).not.toHaveBeenCalled();
  });
});
