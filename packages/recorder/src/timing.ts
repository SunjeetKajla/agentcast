export interface CapturedFrame {
  /** Generated relative JPEG filename in the capture directory. */
  file: string;
  timestampMs: number;
  receivedAtMs: number;
}

export interface MotionWindow {
  startMs: number;
  endMs: number;
}

export interface StallReport {
  status: "passed" | "failed" | "not-applicable";
  maxGapMs: number;
  p95GapMs: number;
  motionDurationMs: number;
  effectiveFps: number;
  gaps: number[];
}

export function median(values: number[]): number {
  if (!values.length) throw new Error("No clock samples");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Both clocks are in milliseconds; CDP's timestamp is originally in seconds. */
export function alignFrames(frames: CapturedFrame[], startedAtMs: number) {
  const offsetMs = median(
    frames.map((frame) => frame.receivedAtMs - frame.timestampMs),
  );
  return frames.map((frame) => ({
    ...frame,
    sceneMs: frame.timestampMs + offsetMs - startedAtMs,
  }));
}

/** Evaluate the original capture cadence, never duplicated CFR output frames. */
export function checkStalls(
  frameTimesMs: number[],
  windows: MotionWindow[],
  durationMs: number,
): StallReport {
  const merged: MotionWindow[] = [];
  for (const window of [...windows].sort((a, b) => a.startMs - b.startMs)) {
    if (
      ![window.startMs, window.endMs].every(Number.isFinite) ||
      window.endMs < window.startMs
    )
      throw new Error("Invalid motion window");
    const startMs = Math.max(0, window.startMs);
    const endMs = Math.min(durationMs, window.endMs);
    if (endMs <= startMs) continue;
    const previous = merged.at(-1);
    if (previous && startMs <= previous.endMs)
      previous.endMs = Math.max(previous.endMs, endMs);
    else merged.push({ startMs, endMs });
  }
  const times = [...new Set(frameTimesMs)].sort((a, b) => a - b);
  if (!times.every(Number.isFinite)) throw new Error("Invalid frame time");
  const gaps: number[] = [];
  let motionFrames = 0;
  let motionDurationMs = 0;
  for (const { startMs, endMs } of merged) {
    const inside = times.filter((time) => time > startMs && time < endMs);
    // Include both boundaries: a capture that stops producing frames must fail too.
    const boundaries = [startMs, ...inside, endMs];
    for (let i = 1; i < boundaries.length; i++)
      gaps.push(boundaries[i]! - boundaries[i - 1]!);
    motionFrames += inside.length;
    motionDurationMs += endMs - startMs;
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const p95GapMs = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
  const maxGapMs = sorted.at(-1) ?? 0;
  return {
    status: !motionDurationMs
      ? "not-applicable"
      : maxGapMs > 250 || p95GapMs > 60
        ? "failed"
        : "passed",
    maxGapMs,
    p95GapMs,
    motionDurationMs,
    effectiveFps: motionDurationMs
      ? (motionFrames * 1000) / motionDurationMs
      : 0,
    gaps,
  };
}

export interface CfrPlan {
  manifest: string;
  frameCount: number;
  duration: number;
  fps: 30;
}

/** Explicit image timebase avoids the concat demuxer's default 25 fps quantization. */
export function buildCfrPlan(
  frames: CapturedFrame[],
  startedAtMs: number,
  durationMs: number,
): CfrPlan {
  if (!frames.length || !Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("A recording needs frames and a positive duration");
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    if (
      !/^frame-\d+\.jpg$/.test(frame.file) ||
      !Number.isFinite(frame.timestampMs) ||
      !Number.isFinite(frame.receivedAtMs)
    )
      throw new Error("Invalid captured frame");
    if (i && frame.timestampMs <= frames[i - 1]!.timestampMs)
      throw new Error("Frame timestamps must increase");
  }
  const aligned = alignFrames(frames, startedAtMs);
  const frameCount = Math.max(1, Math.ceil((durationMs * 30) / 1000));
  const duration = frameCount / 30;
  // Carry the latest pre-roll frame into scene time zero.
  let first = 0;
  while (first + 1 < aligned.length && aligned[first + 1]!.sceneMs <= 0)
    first++;
  const selected = aligned
    .slice(first)
    .filter((frame, index) => index === 0 || frame.sceneMs < durationMs);
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < selected.length; i++) {
    const frame = selected[i]!;
    const start = i ? Math.max(0, frame.sceneMs) : 0;
    const end =
      i + 1 < selected.length
        ? Math.max(0, selected[i + 1]!.sceneMs)
        : duration * 1000;
    if (end <= start) continue;
    lines.push(
      `file '${frame.file}'`,
      "option framerate 1000",
      `duration ${((end - start) / 1000).toFixed(9)}`,
    );
  }
  // A terminal duplicate gives the last image its explicit hold duration.
  lines.push(`file '${selected.at(-1)!.file}'`, "option framerate 1000");
  return { manifest: lines.join("\n") + "\n", frameCount, duration, fps: 30 };
}
