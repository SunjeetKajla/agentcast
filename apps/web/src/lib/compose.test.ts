import { JobConfig } from "@agentcast/shared";
import { describe, expect, test } from "vitest";
import { DEFAULT_CHOICES, parseComposer, readBack, toJobConfig } from "./compose";

describe("parseComposer", () => {
  test("splits the product link from the video prompt", () => {
    expect(parseComposer("https://linear.app punchy launch, 30 s")).toEqual({
      url: "https://linear.app",
      prompt: "punchy launch, 30 s",
    });
    expect(parseComposer("Calm and premium for linear.app/features please")).toEqual({
      url: "https://linear.app/features",
      prompt: "Calm and premium for please",
    });
  });

  test("a bare domain gets https, trailing punctuation is dropped", () => {
    expect(parseComposer("demoboard.vercel.app.").url).toBe("https://demoboard.vercel.app");
  });

  test("no link means no URL yet", () => {
    expect(parseComposer("a punchy launch video")).toEqual({ prompt: "a punchy launch video" });
  });
});

describe("toJobConfig", () => {
  test("produces a body the worker accepts", () => {
    const body = toJobConfig("https://linear.app", "punchy, 30 s", { ...DEFAULT_CHOICES, langs: ["en", "hi"], autopilot: true });
    expect(JobConfig.parse(body)).toMatchObject({
      url: "https://linear.app",
      stylePrompt: "punchy, 30 s",
      mode: "launch",
      auth: { mode: "public" },
      variants: { aspects: ["16x9", "9x16"], langs: ["en", "hi"], formFactors: ["desktop"] },
      autopilot: true,
    });
  });
});

test("readBack says what will be made", () => {
  expect(readBack({ ...DEFAULT_CHOICES, langs: ["en", "hi"] }, "Punchy Product Hunt launch, 30 s")).toBe(
    "A launch video, about 30 s, 16:9 and 9:16 in English and Hindi, with your review of flows, script and preview.",
  );
  expect(readBack({ ...DEFAULT_CHOICES, mode: "tutorial", aspects: ["9x16"], autopilot: true }, "")).toBe(
    "A step-by-step tutorial, 9:16 in English, straight through on autopilot.",
  );
});
