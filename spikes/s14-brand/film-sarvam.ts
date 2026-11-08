// Checkpoint C (docs/BRAND_MOTION_PLAN.md §9): one hand-built 24 s Sarvam film, a voice product on a light
// ground with its own orbs and its own voice. Run `brand-capture-sarvam` first.
//   pnpm --filter @agentcast/spikes brand-sarvam
import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Edl, MOTION_PRESETS, Timeline, jobPaths } from "@agentcast/shared";
import { BED_LUFS, compileComposition, ensureSfx, loadMusicLibrary, measureVideo, musicDir, musicStyle, renderComposition, soundShape, type SfxKind, type VideoInput } from "@agentcast/video";
import { makeSarvamScenes, wordmarkOf } from "./scenes-sarvam.ts";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const home = process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast");
const job = join(home, "jobs", "job_mw6o12r65ef81c");
const root = join(here, "..", "output", "brand-sarvam");
const layers = join(root, "layers");
const film = join(root, "film");
const audio = join(film, "render", "audio");

await rm(film, { recursive: true, force: true });
await mkdir(audio, { recursive: true });
for (const name of ["record", "brief"]) await cp(join(job, name), join(film, name), { recursive: true });

/** The voice: 3.5 s of a Bulbul V4 sample from sarvam.ai (named "classroom-tamil", but this excerpt is English), from where its speech starts, levelled to sit over the bed. */
const VOICE = { at: 12.5, seconds: 3.5 };
const { stderr } = await exec("ffmpeg", ["-hide_banner", "-i", join(layers, "voice.mp3"), "-af", "silencedetect=n=-35dB:d=0.25", "-f", "null", "-"]);
const firstEnd = Number(/silence_end: ([\d.]+)/.exec(stderr)?.[1] ?? 0);
const from = firstEnd < 3 ? Math.max(0, firstEnd - 0.05) : 0;
const raw = join(audio, "voice-raw.wav");
await exec("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-t", String(VOICE.seconds), "-i", join(layers, "voice.mp3"), "-af", `afade=t=in:d=0.03,afade=t=out:st=${VOICE.seconds - 0.3}:d=0.3`, "-ar", "48000", "-ac", "2", raw]);
const measured = await exec("ffmpeg", ["-hide_banner", "-i", raw, "-af", "ebur128", "-f", "null", "-"]);
const lufs = Number(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold[\s\S]*?LRA/.exec(measured.stderr)?.[1] ?? /I:\s+(-?[\d.]+) LUFS/.exec(measured.stderr)?.[1] ?? -20);
await exec("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", `volume=${(-17 - lufs).toFixed(1)}dB,alimiter=limit=0.9`, join(audio, "voice.wav")]);
// Its waveform: RMS in 56 slices, scaled to the loudest.
const BARS = 56;
const pcm = await exec("ffmpeg", ["-v", "error", "-i", raw, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 1 << 24 });
const samples = new Float32Array(pcm.stdout.buffer, pcm.stdout.byteOffset, Math.floor(pcm.stdout.length / 4));
const size = Math.floor(samples.length / BARS);
const rms = Array.from({ length: BARS }, (_, i) => Math.sqrt(samples.subarray(i * size, (i + 1) * size).reduce((s, v) => s + v * v, 0) / size));
const loudest = Math.max(...rms, 1e-6);
const peaks = rms.map((v) => Math.round((0.12 + 0.88 * Math.sqrt(v / loudest)) * 1000) / 1000);
console.log(`voice: ${VOICE.seconds} s from ${from.toFixed(2)} s of the sample, ${lufs} LUFS before levelling`);

// The music: in at a strong bar for 20 s, then the track's ending; ducked under the voice.
const BAR = { entry: 24.025, ending: 180.025 };
const track = (await loadMusicLibrary())!.tracks.find((t) => t.id === "enter-the-party")!;
const duck = `volume='1-0.68*max(0,min(1,min((t-${VOICE.at - 0.2})/0.15,(${VOICE.at + VOICE.seconds + 0.1}-t)/0.4)))':eval=frame`;
await exec("ffmpeg", [
  ...["-v", "error", "-y", "-i", join(musicDir(), track.file)],
  "-filter_complex",
  `[0:a]atrim=${BAR.entry}:${BAR.entry + 20.03},asetpts=PTS-STARTPTS[a];[0:a]atrim=${BAR.ending}:${BAR.ending + 4.5},asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=0.03:c1=tri:c2=tri,${duck}[m]`,
  ...["-map", "[m]", "-ar", "48000", "-b:a", "320k", join(audio, "music.mp3")],
]);

