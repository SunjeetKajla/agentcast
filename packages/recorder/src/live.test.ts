import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withBrowser: vi.fn(),
  start: vi.fn(),
  encode: vi.fn(),
}));
vi.mock("./browser.ts", () => ({ withRecorderBrowser: mocks.withBrowser }));
vi.mock("./screencast.ts", () => ({ startScreencast: mocks.start }));
vi.mock("./encode.ts", () => ({ encodeCfrMp4: mocks.encode }));
import { LiveStallError, recordLive } from "./live.ts";

let directory: string;
let clock: number;
let smoothAfter: number;
let launches: number;
let closed = vi.fn<() => void>();

beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(tmpdir(), "agentcast-live-test-"));
  clock = 0;
  smoothAfter = 1;
  launches = 0;
  closed = vi.fn();
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  mocks.withBrowser.mockImplementation(async (_options, run) => {
    launches++;
    const session = {
      context: new EventEmitter(),
      page: {
        viewportSize: () => ({ width: 320, height: 180 }),
        evaluate: async () => 1,
      },
      close: closed,
      gpu: { backend: "cpu" },
    };
    try {
      return await run(session);
    } finally {
      closed();
    }
  });
  mocks.start.mockImplementation(async (_page, options) => {
    const startedAtMs = clock;
    const take = launches;
    return {
      startedAtMs,
      failure: new Promise(() => {}),
      stop: async () => {
        const durationMs = clock - startedAtMs;
        const points =
          take >= smoothAfter
            ? Array.from(
                { length: Math.max(1, Math.ceil(durationMs / 16)) },
                (_, i) => i * 16,
              )
            : [0];
        return {
          directory: options.directory,
          startedAtMs,
          durationMs,
          frames: points.map((time, i) => ({
            file: `frame-${String(i).padStart(8, "0")}.jpg`,
            timestampMs: time,
            receivedAtMs: startedAtMs + time,
          })),
        };
      },
    };
  });
  mocks.encode.mockImplementation(async (_capture, path) => ({
    path,
    duration: 1,
    fps: 30,
    frameCount: 30,
    encoder: "libx264",
    attempts: [],
  }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("Live take orchestration", () => {
  it("retries a failed quality check on a fresh browser and encodes only the clean take", async () => {
    smoothAfter = 2;
    const prepare = vi.fn().mockResolvedValue(undefined);
    const result = await recordLive(
      { outputPath: join(directory, "clip.mp4"), prepare },
      async ({ motion }) => {
        await motion(async () => {
          clock += 1000;
        });
      },
    );
    expect(result.takes.map((take) => take.stall.status)).toEqual([
      "failed",
      "passed",
    ]);
    expect(result.mode).toBe("live");
    expect(launches).toBe(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledTimes(2);
    expect(mocks.encode).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toEqual([]);
  });

  it("fails after at most three stalled takes and leaves no partial artifact", async () => {
    smoothAfter = Infinity;
    await expect(
      recordLive(
        { outputPath: join(directory, "clip.mp4") },
        async ({ motion }) => {
          await motion(async () => {
            clock += 1000;
          });
        },
      ),
    ).rejects.toBeInstanceOf(LiveStallError);
    expect(launches).toBe(3);
    expect(mocks.encode).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it("keeps a static hold without treating low paint frequency as failure", async () => {
    smoothAfter = Infinity;
    const result = await recordLive(
      { outputPath: join(directory, "clip.mp4") },
      async () => {
        clock += 2000;
      },
    );
    expect(result.stall.status).toBe("not-applicable");
    expect(launches).toBe(1);
  });

  it("preserves action errors without replaying mutating actions", async () => {
    const failure = new Error("action failed");
    await expect(
      recordLive({ outputPath: join(directory, "clip.mp4") }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(launches).toBe(1);
    expect(mocks.encode).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it("refuses to overwrite an existing recording before launching anything", async () => {
    const path = join(directory, "clip.mp4");
    await writeFile(path, "existing");
    await expect(recordLive({ outputPath: path }, vi.fn())).rejects.toThrow(
      "already exists",
    );
    expect(launches).toBe(0);
  });

  it("honors cancellation and cleans up the active take", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    await expect(
      recordLive(
        { outputPath: join(directory, "clip.mp4"), signal: controller.signal },
        async () => {
          controller.abort(reason);
          await new Promise(() => {});
        },
      ),
    ).rejects.toBe(reason);
    expect(closed).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toEqual([]);
  });

  it("bounds stalled action callbacks by the take deadline", async () => {
    await expect(
      recordLive(
        { outputPath: join(directory, "clip.mp4"), timeoutMs: 20 },
        async () => {
          await new Promise(() => {});
        },
      ),
    ).rejects.toThrow("timed out");
    expect(await readdir(directory)).toEqual([]);
  });
});
