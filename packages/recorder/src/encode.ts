import { execFile } from "node:child_process";
import { link, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildCfrPlan, type CfrPlan } from "./timing.ts";
import type { CaptureResult } from "./screencast.ts";

export type VideoEncoder = "h264_nvenc" | "h264_qsv" | "libx264";
export interface EncodingOptions {
  encoder?: "auto" | VideoEncoder;
  ffmpegPath?: string;
  ffprobePath?: string;
  signal?: AbortSignal;
  /** Per ffmpeg/ffprobe command. Default: 120 s, or 10 s per second of video for longer clips. */
  timeoutMs?: number;
}
export interface EncodingAttempt {
  encoder: VideoEncoder;
  status: "selected" | "failed";
  reason?: "probe-failed" | "encoding-or-validation-failed";
}
export interface EncodedVideo {
  path: string;
  encoder: VideoEncoder;
  width: number;
  height: number;
  fps: 30;
  frameCount: number;
  duration: number;
  attempts: EncodingAttempt[];
}

const execFileAsync = promisify(execFile);

/** Async child process with bounded output/time and explicit cancellation. */
export async function runMediaCommand(
  executable: string,
  args: string[],
  options: { signal?: AbortSignal; timeout?: number; maxBuffer?: number } = {},
) {
  options.signal?.throwIfAborted();
  const operation = execFileAsync(executable, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    signal: options.signal,
    killSignal: "SIGKILL",
  });
  const onExit = () => {
    operation.child.kill("SIGKILL");
  };
  process.once("exit", onExit);
  try {
    return await operation;
  } finally {
    process.off("exit", onExit);
  }
}

function codecArgs(encoder: VideoEncoder): string[] {
  switch (encoder) {
    case "h264_nvenc":
      return [
        "-c:v",
        encoder,
        "-preset",
        "p4",
        "-rc",
        "vbr",
        "-cq",
        "16",
        "-b:v",
        "0",
      ];
    case "h264_qsv":
      return ["-c:v", encoder, "-preset", "fast", "-global_quality", "16"];
    case "libx264":
      return ["-c:v", encoder, "-preset", "veryfast", "-crf", "16"];
  }
}

export async function probeEncoder(
  encoder: VideoEncoder,
  options: EncodingOptions = {},
): Promise<void> {
  await runMediaCommand(
    options.ffmpegPath ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=640x360:rate=30",
      "-frames:v",
      "1",
      "-an",
      ...codecArgs(encoder),
      "-f",
      "null",
      "-",
    ],
    { signal: options.signal, timeout: 10_000 },
  );
}

// Which encoders this machine has doesn't change while the worker runs: probe each once.
const probes = new Map<string, Promise<void>>();

/** For tests. */
export function clearEncoderProbes(): void {
  probes.clear();
}

function probeEncoderOnce(encoder: VideoEncoder, options: EncodingOptions): Promise<void> {
  const key = `${options.ffmpegPath ?? "ffmpeg"}\0${encoder}`;
  let probe = probes.get(key);
  if (!probe) {
    probe = probeEncoder(encoder, options);
    probes.set(key, probe);
    // A cancelled probe says nothing about the encoder; let the next encode probe again.
    probe.catch(() => {
      if (options.signal?.aborted) probes.delete(key);
    });
  }
  return probe;
}

/** Reject a malformed/non-CFR artifact before making it visible to the worker. */
export async function validateCfrMp4(
  path: string,
  plan: Pick<CfrPlan, "duration" | "frameCount"> & {
    expectedSize?: { width: number; height: number };
  },
  options: EncodingOptions = {},
): Promise<{ width: number; height: number }> {
  const { stdout } = await runMediaCommand(
    options.ffprobePath ?? "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      // Packets, not frames: the same timestamps and keyframe flags without decoding every frame.
      "-show_packets",
      "-show_entries",
      "stream=codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:packet=pts_time,flags",
      "-of",
      "json",
      path,
    ],
    { signal: options.signal, timeout: options.timeoutMs },
  );
  const result = JSON.parse(stdout) as {
    streams?: {
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      nb_frames?: string;
      duration?: string;
    }[];
    packets?: { pts_time?: string; flags?: string }[];
  };
  const stream = result.streams?.[0];
  // Packets come in decode order; with no B-frames (-bf 0) that is presentation order, but sort to be safe.
  const frames = result.packets
    ?.map((p) => ({ time: Number(p.pts_time), key: p.flags?.includes("K") ?? false }))
    .sort((a, b) => a.time - b.time);
  if (
    !stream ||
    !Array.isArray(frames) ||
    stream.codec_name !== "h264" ||
    stream.pix_fmt !== "yuv420p" ||
    stream.r_frame_rate !== "30/1" ||
    stream.avg_frame_rate !== "30/1" ||
    !Number.isInteger(stream.width) ||
    !Number.isInteger(stream.height) ||
    !stream.width ||
    !stream.height ||
    stream.width % 2 ||
    stream.height % 2 ||
    (plan.expectedSize &&
      (stream.width !== Math.ceil(plan.expectedSize.width / 2) * 2 ||
        stream.height !== Math.ceil(plan.expectedSize.height / 2) * 2)) ||
    frames.length !== plan.frameCount ||
    Number(stream.nb_frames) !== plan.frameCount ||
    !Number.isFinite(Number(stream.duration)) ||
    Math.abs(Number(stream.duration) - plan.duration) > 0.002
  )
    throw new Error(
      `Encoded MP4 failed its H.264/CFR/dimension/duration contract: ${JSON.stringify({ stream, frameCount: frames?.length, expectedFrameCount: plan.frameCount, expectedDuration: plan.duration })}`,
    );
  let lastKeyframe = 0;
  for (let i = 0; i < frames.length; i++) {
    const timestamp = frames[i]!.time;
    if (!Number.isFinite(timestamp) || Math.abs(timestamp - i / 30) > 0.0001)
      throw new Error("Encoded MP4 frame timestamps are not constant-rate");
    if (frames[i]!.key) lastKeyframe = i;
    if ((i === 0 && !frames[i]!.key) || i - lastKeyframe >= 15)
      throw new Error("Encoded MP4 has insufficient seeking keyframes");
  }
  return { width: stream.width, height: stream.height };
}

