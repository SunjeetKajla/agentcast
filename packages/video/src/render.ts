import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { Edl } from "@agentcast/shared";
import { compileComposition } from "./hyperframes/compile.ts";
import { renderComposition, snapshotComposition } from "./hyperframes/render.ts";
import { moveSeconds } from "./motion.ts";
import { primitiveMoments } from "./primitives/cues.ts";
import { clockOf } from "./retime.ts";
import { planParts, type Narration, type VideoInput } from "./plan.ts";

// renderVideo(): one variant of the edit to an H.264 MP4 (PRD §9.8): the edit compiled to a HyperFrames
// composition per variant, then rendered.

/**
 * Where a variant's composition is compiled: `build/<aspect>-<lang>-<height>/` in the job, outside the
 * director's workspace (render/), which only holds what it edits.
 */
export const variantDir = (root: string, input: VideoInput) =>
  join(root, "build", `${input.aspect}-${input.lang}-${input.height}`);

export type RenderOptions = {
  input: VideoInput;
  /** The job folder the input's paths are relative to. */
  root: string;
  /** Absolute output path (.mp4). */
  out: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** The director's scene files (`render/composition/compositions/`), kept over the catalogue's. */
  scenes?: string;
};

/** Renders one variant. Returns the frame count and how long rendering took. */
export async function renderVideo(o: RenderOptions): Promise<{ frames: number; seconds: number }> {
  o.signal?.throwIfAborted();
  const dir = variantDir(o.root, o.input);
  const { duration } = await compileComposition({
    input: o.input,
    root: o.root,
    out: dir,
    ...(o.scenes ? { scenes: o.scenes } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
  });
  const { seconds } = await renderComposition({
    dir,
    out: o.out,
    draft: o.input.height <= 540,
    ...(o.onProgress ? { onProgress: o.onProgress } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
  });
  return { frames: Math.round(duration * o.input.edl.fps), seconds };
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
    if (segment?.kind === "primitive") {
      for (const share of primitiveMoments(segment.primitive))
        out.push({ frame: part.from + Math.floor(part.frames * share), label: `${segment.id}-${segment.primitive.type}-${Math.round(share * 100)}` });
      continue;
    }
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

/** Renders frames of the edit as PNGs into `outDir`; returns their absolute paths, in playing order. */
export async function renderStills(o: {
  input: VideoInput;
  root: string;
  outDir: string;
  moments: { frame: number; label: string }[];
  signal?: AbortSignal;
  scenes?: string;
}): Promise<string[]> {
  const dir = variantDir(o.root, o.input);
  const { duration } = await compileComposition({
    input: o.input,
    root: o.root,
    out: dir,
    ...(o.scenes ? { scenes: o.scenes } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
  });
  const fps = o.input.edl.fps;
  const times = o.moments.map((m) => Math.min(duration - 1 / fps, m.frame / fps));
  const shots = await snapshotComposition({ dir, outDir: join(o.outDir, ".snap"), times, ...(o.signal ? { signal: o.signal } : {}) });
  const written: string[] = [];
  for (const [i, m] of o.moments.entries()) {
    if (!shots[i]) break;
    const file = join(o.outDir, `${String(i + 1).padStart(2, "0")}-${m.label.replace(/[^a-z0-9.-]+/gi, "-")}.png`);
    await rename(shots[i]!, file);
    written.push(file);
  }
  return written;
}
