import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { FlowAudioFiles } from "@agentcast/shared";
import { writeArtifact } from "@agentcast/shared/node";

// The product's own output (docs/BRAND_MOTION_PLAN.md §3): audio the page receives while the flow runs (a voice
// product's speech), kept so the film can play what the product demonstrates. Preloaded samples count
// only when the recording actually plays them; merely loading a player is not evidence of playback.

/** Where one flow's outputs go, and its clock. */
export type OutputOptions = { dir: string };

const MAX = 6;
const BYTES = 15 * 1024 * 1024;

/** The audio in a JSON body: a base64 string under audio, audios[0] or audioContent (the usual API shapes). */
export function audioInJson(body: unknown): Buffer | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const value =
    typeof b.audio === "string"
      ? b.audio
      : Array.isArray(b.audios) && typeof b.audios[0] === "string"
        ? b.audios[0]
        : typeof b.audioContent === "string"
          ? b.audioContent
          : undefined;
  if (!value || value.length < 400) return undefined;
  const bytes = Buffer.from(
    value.replace(/^data:audio\/[\w.+-]+;base64,/, ""),
    "base64",
  );
  // A real audio file starts with a container's magic bytes.
  const head = bytes.subarray(0, 4).toString("latin1");
  return head === "RIFF" ||
    head === "OggS" ||
    head.startsWith("ID3") ||
    (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) ||
    head === "fLaC"
    ? bytes
    : undefined;
}

const extension = (type: string, bytes: Buffer) => {
  const head = bytes.subarray(0, 4).toString("latin1");
  if (head === "RIFF" || /wav/.test(type)) return "wav";
  if (head === "OggS" || /ogg|opus/.test(type)) return "ogg";
  if (head === "fLaC" || /flac/.test(type)) return "flac";
  if (/mp4|m4a/.test(type) || bytes.subarray(4, 8).toString() === "ftyp")
    return "m4a";
  return "mp3";
};

/**
 * Watches a flow's page for audio it fetches, from now on: each kept as `<dir>/<flowId>-NN.<ext>`, with
 * `<dir>/<flowId>.json` listing them and the second of the take each arrived at (`now()` in ms).
 */
export async function watchOutputs(
  page: Page,
  o: OutputOptions & { flowId: string; now: () => number },
) {
  await mkdir(o.dir, { recursive: true });
  const kept: { file: string; type: string; t: number }[] = [];
  const index = join(o.dir, `${o.flowId}.json`);
  await writeArtifact(index, FlowAudioFiles, []);
  let busy = Promise.resolve();
  let active = true;
  const sources = new Set<string>();
  const save = async (audio: Buffer, type: string, t: number) => {
    if (audio.length < 2000 || audio.length > BYTES || kept.length >= MAX)
      return;
    const file = `${o.flowId}-${String(kept.length + 1).padStart(2, "0")}.${extension(type, audio)}`;
    await writeFile(join(o.dir, file), audio);
    kept.push({
      file,
      type: type.split(";")[0]!,
      t: Math.round(t * 1000) / 1000,
    });
    await writeArtifact(index, FlowAudioFiles, kept);
  };
  const response = (res: import("playwright-core").Response) => {
    if (!active) return;
    const kind = res.request().resourceType();
    if (kind !== "fetch" && kind !== "xhr") return;
    const type = (res.headers()["content-type"] ?? "").toLowerCase();
    if (!/^audio\/|json/.test(type) || kept.length >= MAX) return;
    const t = o.now() / 1000;
    busy = busy.then(async () => {
      try {
        const body = await res.body();
        if (body.length > BYTES) return;
        const audio = /^audio\//.test(type)
          ? body
          : audioInJson(JSON.parse(body.toString("utf8")));
        if (audio)
          await save(
            audio,
            /^audio\//.test(type) ? type : `audio/${extension(type, audio)}`,
            t,
          );
      } catch {
        // A body that's gone, or isn't what it said: nothing to keep.
      }
    });
  };
  page.on("response", response);
  const binding = `__agentcastAudio_${randomUUID().replaceAll("-", "")}`;
  await page.exposeBinding(binding, async ({ frame }, value: unknown) => {
    if (
      !active ||
      typeof value !== "string" ||
      !/^(https?:|blob:|data:audio\/)/.test(value) ||
      sources.has(value) ||
      sources.size >= MAX
    )
      return;
    sources.add(value);
    const t = o.now() / 1000;
    busy = busy.then(async () => {
      try {
        if (/^https?:/.test(value)) {
          const res = await page.request.get(value, { timeout: 15_000 });
          try {
            const type = (res.headers()["content-type"] ?? "").toLowerCase();
            if (
              res.ok() &&
              /^audio\//.test(type) &&
              Number(res.headers()["content-length"] ?? 0) <= BYTES
            )
              await save(await res.body(), type, t);
          } finally {
            await res.dispose();
          }
        } else {
          const result = await frame.evaluate(
            async ({ url, limit }) => {
              const res = await fetch(url);
              const blob = await res.blob();
              if (!blob.type.startsWith("audio/") || blob.size > limit)
                return null;
              return await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.readAsDataURL(blob);
              });
            },
            { url: value, limit: BYTES },
          );
          if (result)
            await save(
              Buffer.from(result.split(",")[1]!, "base64"),
              result.slice(5, result.indexOf(";")),
              t,
            );
        }
      } catch {
        /* Audio may be ephemeral or unavailable; never invent a replacement. */
      }
    });
  });
  const install = (name: string) => {
    document.addEventListener(
      "play",
      (event) => {
        if (event.target instanceof HTMLMediaElement && event.target.currentSrc)
          void (
            window as unknown as Record<string, (src: string) => Promise<void>>
          )[name]!(event.target.currentSrc);
      },
      true,
    );
  };
  await page.addInitScript(install, binding);
  await Promise.all(
    page.frames().map((frame) => frame.evaluate(install, binding)),
  );
  // The recorder awaits this before closing Chrome, so the final response cannot lose its body.
  return async () => {
    active = false;
    page.off("response", response);
    await busy;
  };
}
