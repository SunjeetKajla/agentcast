import { run } from "./hyperframes/render.ts";

// measureVideo(): the reference-look numbers for a rendered video (PRD FR-88, §9.7.4): how much of it
// stands still, how loud it is, how much is silent, and how often it hard-cuts.

export type VideoMeasure = {
  seconds: number;
  /** Seconds in freezes of 0.5 s or more, and the share of the video they cover. */
  still: number;
  stillShare: number;
  /** The same with a freeze running to the end (the end card) left out. */
  stillShareExEnd: number;
  /** Integrated loudness (LUFS) and true peak (dBTP); undefined without audio. */
  lufs?: number;
  truePeak?: number;
  /** Seconds below −45 dB for 0.5 s or more. */
  silence: number;
  /** Scene changes the decoder sees (score > 0.3), a proxy for hard cuts. */
  cuts: number;
};

/** Measures a video with ffmpeg (freezedetect, ebur128, silencedetect, scene scores). */
export async function measureVideo(file: string, signal?: AbortSignal): Promise<VideoMeasure> {
  const seconds = Number(
    (await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], signal)).trim(),
  );
  const freeze = await run(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-map", "0:v:0", "-vf", "scale=320:-2,freezedetect=n=0.003:d=0.5", "-f", "null", "-"],
    signal,
  );
  const starts = [...freeze.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...freeze.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  // Back-to-back freezes are one hold; one that reaches the last frames is the end card.
  const spans: (readonly [number, number])[] = [];
  starts.forEach((s, i) => {
    const e = ends[i] ?? seconds;
    const prev = spans.at(-1);
    if (prev && s - prev[1] < 0.05) spans[spans.length - 1] = [prev[0], e];
    else spans.push([s, e]);
  });
  const still = spans.reduce((sum, [s, e]) => sum + (e - s), 0);
  const tail = spans.find(([, e]) => e >= seconds - 0.4);
  const stillExEnd = still - (tail ? tail[1] - tail[0] : 0);
  const body = seconds - (tail ? tail[1] - tail[0] : 0);
  let lufs: number | undefined;
  let truePeak: number | undefined;
  let silence = 0;
  const hasAudio = (
    await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], signal)
  ).trim();
  if (hasAudio) {
    const loud = await run(
      "ffmpeg",
      ["-hide_banner", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"],
      signal,
    );
    const summary = loud.slice(loud.lastIndexOf("Summary:"));
    lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    truePeak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
    const quiet = await run(
      "ffmpeg",
      ["-hide_banner", "-i", file, "-map", "0:a:0", "-af", "silencedetect=n=-45dB:d=0.5", "-f", "null", "-"],
      signal,
    );
    silence = [...quiet.matchAll(/silence_duration: ([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  } else silence = seconds;
  const scenes = await run(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-map", "0:v:0", "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo", "-f", "null", "-"],
    signal,
  );
  const cuts = [...scenes.matchAll(/pts_time:/g)].length;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    seconds: r(seconds),
    still: r(still),
    stillShare: r(still / seconds),
    stillShareExEnd: r(body > 0 ? stillExEnd / body : 0),
    ...(lufs !== undefined && Number.isFinite(lufs) ? { lufs } : {}),
    ...(truePeak !== undefined && Number.isFinite(truePeak) ? { truePeak } : {}),
    silence: r(silence),
    cuts,
  };
}
