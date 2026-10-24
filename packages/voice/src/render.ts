import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  Script,
  Storyboard,
  Voiceover,
  jobPaths,
  type VoiceClip,
} from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { ElevenLabs, VoiceError } from "./client";
import { pickVoice } from "./voices";
import {
  alignmentToWords,
  checkAlignment,
  spokenForm,
  withText,
} from "./words";

const exec = promisify(execFile);
export const PRIMARY_MODEL = "eleven_v4";
export const FALLBACK_MODEL = "eleven_multilingual_v2";
export type NarrationOptions = {
  dir: string;
  storyboard: Storyboard;
  scripts: Record<string, Script>;
  signal?: AbortSignal;
  client?: ElevenLabs;
  model?: string;
  voices?: Record<string, string | undefined>;
  concurrency?: number;
  duration?: (file: string, signal?: AbortSignal) => Promise<number>;
  log?: (message: string) => void;
  progress?: (value: number, message: string) => void;
  artifact?: (relative: string) => void;
};

export async function audioSeconds(
  file: string,
  signal?: AbortSignal,
): Promise<number> {
  const { stdout } = await exec(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { signal, timeout: 15_000 },
  );
  const seconds = Number(stdout.trim());
  if (!(seconds > 0) || !Number.isFinite(seconds))
    throw new Error("The narration clip is not valid audio.");
  return Math.round(seconds * 1000) / 1000;
}

export const voiceCacheKey = (
  voice: string,
  model: string,
  lang: string,
  text: string,
  previous = "",
  next = "",
) =>
  createHash("sha256")
    .update(
      JSON.stringify([voice, model, lang, spokenForm(text), previous, next]),
    )
    .digest("hex");

