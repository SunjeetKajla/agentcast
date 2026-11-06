import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MusicPlan, type Edl, type MusicTrack } from "@agentcast/shared";
import { musicStyle } from "./music.ts";

// A music-led film's music (PRD §9.7.2): in at a strong bar, out through the track's real ending, joined
// on bar lines. The film sets the length, in whole bars of the track's grid.

const exec = promisify(execFile);
const JOIN = 0.03;

/** Seconds a beat of the track lasts, and a bar. */
export const beatsOf = (track: Pick<MusicTrack, "bpm">) => ({ beat: 60 / track.bpm, bar: (60 / track.bpm) * 4 });

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The music for a film of `seconds` whose last `ending` seconds are its end card. Enters at the first
 * strong bar that leaves room before the ending; a track too short for that plays straight through
 * from the strongest entry it has, and the film's fade carries the end.
 */
export function planMusic(track: MusicTrack, seconds: number, ending: number): MusicPlan {
  const { beat, bar } = beatsOf(track);
  const { entries, tailEnd } = track.analysis;
  const endBars = Math.max(1, Math.round(ending / bar));
  const endSeconds = endBars * bar;
  const endStart = track.firstBeat + Math.floor((tailEnd - endSeconds - track.firstBeat) / bar) * bar;
  const body = Math.max(0, seconds - endSeconds);
  const base = { schemaVersion: 1 as const, trackId: track.id, bpm: track.bpm, beat: r3(beat), bar: r3(bar), seconds: r3(seconds) };
  const entry = entries.find((e) => e + body <= endStart);
  if (entry === undefined || body === 0) {
    const from = entries.find((e) => e + seconds <= track.seconds) ?? track.firstBeat;
    return MusicPlan.parse({ ...base, spans: [{ at: 0, mediaStart: r3(from), seconds: r3(seconds) }] });
  }
  return MusicPlan.parse({
    ...base,
    spans: [
      { at: 0, mediaStart: r3(entry), seconds: r3(body) },
      { at: r3(body), mediaStart: r3(endStart), seconds: r3(seconds - body) },
    ],
  });
}

/** `style.music` for the premixed plan: its own file, played from its start. */
export const ledStyle = (track: MusicTrack): Edl["style"]["music"] => ({ ...musicStyle(track, "trailer"), firstBeat: 0 });

/** Writes the plan's music to one file, so the composition has a single music element. */
export async function premixMusic(plan: MusicPlan, file: string, out: string, signal?: AbortSignal) {
  const cuts = plan.spans.map(
    (s, i) => `[0:a]atrim=${s.mediaStart}:${s.mediaStart + s.seconds + (i < plan.spans.length - 1 ? JOIN : 0)},asetpts=PTS-STARTPTS[s${i}]`,
  );
  const graph =
    plan.spans.length === 1 ? `${cuts[0]};[s0]anull[m]` : `${cuts.join(";")};[s0][s1]acrossfade=d=${JOIN}:c1=tri:c2=tri[m]`;
  await exec("ffmpeg", ["-v", "error", "-y", "-i", file, "-filter_complex", graph, "-map", "[m]", "-ar", "48000", "-b:a", "320k", out], {
    ...(signal ? { signal } : {}),
  });
}
