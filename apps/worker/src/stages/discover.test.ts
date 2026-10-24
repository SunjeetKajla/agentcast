import { describe, expect, it, vi } from "vitest";
import { JobConfig } from "@agentcast/shared";
import type { Run, RunStep } from "@agentcast/tinyfish";
import type { StageContext } from "../context";
import { agentEvents } from "./discover";

const step = (id: string, action: string | null): RunStep => ({
  id,
  timestamp: "",
  status: "RUNNING",
  action,
  screenshot: null,
  duration: null,
});
const run = (steps: RunStep[], url: string | null = null) =>
  ({ status: "RUNNING", steps, streaming_url: url }) as Run;

function setup(auth: "public" | "sign-in-once" = "public") {
  const emit = vi.fn();
  const ctx = {
    emit,
    stage: "discover",
    config: JobConfig.parse({
      url: "https://demoboard.vercel.app/",
      auth: { mode: auth },
    }),
  } as unknown as StageContext;
  return { emit, on: agentEvents(ctx) };
}

describe("agent events from TinyFish polls", () => {
  it("sends each step once, in TinyFish's words, and skips polls where nothing changed", () => {
    const { emit, on } = setup();
    const live = "https://tinyfish.example/stream/1";
    on("scout", "Find the entrance", "started");
    on("scout", "Find the entrance", "step", run([], live));
    on(
      "scout",
      "Find the entrance",
      "step",
      run([step("a", "Click Sign up")], live),
    );
    on(
      "scout",
      "Find the entrance",
      "step",
      run([step("a", "Click Sign up")], live),
    );
    on(
      "scout",
      "Find the entrance",
      "step",
      run([step("a", "Click Sign up")], live),
    );
    on(
      "scout",
      "Find the entrance",
      "step",
      run([step("a", "Click Sign up"), step("b", null)], live),
    );
    on("scout", "Find the entrance", "done");
    on("scout", "Find the entrance", "done");

    expect(emit.mock.calls.map(([e]) => [e.status, e.step])).toEqual([
      ["started", undefined],
      ["step", undefined],
      ["step", "Click Sign up"],
      ["step", "Step 2"],
      ["done", undefined],
    ]);
    expect(emit.mock.calls[1]![0].streamingUrl).toBe(live);
    expect(emit.mock.calls[4]![0].streamingUrl).toBe(live);
  });

  it("keeps each agent's steps apart", () => {
    const { emit, on } = setup();
    on("a", "A", "step", run([step("1", "one")]));
    on("b", "B", "step", run([step("1", "uno")]));
    on("a", "A", "step", run([step("1", "one"), step("2", "two")]));
    expect(emit.mock.calls.map(([e]) => `${e.agentId}:${e.step}`)).toEqual([
      "a:one",
      "b:uno",
      "a:two",
    ]);
  });

  it("never sends a signed-in run's live view", () => {
    const { emit, on } = setup("sign-in-once");
    on(
      "scout",
      "Find the entrance",
      "step",
      run([step("a", "Open settings")], "https://tinyfish.example/stream/2"),
    );
    expect(emit.mock.calls[0]![0].streamingUrl).toBeUndefined();
  });
});
