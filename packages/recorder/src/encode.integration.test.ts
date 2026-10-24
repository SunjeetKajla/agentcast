import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { encodeCfrMp4, probeEncoder, runMediaCommand } from "./encode.ts";
import type { CaptureResult } from "./screencast.ts";

const available = await Promise.all(
  ["ffmpeg", "ffprobe"].map((tool) =>
    runMediaCommand(tool, ["-version"]).then(
      () => true,
      () => false,
    ),
  ),
);
const directories: string[] = [];
let red: Buffer;
let blue: Buffer;

async function source(durationMs: number, points: number[] = [0]) {
  const directory = await mkdtemp(join(tmpdir(), "agentcast-encode-"));
  directories.push(directory);
  const frames = await Promise.all(
    points.map(async (time, i) => {
      const file = `frame-${String(i).padStart(8, "0")}.jpg`;
      await writeFile(join(directory, file), i % 2 ? blue : red);
      return { file, timestampMs: time, receivedAtMs: time };
    }),
  );
  return {
    directory,
    startedAtMs: 0,
    durationMs,
    frames,
  } satisfies CaptureResult;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.skipIf(available.includes(false))(
  "CFR encoding with real FFmpeg",
  () => {
    it.runIf(process.env.AGENTCAST_REQUIRE_NVENC === "1")(
      "initializes the NVIDIA encoder on the actual device",
      async () => {
        await probeEncoder("h264_nvenc");
      },
    );
    beforeAll(async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "agentcast-jpeg-fixture-"),
      );
      try {
        for (const color of ["red", "blue"]) {
          const path = join(directory, `${color}.jpg`);
          await runMediaCommand("ffmpeg", [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            `color=${color}:size=320x180`,
            "-frames:v",
            "1",
            "-update",
            "1",
            path,
          ]);
        }
        red = await readFile(join(directory, "red.jpg"));
        blue = await readFile(join(directory, "blue.jpg"));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("encodes a static frame for the complete hold duration at exactly 30 fps", async () => {
      const capture = await source(1010);
      const video = await encodeCfrMp4(
        capture,
        join(capture.directory, "static.mp4"),
        { encoder: "libx264" },
      );
      expect(video).toMatchObject({
        fps: 30,
        frameCount: 31,
        width: 320,
        height: 180,
        encoder: "libx264",
      });
      expect(video.duration).toBeCloseTo(31 / 30);
    });

    it("preserves variable source timing and final holds instead of speeding up sparse frames", async () => {
      const capture = await source(1500, [0, 100, 1100]);
      const video = await encodeCfrMp4(
        capture,
        join(capture.directory, "variable.mp4"),
        { encoder: "libx264" },
      );
      expect(video.frameCount).toBe(45);
      // The middle blue image should still be visible 800 ms into the video.
      const path = join(capture.directory, "pixel.rgb");
      await runMediaCommand("ffmpeg", [
        "-v",
        "error",
        "-ss",
        "0.8",
        "-i",
        video.path,
        "-frames:v",
        "1",
        "-vf",
        "scale=1:1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        path,
      ]);
      const pixel = await readFile(path);
      expect(pixel[2]).toBeGreaterThan(200);
      expect(pixel[0]).toBeLessThan(30);
    });

    it("actually probes hardware encoders and falls back to a usable encoder", async () => {
      const capture = await source(300);
      const video = await encodeCfrMp4(
        capture,
        join(capture.directory, "auto.mp4"),
      );
      expect(["h264_nvenc", "h264_qsv", "libx264"]).toContain(video.encoder);
      expect(video.attempts.at(-1)?.status).toBe("selected");
      expect(video.frameCount).toBe(9);
      if (process.env.AGENTCAST_REQUIRE_NVENC === "1")
        expect(video.encoder).toBe("h264_nvenc");
    });

    it("rejects corrupted source JPEGs instead of hiding decode errors behind duplicated frames", async () => {
      const capture = await source(300, [0, 100]);
      await writeFile(
        join(capture.directory, capture.frames[1]!.file),
        Buffer.from([0xff, 0xd8, 0x00]),
      );
      const path = join(capture.directory, "broken.mp4");
      await expect(
        encodeCfrMp4(capture, path, { encoder: "libx264" }),
      ).rejects.toThrow("No encoder produced");
    });

    it("does not overwrite an existing output file", async () => {
      const capture = await source(100);
      const path = join(capture.directory, "existing.mp4");
      await writeFile(path, "existing recording");
      await expect(
        encodeCfrMp4(capture, path, { encoder: "libx264" }),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(path, "utf8")).toBe("existing recording");
    });

    it("cancels media processes when their signal is aborted", async () => {
      const controller = new AbortController();
      const result = runMediaCommand(
        "ffmpeg",
        [
          "-v",
          "error",
          "-re",
          "-f",
          "lavfi",
          "-i",
          "color=black:size=128x128",
          "-f",
          "null",
          "-",
        ],
        { signal: controller.signal },
      );
      const assertion = expect(result).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      await assertion;
    });
  },
);
