// What the bench and the eval measure in a rendered film: loudness, falls, sound sync, scene changes,
// still time and sound cues. Shared so both report the same numbers the same way.
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { measureVideo } from "@agentcast/video";

const exec = promisify(execFile);
const teardown = join(dirname(fileURLToPath(import.meta.url)), "..", "s8-teardown");

export type FilmMeasure = {
  seconds: number;
  lufs: number | "none";
  truePeak: number | "none";
  /** The largest fall between neighbouring 2 s windows, before the last 4 s. */
  fallDb: number;
  /** Share of visual events on an audio onset, and what chance would give. */
  sync: number;
  chance: number;
  "changes/10s": number;
  "still%": number;
  cues: number;
};

/** Measures `file` (rendered from `root`, whose composition is in `build/<variant>/`); scratch goes in `<root>/metrics`. */
export async function measureFilm(file: string, root: string, variant: string): Promise<FilmMeasure> {
  const measured = await measureVideo(file);
  const metrics = join(root, "metrics");
  await mkdir(metrics, { recursive: true });
  await exec("python3", ["-P", join(teardown, "analyze.py"), file, metrics, metrics], { maxBuffer: 1 << 26 });
  const name = basename(file).replace(/\.[^.]+$/, "");
  const analysed = JSON.parse(await readFile(join(metrics, `${name}.json`), "utf8")) as Record<string, number>;
  const { stdout } = await exec("python3", ["-P", join(teardown, "av.py"), file], { maxBuffer: 1 << 26 });
  const av = JSON.parse(stdout) as { vis_on_audio_onset: number; chance: number; arc_db_per_2s: number[] };
  // Falls are what pump: a rise is the music building, or a voice coming in. The ending may fall away.
  const arc = av.arc_db_per_2s.slice(0, -2);
  const fall = arc.slice(1).reduce((most, db, i) => Math.max(most, arc[i]! - db), 0);
  const html = await readFile(join(root, "build", variant, "index.html"), "utf8").catch(() => "");
  return {
    seconds: measured.seconds,
    lufs: measured.lufs ?? "none",
    truePeak: measured.truePeak ?? "none",
    fallDb: fall,
    sync: av.vis_on_audio_onset,
    chance: av.chance,
    "changes/10s": analysed.scene_changes_per_10s!,
    "still%": analysed.still_pct!,
    cues: html.match(/id="sfx-/g)?.length ?? 0,
  };
}
