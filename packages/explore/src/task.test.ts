import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import type { ExplorationAgent } from "@agentcast/browser";
import { ExplorationTask } from "./artifacts";
import { runTask, safeReport } from "./task";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-task-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const schema = z.object({ done: z.boolean() });
const request = {
  url: "https://product.example/",
  goal: "Inspect the public demo",
};
const io = () => ({
  read: <S extends z.ZodType>(name: string, shape: S) =>
    readArtifact(join(dir, name), shape),
  write: <S extends z.ZodType>(name: string, shape: S, value: z.input<S>) =>
    writeArtifact(join(dir, name), shape, value),
});
const options = () => ({
  id: "scout",
  request,
  schema,
  io: io(),
  agent: {
    run: vi.fn(async () => ({
      result: { done: true },
      sessionId: "local-session",
    })),
  } as unknown as ExplorationAgent,
  maxMs: 1000,
});
describe("durable local exploration tasks", () => {
  it("saves the attempt before execution and reuses only completed matching work", async () => {
    const o = options();
    vi.mocked(o.agent.run).mockImplementation(async () => {
      expect(
        (await o.io.read("explore/tasks/scout.json", ExplorationTask)).state,
      ).toBe("running");
      return { result: { done: true }, sessionId: "local-session" };
    });
    const first = await runTask(o);
    expect(first.result.done).toBe(true);
    expect((await runTask(o)).runId).toBe(first.runId);
    expect(o.agent.run).toHaveBeenCalledTimes(1);
    await expect(
      runTask({ ...o, request: { ...request, goal: "changed" } }),
    ).rejects.toThrow("inputs changed");
  });
  it("does not repeat an interrupted or legacy remote task", async () => {
    const o = options();
    await o.io.write("explore/tasks/scout.json", ExplorationTask, {
      schemaVersion: 1,
      id: "scout",
      runId: "legacy",
      state: "running",
      requestHash: "old",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expect(runTask(o)).rejects.toThrow("interrupted");
    expect(o.agent.run).not.toHaveBeenCalled();
  });
  it("propagates cancellation and saves an interrupted checkpoint", async () => {
    const o = options();
    const abort = new AbortController();
    vi.mocked(o.agent.run).mockImplementation(async (task) => {
      abort.abort(new Error("cancelled"));
      task.signal.throwIfAborted();
      throw Error("unreachable");
    });
    await expect(runTask({ ...o, signal: abort.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(
      (await o.io.read("explore/tasks/scout.json", ExplorationTask)).state,
    ).toBe("interrupted");
  });
  it("redacts secret typed values before persistence", () => {
    expect(
      safeReport({
        steps: [
          { action: "type", target_label: "API key", value: "private-value" },
        ],
        access_token: "private-token",
      }),
    ).toEqual({
      steps: [
        { action: "type", target_label: "API key", value: { redacted: true } },
      ],
      access_token: { redacted: true },
    });
  });
  it("also removes a secret echoed into reported targets, narration or result summaries", () => {
    const report = {
      value_shown: "Signed in with private-password",
      steps: [
        {
          action: "type",
          target_label: "Password",
          target_text: "private-password",
          value: "private-password",
          narration_hint: "Use private-password to enter",
        },
      ],
    };
    const safe = safeReport(report);
    expect(JSON.stringify(safe)).not.toContain("private-password");
    expect(safe).toMatchObject({
      steps: [
        {
          value: { redacted: true },
          target_text: "[redacted]",
          narration_hint: "Use [redacted] to enter",
        },
      ],
    });
    expect(report.steps[0]!.value).toBe("private-password");
  });
});