export async function encodeCfrMp4(
  capture: CaptureResult,
  outputPath: string,
  options: EncodingOptions = {},
): Promise<EncodedVideo> {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  )
    throw new Error("Encoding timeout must be positive");
  const plan = {
    ...buildCfrPlan(capture.frames, capture.startedAtMs, capture.durationMs),
    expectedSize: capture.expectedSize,
  };
  // A long take encoded on the CPU can run slower than real time at 2880x1800.
  const commandOptions = {
    ...options,
    timeoutMs: options.timeoutMs ?? Math.max(120_000, Math.ceil(plan.duration) * 10_000),
  };
  const manifestPath = join(capture.directory, "frames.ffconcat");
  await writeFile(manifestPath, plan.manifest, { mode: 0o600, flag: "wx" });
  const encodedPath = join(capture.directory, "encoded.mp4");
  const encoders: VideoEncoder[] =
    !options.encoder || options.encoder === "auto"
      ? ["h264_nvenc", "h264_qsv", "libx264"]
      : [options.encoder];
  const attempts: EncodingAttempt[] = [];
  const failures: unknown[] = [];
  for (const encoder of encoders) {
    options.signal?.throwIfAborted();
    try {
      await probeEncoderOnce(encoder, options);
    } catch (error) {
      options.signal?.throwIfAborted();
      failures.push(error);
      attempts.push({ encoder, status: "failed", reason: "probe-failed" });
      continue;
    }
    let dimensions: { width: number; height: number };
    try {
      await runMediaCommand(
        options.ffmpegPath ?? "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-xerror",
          "-err_detect",
          "explode",
          "-f",
          "concat",
          "-safe",
          // The generated manifest needs per-image options; filenames have
          // already been restricted to our own numbered JPEGs by buildCfrPlan.
          "0",
          "-i",
          manifestPath,
          "-an",
          "-vf",
          `fps=30:start_time=0:round=near,pad=ceil(iw/2)*2:ceil(ih/2)*2,scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=${encoder === "h264_qsv" ? "nv12" : "yuv420p"}`,
          ...codecArgs(encoder),
          "-color_range",
          "tv",
          "-colorspace",
          "bt709",
          "-g",
          "15",
          "-bf",
          "0",
          "-frames:v",
          String(plan.frameCount),
          "-fps_mode",
          "cfr",
          "-video_track_timescale",
          "90000",
          "-movflags",
          "+faststart",
          encodedPath,
        ],
        { signal: options.signal, timeout: commandOptions.timeoutMs },
      );
      dimensions = await validateCfrMp4(encodedPath, plan, commandOptions);
    } catch (error) {
      options.signal?.throwIfAborted();
      failures.push(error);
      attempts.push({
        encoder,
        status: "failed",
        reason: "encoding-or-validation-failed",
      });
      await unlink(encodedPath).catch(() => {});
      continue;
    }
    // Same-filesystem promotion is atomic and refuses to overwrite an existing
    // recording, including one created concurrently after the take started.
    options.signal?.throwIfAborted();
    await link(encodedPath, resolve(outputPath));
    await unlink(encodedPath);
    attempts.push({ encoder, status: "selected" });
    return {
      path: resolve(outputPath),
      encoder,
      ...dimensions,
      fps: 30,
      frameCount: plan.frameCount,
      duration: plan.duration,
      attempts,
    };
  }
  throw new AggregateError(
    failures,
    "No encoder produced a valid CFR H.264 MP4",
  );
}
