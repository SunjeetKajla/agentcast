// Checkpoint A (docs/MOTION_SOUND_MUSIC_PLAN.md §5): one hand-built 20 s film of Linear, to test the
// direction before any schema or compiler work. No voice. The music's bars set every time: 120 BPM,
// a bar is 2 s, and the film is 10 bars. Positions in the scenes are hand-measured on this recording.
//   pnpm --filter @agentcast/spikes checkpoint [--height 1080]
import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { Edl, MOTION_PRESETS, Timeline, jobPaths } from "@agentcast/shared";
import {
  BED_LUFS,
  compileComposition,
  ensureSfx,
  loadMusicLibrary,
  measureVideo,
  musicDir,
  musicStyle,
  renderComposition,
  soundShape,
  type SfxKind,
  type VideoInput,
} from "@agentcast/video";
import { SCENES } from "./scenes.ts";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { height: { type: "string", default: "1080" } },
});
const JOB = "job_mvn8okfx618eb0";
const home = process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast");
const root = join(here, "..", "output", "checkpoint");
const height = Number(values.height);

await rm(root, { recursive: true, force: true });
await mkdir(join(root, "render", "audio"), { recursive: true });
for (const name of ["record", "brief"])
  await cp(join(home, "jobs", JOB, name), join(root, name), {
    recursive: true,
  });
const recording = join(root, jobPaths.recording("desktop"));

// The music: in at a strong bar for 16 s, then the track's real ending for the end card, joined on bars.
const BAR = { entry: 24.025, ending: 180.025 };
const track = (await loadMusicLibrary())!.tracks.find(
  (t) => t.id === "enter-the-party",
)!;
const musicFile = join(root, "render", "audio", "music.mp3");
await exec("ffmpeg", [
  ...["-v", "error", "-y", "-i", join(musicDir(), track.file)],
  "-filter_complex",
  `[0:a]atrim=${BAR.entry}:${BAR.entry + 16.03},asetpts=PTS-STARTPTS[a];[0:a]atrim=${BAR.ending}:${BAR.ending + 4.5},asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=0.03:c1=tri:c2=tri[m]`,
  ...["-map", "[m]", "-ar", "48000", "-b:a", "320k", musicFile],
]);

// Stills from the recording, for the parts that animate piece by piece.
const assets = join(root, "stills");
await mkdir(assets, { recursive: true });
const still = (t: number, vf: string, name: string) =>
  exec("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    recording,
    "-vf",
    `select='gte(t,${t})'${vf}`,
    "-frames:v",
    "1",
    join(assets, name),
  ]);
await still(8.6, "", "board.png");
// White on black in the footage: its brightness becomes its alpha, so no box shows around it.
await still(
  0.1,
  ",crop=240:80:130:24,format=rgba,geq=r=255:g=255:b=255:a='clip((r(X,Y)-24)*1.3,0,255)'",
  "logo.png",
);

const motion = {
  ...MOTION_PRESETS.energetic,
  durations: { quick: 0, standard: 0, slow: 0 },
};
const scene = (id: string) => ({
  kind: "scene" as const,
  id,
  seconds: 4,
  transitionIn: "cut" as const,
});
const edl = Edl.parse({
  schemaVersion: 6,
  fps: 30,
  style: {
    palette: {
      bg: "#08090a",
      fg: "#f7f8f8",
      accent: "#f7f8f8",
      surface: "#191a1b",
    },
    fonts: { display: "Inter", text: "Inter" },
    look: {
      theme: "dark",
      title: "center",
      statement: "center",
      backdrop: "solid",
      chrome: "none",
      radius: 16,
    },
    pacing: "punchy",
    edit: "trailer",
    captionStyle: "minimal",
    // The joined music is its own file, so it plays from its start.
    music: { ...musicStyle(track, "trailer"), firstBeat: 0 },
    sfx: "none",
    frame: "none",
    motion,
  },
  intro: { component: "TitleCard", props: {}, seconds: 4 },
  segments: ["m1", "m2", "m3"].map(scene),
  outro: { component: "Outro", props: {}, seconds: 4 },
});