const timeline = Timeline.parse(JSON.parse(await readFile(join(film, jobPaths.timeline("desktop")), "utf8")));
const typed = timeline.events.find((e) => e.kind === "type" && typeof e.value === "string")!.value as string;
const scenes = makeSarvamScenes({ wordmark: wordmarkOf(join(layers, "logo.svg"), join(layers, "logo.json")), typed, peaks, voiceAt: VOICE.at - 12, voiceSeconds: VOICE.seconds });

const segment = (id: string, seconds: number) => ({ kind: "scene" as const, id, seconds, transitionIn: "cut" as const });
const edl = Edl.parse({
  schemaVersion: 6,
  fps: 30,
  style: {
    palette: { bg: "#fbfaf7", fg: "#1f1f1f", accent: "#a51d58", surface: "#f4f4f4" },
    fonts: { display: "Inter", text: "Inter" },
    look: { theme: "light", title: "center", statement: "center", backdrop: "solid", chrome: "none", radius: 999 },
    pacing: "punchy",
    edit: "trailer",
    captionStyle: "minimal",
    music: { ...musicStyle(track, "trailer"), firstBeat: 0 },
    sfx: "none",
    frame: "none",
    motion: { ...MOTION_PRESETS.energetic, durations: { quick: 0, standard: 0, slow: 0 } },
  },
  intro: { component: "TitleCard", props: {}, seconds: 4 },
  segments: [segment("pill", 4), segment("playground", 4), segment("listen", 4), segment("code", 4)],
  outro: { component: "Outro", props: {}, seconds: 4 },
});
const sceneDir = join(film, "scenes");
await mkdir(sceneDir, { recursive: true });
for (const [id, text] of Object.entries(scenes)) await writeFile(join(sceneDir, `${id}.html`), text);

const input: VideoInput = {
  edl,
  aspect: "16x9",
  lang: "en",
  footage: { src: jobPaths.recording("desktop"), timeline },
  narration: [],
  captions: [],
  brand: { name: "Sarvam", site: "sarvam.ai" },
  copy: { title: "Sarvam", cta: "sarvam.ai" },
  height: 1080,
  audio: { sfx: {}, music: "render/audio/music.mp3" },
};
const dir = join(film, "build");
await compileComposition({ input, root: film, out: dir, scenes: sceneDir });
await copyFile(join(layers, "hero.png"), join(dir, "assets", "hero.png"));
await copyFile(join(audio, "voice.wav"), join(dir, "assets", "voice.wav"));
// Tamil type: the installed Noto Sans Tamil, copied in so the render doesn't depend on the machine's fonts.
await mkdir(join(dir, "assets", "fonts"), { recursive: true });
await copyFile("/usr/share/fonts/google-noto-vf/NotoSansTamil[wght].ttf", join(dir, "assets", "fonts", "NotoSansTamil.ttf"));

// Sound on each move, by hand: [kind, film second its peak lands, level factor].
const CUES: [SfxKind, number, number?][] = [
  ...[0.15, 0.4, 0.65, 0.9].map((t) => ["pop", t, 0.6] as [SfxKind, number, number]),
  ["pop", 0.5],
  ["pop", 2.0],
  ["whoosh", 3.75, 0.7],
  ["whoosh", 4.1, 0.7],
  ...[4.75, 5.0, 5.25, 5.5, 5.75].map((t) => ["tick", t, 1] as [SfxKind, number, number]),
  ["pop", 6.0, 0.7],
  ["click", 7.0],
  ["whoosh", 7.65, 0.6],
  ["whoosh", 8.15, 0.8],
  ["click", 10.5],
  ["pop", 12.5, 0.6],
  ["click", 12.5],
  ["hit", 16.0, 0.6],
  ["whoosh", 16.15],
  ["pop", 16.5, 0.7],
  ["whoosh", 17.0, 0.5],
  ["riser", 20.0],
  ...[20.5, 20.6, 20.7, 20.8, 20.9].map((t) => ["tick", t, 1] as [SfxKind, number, number]),
  ["pop", 21.5, 0.7],
  ["pop", 22.0, 0.8],
];
const OVER_BED: Record<SfxKind, number> = { whoosh: 1, click: 3, pop: 3, riser: 3, hit: 6, tick: -4 };
const made = await ensureSfx(join(home, "sfx"));
await mkdir(join(dir, "assets", "sfx"), { recursive: true });
const played = new Map<SfxKind, number>();
const tags: string[] = [`<audio id="voice" src="assets/voice.wav" data-start="${VOICE.at}" data-duration="${VOICE.seconds}" data-volume="1" data-track-index="150"></audio>`];
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

const out = join(root, "brand-sarvam-1080.mp4");
const started = Date.now();
await renderComposition({ dir, out, draft: false });
console.log(`${out}: ${((Date.now() - started) / 1000).toFixed(0)} s to render`);
console.log(JSON.stringify(await measureVideo(out), null, 2));
