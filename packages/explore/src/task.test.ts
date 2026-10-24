import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import {
  TinyFishTransportError,
  type Run,
  type TinyFish,
} from "@agentcast/tinyfish";
import { ExplorationTask } from "./artifacts";
import { requestHash, runTask, safeReport } from "./task";
import type { ArtifactIO } from "./runtime";

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
const run = (status: Run["status"] = "COMPLETED"): Run => ({
  run_id: "remote-1",
  status,
  result: status === "COMPLETED" ? { done: true } : null,
  goal: "",
  created_at: "",
  started_at: null,
  finished_at: null,
  num_of_steps: 0,
  error: null,
  steps: [],
  streaming_url: null,
  video_url: null,
});
const io = (): ArtifactIO => ({
  read: (name, shape) => readArtifact(join(dir, name), shape),
  write: (name, shape, value) => writeArtifact(join(dir, name), shape, value),
});
const client = () => ({
  runAsync: vi.fn().mockResolvedValue("remote-1"),
  getRun: vi.fn().mockResolvedValue(run()),
  cancelRun: vi.fn().mockResolvedValue(undefined),
});

describe("durable exploration tasks", () => {
  it("sends cancellation immediately even while a polling callback is still running", async () => {
    const tf = client();
    tf.getRun.mockResolvedValue(run("RUNNING"));
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const abort = new AbortController();
    const pending = runTask({
      id: "scout",
      request,
      schema,
      io: io(),
      tf: tf as unknown as TinyFish,
      maxMs: 5000,
      signal: abort.signal,
      onUpdate: async () => {
        entered();
        await blocked;
      },
    });
    const result = pending.catch((error) => error);
    try {
      await ready;
      abort.abort(new Error("fixture cancelled"));
      expect(tf.cancelRun).toHaveBeenCalledExactlyOnceWith("remote-1");
    } finally {
      release();
    }
    expect(await result).toMatchObject({ message: "fixture cancelled" });
    expect(tf.cancelRun).toHaveBeenCalledTimes(1);
  });
  it("writes the run id before polling and reuses the completed result without another POST", async () => {
    const tf = client();
    tf.getRun.mockImplementation(async () => {
      expect(
        (await io().read("explore/tasks/scout.json", ExplorationTask)).runId,
      ).toBe("remote-1");
      return run();
    });
    const options = {
      id: "scout",
      request,
      schema,
      io: io(),
      tf: tf as unknown as TinyFish,
      maxMs: 1000,
    };
    expect(await runTask(options)).toEqual({
      runId: "remote-1",
      result: { done: true },
    });
    await runTask(options);
    expect(tf.runAsync).toHaveBeenCalledTimes(1);
    expect(tf.getRun).toHaveBeenCalledTimes(1);
  });
  it("preserves an ambiguous create and never submits it again", async () => {
    const tf = client();
    tf.runAsync.mockRejectedValue(
      new TinyFishTransportError("POST", "/run-async", "NETWORK_ERROR"),
    );
    const options = {
      id: "scout",
      request,
      schema,
      io: io(),
      tf: tf as unknown as TinyFish,
      maxMs: 1000,
    };
    await expect(runTask(options)).rejects.toThrow("NETWORK_ERROR");
    await expect(runTask(options)).rejects.toThrow("not be submitted twice");
    expect(tf.runAsync).toHaveBeenCalledTimes(1);
    expect(
      (await io().read("explore/tasks/scout.json", ExplorationTask)).state,
    ).toBe("uncertain");
  });
  it("resumes a known run after a worker restart and refuses changed goals", async () => {
    await io().write("explore/tasks/scout.json", ExplorationTask, {
      schemaVersion: 1,
      id: "scout",
      requestHash: requestHash(request),
      state: "running",
      runId: "remote-1",
      startedAt: "",
      updatedAt: "",
    });
    const tf = client();
    await runTask({
      id: "scout",
      request,
      schema,
      io: io(),
      tf: tf as unknown as TinyFish,
      maxMs: 1000,
    });
    expect(tf.runAsync).not.toHaveBeenCalled();
    await expect(
      runTask({
        id: "scout",
        request: { ...request, goal: "changed" },
        schema,
        io: io(),
        tf: tf as unknown as TinyFish,
        maxMs: 1000,
      }),
    ).rejects.toThrow("inputs changed");
  });
  it("recovers a terminal result after a polling transport race", async () => {
    const tf = client();
    tf.getRun.mockRejectedValueOnce(new Error("disconnected"));
    const result = await runTask({
      id: "scout",
      request,
      schema,
      io: io(),
      tf: tf as unknown as TinyFish,
      maxMs: 1000,
    });
    expect(result.result.done).toBe(true);
    expect(tf.runAsync).toHaveBeenCalledTimes(1);
    expect(tf.cancelRun).not.toHaveBeenCalled();
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
