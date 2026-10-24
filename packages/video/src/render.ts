import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { Edl } from "@agentcast/shared";
import { moveSeconds } from "./motion.ts";
import { clockOf } from "./retime.ts";
import { planParts, type Narration, type VideoInput } from "./plan.ts";

// renderVideo(): one variant of the edit to an H.264 MP4 through Remotion (PRD §9.8).

let bundled: Promise<string> | undefined;

/** Webpack-bundles the composition once per process; every render after the first reuses it. */
function bundleOnce(): Promise<string> {
  bundled ??= bundle({ entryPoint: fileURLToPath(new URL("./remotion/index.ts", import.meta.url)) }).catch(
    (error: unknown) => {
      bundled = undefined;
      throw error;
    },
  );
  return bundled;
}

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

/**
 * Serves the job folder read-only on 127.0.0.1, with byte ranges, to the renderer's browser: Remotion
 * loads footage and voice over HTTP. Only the files the input names are served.
 */
async function serveFiles(root: string, allowed: Set<string>) {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname).replace(/^\/+/, "");
    const file = resolve(root, rel);
    const info =
      allowed.has(rel) && file.startsWith(resolve(root) + sep) ? await stat(file).catch(() => undefined) : undefined;
    if (!info?.isFile()) return void res.writeHead(404).end();
    const headers = {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${info.size}`,
        "content-length": end - start + 1,
      });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "content-length": info.size });
      createReadStream(file).pipe(res);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** The job-relative files an input refers to. */
const filesOf = (input: VideoInput) => [
  input.footage.src,
  ...(input.brand.hero ? [input.brand.hero] : []),
  ...Object.values(input.audio?.sfx ?? {}),
  ...input.narration.map((n) => n.src),
  ...(input.brand.logo ? [input.brand.logo.src] : []),
];

/** The input with its files as URLs on the local server. */
function served(input: VideoInput, base: string): VideoInput {
  const url = (rel: string) => `${base}/${rel.split("/").map(encodeURIComponent).join("/")}`;
  return {
    ...input,
    footage: { ...input.footage, src: url(input.footage.src) },
    narration: input.narration.map((n) => ({ ...n, src: url(n.src) })),
    brand: {
      ...input.brand,
      ...(input.brand.logo ? { logo: { ...input.brand.logo, src: url(input.brand.logo.src) } } : {}),
      ...(input.brand.hero ? { hero: url(input.brand.hero) } : {}),
    },
    ...(input.audio
      ? { audio: { sfx: Object.fromEntries(Object.entries(input.audio.sfx).map(([kind, rel]) => [kind, url(rel)])) } }
      : {}),
  };
}

export type RenderOptions = {
  input: VideoInput;
  /** The job folder the input's paths are relative to. */
  root: string;
  /** Absolute output path (.mp4). */
  out: string;
  /** Bound render tabs on worker machines; callers can lower this for previews/tests. */
  concurrency?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/** Renders one variant. Returns the frame count and how long rendering took. */
export async function renderVideo(o: RenderOptions): Promise<{ frames: number; seconds: number }> {
  o.signal?.throwIfAborted();
  const serveUrl = await bundleOnce();
  const files = await serveFiles(o.root, new Set(filesOf(o.input)));
  const cancel = makeCancelSignal();
  const onAbort = () => cancel.cancel();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const inputProps = served(o.input, files.url) as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps });
    const started = performance.now();
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      crf: 20,
      concurrency: o.concurrency ?? 4,
      outputLocation: o.out,
      cancelSignal: cancel.cancelSignal,
      onProgress: ({ progress }) => o.onProgress?.(progress),
    });
    return { frames: composition.durationInFrames, seconds: (performance.now() - started) / 1000 };
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
    await files.close();
  }
}

/**
 * Frames worth looking at to judge an edit: each card and scene halfway through, each shot's opening,
 * each camera move once it has landed, each callout once it's up. Named for what they show.
 */
export function stillMoments(edl: Edl, narration: Narration[] = []): { frame: number; label: string }[] {
  const { parts } = planParts(edl, narration);
  const fps = edl.fps;
  const move = moveSeconds(edl.style.motion);
  const out: { frame: number; label: string }[] = [];
  for (const part of parts) {
    const segment = part.kind === "segment" ? edl.segments[part.index]! : undefined;
    if (segment?.kind !== "shot") {
      out.push({
        frame: part.from + Math.floor(part.frames * 0.6),
        label: segment ? `${segment.id}-${segment.kind}` : part.kind,
      });
      continue;
    }
    const clock = clockOf(segment);
    const at = (t: number) => part.from + Math.min(part.frames - 1, Math.max(0, Math.round(clock.toOutput(t) * fps)));
    out.push({ frame: at(segment.in + 0.6), label: `${segment.id}-open` });
    for (const key of segment.camera)
      out.push({ frame: at(key.t + move + 0.1), label: `${segment.id}-camera-${key.t}s` });
    for (const c of segment.callouts ?? []) out.push({ frame: at(c.t + 0.6), label: `${segment.id}-callout-${c.t}s` });
  }
  const seen = new Set<number>();
  return out.filter((m) => !seen.has(m.frame) && seen.add(m.frame));
}

/** Renders frames of the edit as JPEGs into `outDir`; returns their absolute paths, in playing order. */
export async function renderStills(o: {
  input: VideoInput;
  root: string;
  outDir: string;
  moments: { frame: number; label: string }[];
  signal?: AbortSignal;
}): Promise<string[]> {
  const serveUrl = await bundleOnce();
  const files = await serveFiles(o.root, new Set(filesOf(o.input)));
  try {
    const inputProps = served(o.input, files.url) as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps });
    const written: string[] = [];
    for (const [i, m] of o.moments.entries()) {
      o.signal?.throwIfAborted();
      const file = join(o.outDir, `${String(i + 1).padStart(2, "0")}-${m.label.replace(/[^a-z0-9.-]+/gi, "-")}.jpg`);
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        frame: Math.min(m.frame, composition.durationInFrames - 1),
        output: file,
        imageFormat: "jpeg",
        jpegQuality: 80,
      });
      written.push(file);
    }
    return written;
  } finally {
    await files.close();
  }
}
