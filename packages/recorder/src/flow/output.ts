import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Response, Request } from "playwright-core";
import { OutputIndex } from "@agentcast/shared";
import { writeArtifact } from "@agentcast/shared/node";

// The product's own output (docs/BRAND_MOTION_PLAN.md §3): audio the page receives while the flow runs (a voice
// product's speech), kept so the film can play what the product made. Only what the page fetches after the flow
// starts counts, so audio a page preloads for its own players never does.

/** Where one flow's outputs go, and its clock. */
export type OutputOptions = { dir: string };

const MAX = 6;
const BYTES = 15 * 1024 * 1024;

/** The audio in a JSON body: a base64 string under audio, audios[0] or audioContent (the usual API shapes). */
export function audioInJson(body: unknown, depth = 0): Buffer | undefined {
  if (depth > 4) return undefined;
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const value = typeof b.audio === "string" ? b.audio : Array.isArray(b.audios) && typeof b.audios[0] === "string" ? b.audios[0] : typeof b.audioContent === "string" ? b.audioContent : undefined;
  if (!value || value.length < 400) {
    for (const key of ["data", "result", "output", "response"]) {
      const found = audioInJson(b[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const bytes = Buffer.from(value.replace(/^data:audio\/[\w.+-]+;base64,/, ""), "base64");
  // A real audio file starts with a container's magic bytes.
  const head = bytes.subarray(0, 4).toString("latin1");
  return head === "RIFF" || head === "OggS" || head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) || head === "fLaC" ? bytes : undefined;
}

const extension = (type: string, bytes: Buffer) => {
  const head = bytes.subarray(0, 4).toString("latin1");
  if (head === "RIFF" || /wav/.test(type)) return "wav";
  if (head === "OggS" || /ogg|opus/.test(type)) return "ogg";
  if (head === "fLaC" || /flac/.test(type)) return "flac";
  return "mp3";
};

/**
 * Watches a flow's page for audio it fetches, from now on: each kept as `<dir>/<flowId>-NN.<ext>`, with
 * `<dir>/<flowId>.json` listing them and the second of the take each arrived at (`now()` in ms).
 */
export async function watchOutputs(page: Page, o: OutputOptions & { flowId: string; now: () => number }) {
  await mkdir(o.dir, { recursive: true });
  const kept: { file: string; type: string; t: number; stepId?: string }[] = [];
  const index = join(o.dir, `${o.flowId}.json`);
  await writeArtifact(index, OutputIndex, { schemaVersion: 1, outputs: [] });
  let busy = Promise.resolve();
  let expired = false;
  const initiated = new WeakSet<Request>();
  let acting = false;
  let stepId: string | undefined;
  const origins = new WeakMap<Request, string>();
  const pending = new Set<Request>();
  let drained = () => {};
  const finish = (request: Request) => { pending.delete(request); if (!pending.size) drained(); };
  const requestListener = (request: Request) => {
    if (acting && ["fetch", "xhr", "media"].includes(request.resourceType())) { initiated.add(request); pending.add(request); if (stepId) origins.set(request, stepId); }
  };
  page.on("request", requestListener);
  page.on("requestfailed", finish);
  const listener = (res: Response) => {
    finish(res.request());
    const kind = res.request().resourceType();
    if (!["fetch", "xhr", "media"].includes(kind) || !initiated.has(res.request())) return;
    const type = (res.headers()["content-type"] ?? "").toLowerCase();
    if (!/^audio\/|json/.test(type) || kept.length >= MAX) return;
    const t = o.now() / 1000;
    busy = busy.then(async () => {
      try {
        const body = await res.body();
        if (expired || body.length > BYTES) return;
        const audio = /^audio\//.test(type) ? body : audioInJson(JSON.parse(body.toString("utf8")));
        if (!audio || audio.length < 2000 || kept.length >= MAX) return;
        const file = `${o.flowId}-${String(kept.length + 1).padStart(2, "0")}.${extension(type, audio)}`;
        await writeFile(join(o.dir, file), audio);
        kept.push({ file, type: /^audio\//.test(type) ? type.split(";")[0]! : `audio/${extension(type, audio)}`, t: Math.round(t * 1000) / 1000, ...(origins.get(res.request()) ? { stepId: origins.get(res.request()) } : {}) });
        await writeArtifact(index, OutputIndex, { schemaVersion: 1, outputs: kept });
      } catch {
        // A body that's gone, or isn't what it said: nothing to keep.
      }
    });
  };
  page.on("response", listener);
  return { beginAction(id?: string) { acting = true; stepId = id; }, endAction() { acting = false; }, async stop() {
    page.off("request", requestListener);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([(async () => {
        if (pending.size) await new Promise<void>((resolve) => { drained = resolve; });
        await busy;
      })(), new Promise<void>((resolve) => {
        timer = setTimeout(() => { expired = true; drained(); resolve(); }, 10000);
      })]);
    } finally {
      clearTimeout(timer);
      page.off("response", listener);
      page.off("requestfailed", finish);
    }
  } };
}
