import { spawn } from "node:child_process";

function samples(
  file: string,
  from: number,
  seconds: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
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
        String(Math.min(3, seconds)),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "-",
      ],
      { stdio: ["ignore", "pipe", "ignore"], signal },
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return fail(new Error("Cannot decode product playback"));
      const bytes = Buffer.concat(chunks);
      done(
        new Float32Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.floor(bytes.length / 4),
        ),
      );
    });
  });
}

/** Small encoder/resampler offsets are tolerated. Music alone must not satisfy product playback. */
export function playbackCorrelation(
  source: Float32Array,
  mix: Float32Array,
): number {
  let best = 0;
  for (let lag = -80; lag <= 80; lag += 2) {
    let dot = 0,
      a2 = 0,
      b2 = 0;
    const start = Math.max(0, -lag),
      end = Math.min(source.length, mix.length - lag);
    for (let i = start; i < end; i++) {
      const a = source[i]!,
        b = mix[i + lag]!;
      dot += a * b;
      a2 += a * a;
      b2 += b * b;
    }
    if (a2 > 1e-8 && b2 > 1e-8) best = Math.max(best, dot / Math.sqrt(a2 * b2));
  }
  return best;
}

export async function verifyPlayback(o: {
  source: string;
  film: string;
  from: number;
  at: number;
  seconds: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  const [source, mix] = await Promise.all([
    samples(o.source, o.from, o.seconds, o.signal),
    samples(o.film, o.at, o.seconds, o.signal),
  ]);
  return (
    source.length >= 4000 &&
    mix.length >= 4000 &&
    playbackCorrelation(source, mix) >= 0.12
  );
}
