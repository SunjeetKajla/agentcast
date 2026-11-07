import { describe, expect, it, vi } from "vitest";
import { JobConfig } from "@agentcast/shared";
import type { StageContext } from "../context";
import { agentEvents } from "./discover";
function setup(mode: "public" | "sign-in-once" = "public") {
  const emit = vi.fn();
  const on = agentEvents({
    emit,
    stage: "discover",
    config: JobConfig.parse({ url: "https://product.example", auth: { mode } }),
  } as unknown as StageContext);
  return { emit, on };
}
describe("observed browser progress", () => {
  it("emits each observed step once and includes local public frames", () => {
    const { emit, on } = setup();
    const update = {
      status: "RUNNING" as const,
      steps: [
        {
          id: "1",
          action: "Open preview",
          screenshot: "explore/frames/scout/1.png",
        },
      ],
    };
    on("scout", "Scout", "started");
    on("scout", "Scout", "step", update);
    on("scout", "Scout", "step", update);
    on("scout", "Scout", "done");
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls[1]![0]).toMatchObject({
      step: "Open preview",
      screenshot: "explore/frames/scout/1.png",
    });
  });
  it("suppresses frames for authenticated runs", () => {
    const { emit, on } = setup("sign-in-once");
    on("a", "A", "step", {
      status: "RUNNING",
      steps: [{ id: "1", action: "Open preview", screenshot: "private.png" }],
    });
    expect(emit.mock.calls[0]![0]).not.toHaveProperty("screenshot");
  });
  it("keeps independent agents apart", () => {
    const { emit, on } = setup();
    for (const id of ["a", "b"])
      on(id, id, "step", {
        status: "RUNNING",
        steps: [{ id: "1", action: id }],
      });
    expect(emit.mock.calls.map(([e]) => e.agentId)).toEqual(["a", "b"]);
  });
});
