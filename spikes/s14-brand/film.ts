// Checkpoint B (docs/BRAND_MOTION_PLAN.md §9): one hand-built 24 s Linear film with brand motion. Run
// `brand-capture` first. 120 BPM, a bar is 2 s: 10 bars of film from a strong bar, then the track's ending.
//   pnpm --filter @agentcast/spikes brand-checkpoint [--height 1080]
import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { Edl, MOTION_PRESETS, Timeline, jobPaths } from "@agentcast/shared";
import { BED_LUFS, compileComposition, ensureSfx, loadMusicLibrary, measureVideo, musicDir, musicStyle, renderComposition, soundShape, type SfxKind, type VideoInput } from "@agentcast/video";
import { homedir } from "node:os";
import { logoParts, makeScenes } from "./scenes.ts";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { height: { type: "string", default: "1080" } } });
const height = Number(values.height);
const job = join(here, "..", "output", "e2e", "jobs", "job_e2eled0001");
const root = join(here, "..", "output", "brand-checkpoint");
const layers = join(root, "layers");
const home = process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast");

await rm(join(root, "film"), { recursive: true, force: true });
await mkdir(join(root, "film", "render", "audio"), { recursive: true });
const film = join(root, "film");
for (const name of ["record", "brief"]) await cp(join(job, name), join(film, name), { recursive: true });

// The music: in at a strong bar for 20 s, then the track's real ending for the end card, joined on bars.
const BAR = { entry: 24.025, ending: 180.025 };
const track = (await loadMusicLibrary())!.tracks.find((t) => t.id === "enter-the-party")!;
await exec("ffmpeg", [
  ...["-v", "error", "-y", "-i", join(musicDir(), track.file)],
  "-filter_complex",
  `[0:a]atrim=${BAR.entry}:${BAR.entry + 20.03},asetpts=PTS-STARTPTS[a];[0:a]atrim=${BAR.ending}:${BAR.ending + 4.5},asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=0.03:c1=tri:c2=tri[m]`,
  ...["-map", "[m]", "-ar", "48000", "-b:a", "320k", join(film, "render", "audio", "music.mp3")],
]);

const pages = JSON.parse(await readFile(join(layers, "pages.json"), "utf8")) as string[];
const scenes = makeScenes({ logo: logoParts(join(layers, "logo.svg"), join(layers, "logo.json")), pages });

const segment = (id: string, seconds: number) => ({ kind: "scene" as const, id, seconds, transitionIn: "cut" as const });
const edl = Edl.parse({
  schemaVersion: 6,
  fps: 30,
  style: {
    palette: { bg: "#08090a", fg: "#f7f8f8", accent: "#f7f8f8", surface: "#191a1b" },
    fonts: { display: "Inter", text: "Inter" },
    look: { theme: "dark", title: "center", statement: "center", backdrop: "solid", chrome: "none", radius: 16 },
    pacing: "punchy",
    edit: "trailer",
    captionStyle: "minimal",
    music: { ...musicStyle(track, "trailer"), firstBeat: 0 },
    sfx: "none",
    frame: "none",
    motion: { ...MOTION_PRESETS.energetic, durations: { quick: 0, standard: 0, slow: 0 } },
  },
  intro: { component: "TitleCard", props: {}, seconds: 4 },
  segments: [segment("wall", 4), segment("projects", 4), segment("label", 1), segment("cards", 3), segment("mockup", 4)],
  outro: { component: "Outro", props: {}, seconds: 4 },
});

const sceneDir = join(film, "scenes");
await mkdir(sceneDir, { recursive: true });
for (const [id, text] of Object.entries(scenes)) await writeFile(join(sceneDir, `${id}.html`), text);

const timeline = Timeline.parse(JSON.parse(await readFile(join(film, jobPaths.timeline("desktop")), "utf8")));
const input: VideoInput = {
  edl,
  aspect: "16x9",
  lang: "en",
  footage: { src: jobPaths.recording("desktop"), timeline },
  narration: [],
  captions: [],
  brand: { name: "Linear", site: "linear.app" },
  copy: { title: "Linear", cta: "linear.app" },
  height,
  audio: { sfx: {}, music: "render/audio/music.mp3" },
};
const dir = join(film, "build");
await compileComposition({ input, root: film, out: dir, scenes: sceneDir });
await cp(join(layers, "pages"), join(dir, "assets", "pages"), { recursive: true });
await copyFile(join(layers, "board.png"), join(dir, "assets", "board.png"));

// Sound on each move, by hand: [kind, film second its peak lands, level factor].
const CUES: [SfxKind, number, number?][] = [
  ["whoosh", 0.5, 0.8],
  ["pop", 1.0],
  ["whoosh", 1.85, 0.6],
  ...[2.1, 2.24, 2.38].map((t) => ["tick", t, 1] as [SfxKind, number, number]),
  ["whoosh", 4.1],
  ["whoosh", 6.9, 0.8],
  ["pop", 8.0, 0.7],
  ["click", 9.5],
  ["whoosh", 10.55, 0.7],
  ...[11, 11.25, 11.5, 11.75].map((t) => ["tick", t, 1] as [SfxKind, number, number]),
  ["whoosh", 11.75, 0.6],
  ["pop", 12.0],
  ...[13.1, 13.22, 13.34, 13.46].map((t) => ["pop", t, 0.6] as [SfxKind, number, number]),
  ["click", 15.0],
  ["pop", 15.05, 0.8],
  ["hit", 16.0, 0.6],
  ["whoosh", 16.1],
  ["whoosh", 19.0, 0.8],
  ["riser", 20.0],
  ["hit", 21.0, 0.7],
  ["whoosh", 21.4, 0.5],
  ["pop", 22.0, 0.8],
];
const OVER_BED: Record<SfxKind, number> = { whoosh: 1, click: 3, pop: 3, riser: 3, hit: 6, tick: -4 };
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
  const gain = Math.min(1, 10 ** ((BED_LUFS.trailer + OVER_BED[kind] - shape.levelDb) / 20)) * factor;
  tags.push(`<audio id="sfx-${i + 1}" src="assets/sfx/${name}" data-start="${start.toFixed(3)}" data-duration="${shape.seconds.toFixed(3)}" data-volume="${gain.toFixed(3)}" data-track-index="${200 + i}"></audio>`);
}
const index = join(dir, "index.html");
await writeFile(index, (await readFile(index, "utf8")).replace('<audio id="music"', `${tags.join("\n  ")}\n  <audio id="music"`));

const out = join(root, `brand-checkpoint-${height}.mp4`);
const started = Date.now();
await renderComposition({ dir, out, draft: height <= 540 });
console.log(`${out}: ${((Date.now() - started) / 1000).toFixed(0)} s to render`);
console.log(JSON.stringify(await measureVideo(out), null, 2));