const sceneDir = join(root, "scenes");
await mkdir(sceneDir, { recursive: true });
for (const [id, text] of Object.entries(SCENES))
  await writeFile(join(sceneDir, `${id}.html`), text);

const timeline = Timeline.parse(
  JSON.parse(await readFile(join(root, jobPaths.timeline("desktop")), "utf8")),
);
const input: VideoInput = {
  edl,
  aspect: "16x9",
  lang: "en",
  footage: { src: jobPaths.recording("desktop"), timeline },
  narration: [],
  captions: [],
  brand: { name: "Linear", site: "linear.app" },
  copy: { title: "Build with momentum", cta: "linear.app" },
  height,
  audio: { sfx: {}, music: "render/audio/music.mp3" },
};
const dir = join(root, "build");
await compileComposition({ input, root, out: dir, scenes: sceneDir });
for (const name of ["board.png", "logo.png"])
  await copyFile(join(assets, name), join(dir, "assets", name));

// Sound, by hand, each on the moment the picture does something. Levels as `sfxCues` sets them.
const CUES: [SfxKind, number, number?][] = [
  ...[0, 1, 2, 3].map((t) => ["pop", t, 0.8] as [SfxKind, number, number]),
  ["whoosh", 3.55],
  ["pop", 4],
  ["whoosh", 5.05],
  ...[6.5, 7, 7.5].map((t) => ["click", t, 0.8] as [SfxKind, number, number]),
  ["hit", 8, 0.5],
  ["pop", 8.25, 0.6],
  ["pop", 8.5, 0.6],
  ["whoosh", 9.05, 0.7],
  ...[9, 9.25, 9.5, 9.75].map(
    (t) => ["pop", t, 0.8] as [SfxKind, number, number],
  ),
  ["pop", 10.55],
  ...[12, 12.5, 13].map((t) => ["tick", t, 1] as [SfxKind, number, number]),
  ["whoosh", 13.55],
  ["riser", 16],
  ["hit", 16],
];
const OVER_BED: Record<SfxKind, number> = {
  whoosh: 1,
  click: 3,
  pop: 3,
  riser: 3,
  hit: 6,
  tick: -4,
};
const made = await ensureSfx(join(home, "sfx"));
await mkdir(join(dir, "assets", "sfx"), { recursive: true });
const played = new Map<SfxKind, number>();
const tags: string[] = [];
for (const [i, [kind, at, factor = 1]] of CUES.entries()) {
  const takes = made[kind];
  const n = played.get(kind) ?? 0;
  played.set(kind, n + 1);
  const file = takes[n % takes.length]!;
  const shape = await soundShape(file);
  const name = `${kind}-${(n % takes.length) + 1}.wav`;
  await copyFile(file, join(dir, "assets", "sfx", name));
  const start = Math.max(0, at + 1 / 30 - shape.peak);
  const gain =
    Math.min(
      1,
      10 ** ((BED_LUFS.trailer + OVER_BED[kind] - shape.levelDb) / 20),
    ) * factor;
  tags.push(
    `<audio id="sfx-${i + 1}" src="assets/sfx/${name}" data-start="${start.toFixed(3)}" data-duration="${shape.seconds.toFixed(3)}" data-volume="${gain.toFixed(3)}" data-track-index="${200 + i}"></audio>`,
  );
}
const index = join(dir, "index.html");
const html = await readFile(index, "utf8");
await writeFile(
  index,
  html.replace(
    '<audio id="music"',
    `${tags.join("\n  ")}\n  <audio id="music"`,
  ),
);

const out = join(root, "checkpoint.mp4");
const started = Date.now();
await renderComposition({ dir, out, draft: height <= 540 });
console.log(
  `${out}: ${((Date.now() - started) / 1000).toFixed(0)} s to render`,
);
console.log(JSON.stringify(await measureVideo(out), null, 2));
