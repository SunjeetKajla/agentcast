import { spawn } from "node:child_process";

/** A visible hold followed by a substantial picture jump, not merely a missing capture callback. */
export function stutterWindows(
  frames: Uint8Array[],
  fps: number,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let hold = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!,
      b = frames[i]!;
    if (a.length !== b.length || !a.length)
      throw new Error("Motion frames must have equal nonzero size");
    let delta = 0;
    for (let j = 0; j < a.length; j++) delta += Math.abs(a[j]! - b[j]!);
    delta /= a.length;
    if (delta < 0.12) hold++;
    else {
      if (hold >= fps * 0.25 && delta > 1.2)
        out.push({ from: (i - hold) / fps, to: i / fps });
      hold = 0;
    }
  }
  return out;
}

/** Low-resolution decoded motion evidence; callers restrict this to continuous motion, excluding cuts and state sequences. */
export function measureMotion(
  file: string,
  from: number,
  seconds: number,
  signal?: AbortSignal,
): Promise<{ from: number; to: number }[]> {
  const w = 192,
    h = 120,
    fps = 30;
  return new Promise((done, fail) => {
    const child = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        String(from),
        "-i",
        file,
        "-t",
        String(Math.min(15, seconds)),
        "-vf",
        `fps=${fps},scale=${w}:${h}`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-",
      ],
      { stdio: ["ignore", "pipe", "ignore"], signal },
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (b: Buffer) => {
      bytes += b.length;
      if (bytes > 16 * 1024 * 1024) child.kill("SIGKILL");
      else chunks.push(b);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return fail(new Error("Unable to decode selected motion"));
      const raw = Buffer.concat(chunks),
        frames: Uint8Array[] = [];
      for (let at = 0; at + w * h <= raw.length; at += w * h)
        frames.push(raw.subarray(at, at + w * h));
      done(
        stutterWindows(frames, fps).map((s) => ({
          from: from + s.from,
          to: from + s.to,
        })),
      );
    });
  });
}