// Global across jobs: ElevenLabs' free-account concurrency is two, not two per language/job.
let active = 0;
const waiting: Array<() => void> = [];
async function voiceSlot<T>(
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  if (active >= 2)
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = waiting.indexOf(ready);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason);
      };
      waiting.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
  else active++;
  try {
    signal?.throwIfAborted();
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

/** Timestamped clips, incrementally durable manifests, exact cache keys and preflight quota checks. */
export async function renderNarration(
  options: NarrationOptions,
): Promise<{ characters: number; reused: number; voices: Voiceover[] }> {
  const { dir, signal } = options;
  const board = Storyboard.parse(options.storyboard);
  const order = new Map(board.beats.map((beat, index) => [beat.id, index]));
  const client = options.client ?? new ElevenLabs();
  const model = options.model ?? process.env.ELEVENLABS_MODEL ?? PRIMARY_MODEL;
  const subscription = await client.subscription(signal);
  const duration = options.duration ?? audioSeconds;
  type Todo = {
    lang: string;
    beatId: string;
    text: string;
    previous: string;
    next: string;
    maxSeconds: number;
  };
  const todo: Todo[] = [];
  const manifests = new Map<string, Voiceover>();
  let reused = 0;
  for (const [lang, source] of Object.entries(options.scripts)) {
    signal?.throwIfAborted();
    const script = Script.parse(source);
    if (script.lang !== lang)
      throw new Error(
        "Narration script language does not match its artifact path.",
      );
    if (
      script.segments.length !== board.beats.length ||
      new Set(script.segments.map((line) => line.beatId)).size !==
        board.beats.length ||
      script.segments.some(
        (line) => !order.has(line.beatId) || !line.text.trim(),
      )
    )
      throw new Error(
        "The approved script must contain exactly one nonempty line per storyboard beat.",
      );
    const picked = await pickVoice(
      client,
      lang,
      options.voices?.[lang] ??
        process.env[`ELEVENLABS_VOICE_${lang.split("-")[0]!.toUpperCase()}`],
      subscription.tier,
      signal,
    );
    if (picked.fellBack)
      options.log?.(
        `${lang.toUpperCase()}: ${picked.fellBack}; using ${picked.name}.`,
      );
    let old: Voiceover | undefined;
    try {
      old = await readArtifact(join(dir, jobPaths.voice(lang)), Voiceover);
    } catch (error) {
      if ((error as { cause?: NodeJS.ErrnoException }).cause?.code !== "ENOENT")
        throw error;
    }
    const manifest: Voiceover = {
      schemaVersion: 1,
      lang,
      voiceId: picked.id,
      voiceName: picked.name,
      clips: [],
    };
    manifests.set(lang, manifest);
    const lines = [...script.segments].sort(
      (a, b) => order.get(a.beatId)! - order.get(b.beatId)!,
    );
    for (const [index, line] of lines.entries()) {
      if (
        !/^[a-z0-9_-][a-z0-9_.-]{0,100}$/i.test(line.beatId) ||
        line.beatId.includes("..")
      )
        throw new Error("Unsafe narration beat ID.");
      const previous = spokenForm(lines[index - 1]?.text ?? "");
      const next = spokenForm(lines[index + 1]?.text ?? "");
      const keys = [model, FALLBACK_MODEL].map((candidate) =>
        voiceCacheKey(picked.id, candidate, lang, line.text, previous, next),
      );
      const clip =
        old?.voiceId === picked.id
          ? old.clips.find(
              (value) =>
                keys.includes(value.key) &&
                value.beatId === line.beatId &&
                value.text === line.text,
            )
          : undefined;
      if (
        clip &&
        clip.file === jobPaths.voiceClip(lang, line.beatId) &&
        (await stat(join(dir, clip.file))
          .then((info) => info.isFile() && info.size > 0)
          .catch(() => false)) &&
        checkAlignment(clip.text, clip.words, clip.seconds).ok
      ) {
        manifest.clips.push(clip);
        reused++;
      } else
        todo.push({
          lang,
          beatId: line.beatId,
          text: line.text,
          previous,
          next,
          maxSeconds: line.maxSeconds,
        });
    }
  }
  const characters = todo.reduce(
    (total, line) => total + [...spokenForm(line.text)].length,
    0,
  );
  if (characters > subscription.limit - subscription.used)
    throw new VoiceError(
      `The voice needs ${characters} characters, but the ${subscription.tier} plan has ${Math.max(0, subscription.limit - subscription.used)} left.`,
      402,
      "quota_exceeded",
    );
  options.log?.(
    `Voicing ${todo.length} lines (${characters} characters); reusing ${reused} unchanged clips.`,
  );
  // One write queue per language prevents one parallel completion overwriting another.
  const writes = new Map<string, Promise<unknown>>();
  const persist = (lang: string) => {
    const task = (writes.get(lang) ?? Promise.resolve()).then(async () => {
      const manifest = manifests.get(lang)!;
      manifest.clips.sort(
        (a, b) => order.get(a.beatId)! - order.get(b.beatId)!,
      );
      await writeArtifact(join(dir, jobPaths.voice(lang)), Voiceover, manifest);
      options.artifact?.(jobPaths.voice(lang));
    });
    writes.set(lang, task);
    return task;
  };
  let nextIndex = 0;
  let completed = 0;
  const workers = Math.max(
    1,
    Math.min(
      2,
      Math.floor(
        (options.concurrency ?? Number(process.env.ELEVENLABS_CONCURRENCY)) ||
          2,
      ),
    ),
  );
  const abort = new AbortController();
  const workSignal = AbortSignal.any([
    abort.signal,
    ...(signal ? [signal] : []),
  ]);
  const work = async () => {
    while (nextIndex < todo.length) {
      workSignal.throwIfAborted();
      const line = todo[nextIndex++]!;
      const manifest = manifests.get(line.lang)!;
      const relative = jobPaths.voiceClip(line.lang, line.beatId);
      const file = resolve(dir, relative);
      if (!file.startsWith(resolve(dir) + sep))
        throw new Error("Unsafe narration path.");
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        let accepted: VoiceClip | undefined;
        for (const candidate of [...new Set([model, FALLBACK_MODEL])]) {
          let speech;
          try {
            speech = await voiceSlot(workSignal, () =>
              client.speak(
                {
                  voiceId: manifest.voiceId,
                  text: spokenForm(line.text),
                  modelId: candidate,
                  ...(candidate === FALLBACK_MODEL
                    ? {}
                    : { languageCode: line.lang.split("-")[0] }),
                  previousText: line.previous,
                  nextText: line.next,
                },
                workSignal,
              ),
            );
          } catch (error) {
            if (
              workSignal.aborted ||
              !(error instanceof VoiceError) ||
              [401, 402, 403, 429].includes(error.status) ||
              (error.status >= 500 && error.code !== "no_alignment") ||
              candidate === FALLBACK_MODEL
            )
              throw error;
            continue;
          }
          await writeFile(temp, speech.audio);
          const seconds = await duration(temp, workSignal);
          const words = alignmentToWords(withText(speech.alignment, line.text));
          const checked = checkAlignment(line.text, words, seconds);
          if (!checked.ok) {
            if (candidate === FALLBACK_MODEL)
              throw new VoiceError(
                `Caption timings failed validation: ${checked.problems.join("; ")}`,
                502,
                "invalid_alignment",
              );
            options.log?.(
              `${line.lang} ${line.beatId}: retrying invalid caption timings on the fallback model.`,
            );
            continue;
          }
          accepted = {
            beatId: line.beatId,
            file: relative,
            text: line.text,
            seconds,
            words,
            model: candidate,
            key: voiceCacheKey(
              manifest.voiceId,
              candidate,
              line.lang,
              line.text,
              line.previous,
              line.next,
            ),
          };
          break;
        }
        if (!accepted)
          throw new VoiceError(
            "No supported voice model produced a timed clip.",
            422,
            "unsupported_model",
          );
        await rename(temp, file);
        manifest.clips.push(accepted);
        await persist(line.lang);
        options.artifact?.(relative);
        options.progress?.(
          ++completed / Math.max(1, todo.length),
          `${line.lang.toUpperCase()} ${line.beatId}`,
        );
      } finally {
        await rm(temp, { force: true });
      }
    }
  };
  const tasks = Array.from({ length: Math.min(workers, todo.length) }, () =>
    work().catch((error) => {
      abort.abort(error);
      throw error;
    }),
  );
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  for (const lang of manifests.keys()) await persist(lang);
  return { characters, reused, voices: [...manifests.values()] };
}
