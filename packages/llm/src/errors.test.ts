import { expect, it } from "vitest";
import { classify } from "./errors.ts";

it("classifies subscription-window limits as quota failures", () => {
  const error = classify(
    "Claude Code",
    "You've hit your 5-hour limit · resets 5:30pm (Asia/Kolkata)",
  );
  expect(error.code).toBe("llm.limit");
  expect(error.retryable).toBe(true);
  expect(classify("Codex", "You've reached your weekly limit").code).toBe(
    "llm.limit",
  );
  expect(classify("Claude Code", "malformed tool response").code).toBe(
    "llm.failed",
  );
});
