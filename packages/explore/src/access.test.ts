import { describe, expect, it } from "vitest";
import {
  accessProblem,
  diagnosticUrl,
  ExplorationWatchdog,
  productEntry,
} from "./access";

describe("exploration boundaries and progress", () => {
  it("distinguishes blocked pages and required auth from normal navigation", () => {
    expect(accessProblem("Sorry, you have been blocked")).toMatchObject({
      kind: "blocked",
    });
    expect(accessProblem("Authentication required to continue")).toMatchObject({
      kind: "sign-in-required",
    });
    expect(
      accessProblem("No public interactive demos are available"),
    ).toMatchObject({ kind: "sign-in-required" });
    expect(accessProblem("Home Products Sign in Pricing")).toBeUndefined();
    expect(
      accessProblem(
        "Performing security verification\nThis website verifies you are not a bot.",
      ),
    ).toMatchObject({ kind: "blocked" });
    expect(
      accessProblem("Learn how to protect against malicious bots"),
    ).toBeUndefined();
  });
  it("resolves local entrances but rejects off-site redirects and credential URLs", () => {
    expect(productEntry("/demo/login", "https://www.example.com/")).toBe(
      "https://www.example.com/demo/login",
    );
    for (const url of [
      "https://evil.example/",
      "javascript:alert(1)",
      "https://user:password@example.com/",
    ])
      expect(() => productEntry(url, "https://example.com/")).toThrow();
    expect(
      diagnosticUrl(
        "https://user:secret@example.com/login?token=secret#/work?token=secret",
      ),
    ).toBe("https://example.com/login#/work");
  });
  it("ignores repeated polls of one step but expires their idle time", () => {
    const watch = new ExplorationWatchdog(0, 32, 100);
    for (let i = 0; i < 10; i++)
      expect(
        watch.observe({ id: "one", action: "Open Workspace" }, i),
      ).toBeUndefined();
    expect(watch.lastProgressAt).toBe(0);
    expect(watch.idle(101)).toMatch(/no observable progress/);
  });
  it("accepts repeated actions that visibly advance through different frames", () => {
    const watch = new ExplorationWatchdog(0);
    for (let i = 0; i < 10; i++)
      expect(
        watch.observe({ id: `${i}`, action: "Scroll down" }, i, `frame-${i}`),
      ).toBeUndefined();
  });
  it("stops navigation loops across distinct steps and enforces an action budget", () => {
    const watch = new ExplorationWatchdog(0);
    for (let i = 0; i < 4; i++)
      expect(
        watch.observe({ id: `${i}`, action: "Open Workspace" }, i),
      ).toBeUndefined();
    expect(watch.observe({ id: "5", action: "Open Workspace" }, 5)).toMatch(
      /repeated/,
    );
    const limited = new ExplorationWatchdog(0, 2);
    limited.observe({ id: "1", action: "Open" }, 0);
    limited.observe({ id: "2", action: "Create" }, 1);
    expect(limited.observe({ id: "3", action: "Save" }, 2)).toMatch(
      /step budget/,
    );
  });
});
