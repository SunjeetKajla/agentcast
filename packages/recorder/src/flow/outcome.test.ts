import { describe, expect, it } from "vitest";
import { cursorDuration, cubicPoint } from "./act.ts";
import { learnedUrl, matchesUrl } from "./outcome.ts";
import { redactor } from "./heal.ts";

describe("flow motion and learned URL patterns", () => {
  it("redacts literal, JSON-escaped and URL-encoded secret forms", () => {
    const secret = 'private/key with "quotes"';
    const redact = redactor([secret]);
    expect(redact(secret)).toBe("[redacted]");
    expect(redact(JSON.stringify(secret))).toBe('"[redacted]"');
    expect(redact(`https://demo.test/${encodeURIComponent(secret)}`)).toBe(
      "https://demo.test/[redacted]",
    );
    expect(redact(new URLSearchParams({ key: secret }).toString())).toBe(
      "key=[redacted]",
    );
  });
  it("bounds movement duration and reaches the precise destination", () => {
    expect(cursorDuration(0)).toBe(300);
    expect(cursorDuration(700)).toBe(470);
    expect(cursorDuration(5000)).toBe(700);
    expect(cubicPoint([10, 20], [20, 20], [110, 80], [100, 80], 0)).toEqual([
      10, 20,
    ]);
    expect(cubicPoint([10, 20], [20, 20], [110, 80], [100, 80], 1)).toEqual([
      100, 80,
    ]);
  });
  it("generalizes generated IDs and omits sensitive query values", () => {
    const pattern = learnedUrl(
      "https://demo.test/projects/550e8400-e29b-41d4-a716-446655440000/edit?token=private",
    );
    expect(pattern).toBe("/projects/*/edit");
    expect(
      matchesUrl(pattern, "https://demo.test/projects/123/edit?token=new"),
    ).toBe(true);
    expect(matchesUrl(pattern, "https://demo.test/projects/123/upgrade")).toBe(
      false,
    );
    expect(learnedUrl("https://demo.test/projects/123")).toBe("/projects/*");
    expect(learnedUrl("https://demo.test/projects/Q4-Launch")).toBe(
      "/projects/Q4-Launch",
    );
  });
  it("matches the reference segment/globstar rules and hash-router routes", () => {
    expect(learnedUrl("https://x.app/projects/42/tasks/9f3c2a1b7d4e5f60")).toBe(
      "/projects/*/tasks/*",
    );
    expect(matchesUrl("/projects/*", "https://x.app/projects/42")).toBe(true);
    expect(matchesUrl("/projects/*", "https://x.app/projects/42/edit")).toBe(
      false,
    );
    expect(matchesUrl("/projects/**", "https://x.app/projects/42/edit")).toBe(
      true,
    );
    expect(matchesUrl("/#/completed", "https://todomvc.com/#/completed")).toBe(
      true,
    );
    expect(learnedUrl("https://x.app/#/projects/42?token=private")).toBe(
      "/#/projects/*",
    );
    expect(matchesUrl("/", "https://x.app/#/completed")).toBe(false);
    expect(
      matchesUrl("/#/completed", "https://x.app/#/completed?tab=recent"),
    ).toBe(true);
    expect(matchesUrl("/projects/*", "https://x.app/projects/42/")).toBe(true);
  });
  it("treats regex metacharacters literally and requires the whole pattern", () => {
    expect(
      matchesUrl("/a.b/(x)?q=[1]", "https://demo.test/a.b/(x)?q=[1]"),
    ).toBe(true);
    expect(matchesUrl("/a.b", "https://demo.test/axb")).toBe(false);
    expect(
      matchesUrl("/dashboard", "https://demo.test/dashboard?tab=recent#top"),
    ).toBe(true);
    expect(matchesUrl("/projects/*", "https://demo.test/not-projects/42")).toBe(
      false,
    );
    expect(matchesUrl("https://demo.test/*", "https://other.test/a")).toBe(
      false,
    );
  });
});
