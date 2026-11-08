// The edit bench: re-renders fixed jobs' baseline edits and measures them against the launch-film
// targets (docs/MOTION_SOUND_MUSIC_PLAN.md §7). Works on copies, so the jobs stay as they are, with
// the director off, so it spends no provider quota.
//   pnpm --filter @agentcast/spikes bench --tag <name> [--jobs <id,id>] [--height 540] [--led] [--skeleton <id|auto>] [--art [--live-kit] [--director]] [--rerecord] [--aspect 16x9|9x16]
// --led cuts the film to its music, with no voice. --rerecord films the job's approved flows again in a
// local browser, for a recording with its page structure (the sites are public; no provider quota).
import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { FlowsFile, jobPaths, Timeline, type Aspect } from "@agentcast/shared";
import { recordFlow } from "@agentcast/recorder";
import { measureVideo, renderVideo } from "@agentcast/video";
import { jobInput, rebuiltEdl } from "../kaustav-hyperframes/job-input.ts";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = [
  "job_mvmno3l73a2772",
  "job_mvmoy4njdfc2fa",
  "job_mvmek99sacc3eb",
];
/** What a rebuild reads from a job. */
const COPIED = ["state.json", "brief", "explore", "record", "script", "voice"];

const { values } = parseArgs({
  options: {
    tag: { type: "string" },
    jobs: { type: "string" },
    height: { type: "string", default: "540" },
    aspect: { type: "string", default: "16x9" },
    led: { type: "boolean", default: false },
    rerecord: { type: "boolean", default: false },
    /** With --led: a skeleton from assets/references/, or auto (the one the worker would pick). */
    skeleton: { type: "string", default: "auto" },
    /** With --led: art direction by the rules table, as the script stage makes it (brand kit, layers, inventory). */
    art: { type: "boolean", default: false },
    /** With --art: inspect the live site in local Chrome first, as understand does, and build the brand kit from it. */
    "live-kit": { type: "boolean", default: false },
    /** With --art: the director's art direction call (spends the LLM login's quota), with its per-shot calls. */
    director: { type: "boolean", default: false },
  },
});
if (!values.tag) throw new Error("--tag <name> is required");
const jobs = values.jobs?.split(",") ?? FIXTURES;
const out = join(here, "..", "output", "bench", values.tag);
const teardown = join(here, "..", "s8-teardown");

/** Films the job's first approved flow again; its recording replaces the saved one, the story's spans move with it. */
async function rerecord(root: string, job: string) {
  const { flows } = FlowsFile.parse(JSON.parse(await readFile(join(root, jobPaths.flows), "utf8")));
  const flow = flows.filter((f) => f.selected && f.rehearsal?.ok !== false).sort((a, b) => a.rank - b.rank)[0];
  if (!flow) throw new Error(`${job} has no approved flow to record`);
  const takes = join(root, "record", "rerecord");
  await mkdir(takes, { recursive: true });
  console.log(`${job}: filming "${flow.title}"`);
  const take = await recordFlow(flow, {
    outputPath: join(takes, "take.mp4"),
    timelinePath: join(takes, "take.json"),
    replayPlanPath: join(root, jobPaths.replayPlan),
    recordingId: job,
    browser: { formFactor: "desktop" },
    locate: { timeoutMs: 30_000 },
  });
  await copyFile(take.path, join(root, jobPaths.recording("desktop")));
  await writeFile(join(root, jobPaths.timeline("desktop")), JSON.stringify(Timeline.parse(take.timeline)));
  // The storyboard's spans point into the old recording: one module per step of the new one.
  const storyboard = JSON.parse(await readFile(join(root, jobPaths.storyboard), "utf8")) as { beats: { flowId?: string; in?: number; out?: number }[] };
  const shots = storyboard.beats.filter((b) => b.flowId !== undefined);
  const each = take.timeline.duration / Math.max(1, shots.length);
  shots.forEach((b, i) => Object.assign(b, { flowId: flow.id, in: i * each, out: (i + 1) * each }));
  await writeFile(join(root, jobPaths.storyboard), JSON.stringify(storyboard));
}

type Row = Record<string, string | number>;
const rows: Row[] = [];
for (const job of jobs) {
  const source = join(
    process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast"),
    "jobs",
    job,
  );
  const root = join(out, job);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const name of COPIED)
    await cp(join(source, name), join(root, name), { recursive: true }).catch(
      () => {},
    );

  if (values.led) {
    const state = JSON.parse(await readFile(join(root, "state.json"), "utf8")) as { config: Record<string, unknown> };
    state.config = { ...state.config, voiceover: false, mode: "launch" };
    await writeFile(join(root, "state.json"), JSON.stringify(state));
  }
  if (values.rerecord) await rerecord(root, job);
  const edl = await rebuiltEdl(root, job, values.skeleton, values.art, { liveKit: values["live-kit"], director: values.director });
  const aspect = values.aspect as Aspect;
  const input = await jobInput(root, aspect, "en", Number(values.height), edl);
  const file = join(root, `${job}.mp4`);
  console.log(`${job}: rendering`);
  const started = Date.now();
  await renderVideo({ input, root, out: file });
  const seconds = (Date.now() - started) / 1000;

  const measured = await measureVideo(file);
  const metrics = join(root, "metrics");
  await mkdir(metrics, { recursive: true });
  await exec(
    "python3",
    ["-P", join(teardown, "analyze.py"), file, metrics, metrics],
    { maxBuffer: 1 << 26 },
  );
  const analysed = JSON.parse(
    await readFile(join(metrics, `${job}.json`), "utf8"),
  ) as Record<string, number>;
  const { stdout } = await exec(
    "python3",
    ["-P", join(teardown, "av.py"), file],
    { maxBuffer: 1 << 26 },
  );
  const av = JSON.parse(stdout) as {
    vis_on_audio_onset: number;
    chance: number;
    arc_db_per_2s: number[];
  };
  // The largest fall between neighbouring 2 s windows, before the last 4 s (the ending may fall away).
  // Falls are what pump: a rise is the music building, or a voice coming in.
  const arc = av.arc_db_per_2s.slice(0, -2);
  const fall = arc
    .slice(1)
    .reduce((most, db, i) => Math.max(most, arc[i]! - db), 0);
  rows.push({
    job: job.slice(-6),
    seconds: measured.seconds,
    lufs: measured.lufs ?? "none",
    truePeak: measured.truePeak ?? "none",
    fallDb: fall,
    sync: av.vis_on_audio_onset,
    chance: av.chance,
    "changes/10s": analysed.scene_changes_per_10s!,
    "still%": analysed.still_pct!,
    cues:
      (
        await readFile(
          join(root, "build", `${aspect}-en-` + values.height, "index.html"),
          "utf8",
        ).catch(() => "")
      ).match(/id="sfx-/g)?.length ?? 0,
    renderS: Math.round(seconds),
  });
}
await writeFile(join(out, "metrics.json"), JSON.stringify(rows, null, 2));
console.table(rows);
console.log(join(out, "metrics.json"));
