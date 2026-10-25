import { access, copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  Brand,
  Edl,
  ProductBrief,
  Script,
  Storyboard,
  Timeline,
  Voiceover,
  jobPaths,
  type Aspect,
} from "@agentcast/shared";
import { fixtureStages } from "@agentcast/explore";
import {
  assignNarration,
  ensureSfx,
  measureVideo,
  planParts,
  renderVideo,
  scriptCaptions,
  voiceCaptions,
  type SfxKind,
  type VideoInput,
} from "@agentcast/video";
import { agentcastHome } from "../env.ts";
import type { StageContext } from "../context.ts";
import type { StageFn } from "./types.ts";
import { copyFixture, pretend } from "./stub.ts";

// preview: the edit at 540p, 16:9, in the first language, for gate 3 (PRD §9.8). Owner: Neeraj.

/** An artifact that may not exist (no voice, no brand kit): undefined instead of an error. */
export async function optional<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    if ((error as { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/** Everything one render of the edit needs, from the job's artifacts. */
export async function videoInput(
  ctx: StageContext,
  aspect: Aspect,
  lang: string,
  height: number,
  /** The edit to render (default: render/edl.json). */
  edit?: Edl,
): Promise<VideoInput> {
  const [edl, timeline, storyboard, script, product, voice, brand] =
    await Promise.all([
      edit ?? ctx.read(jobPaths.edl, Edl),
      ctx.read(jobPaths.timeline("desktop"), Timeline),
      ctx.read(jobPaths.storyboard, Storyboard),
      ctx.read(jobPaths.script(lang), Script),
      ctx.read(jobPaths.productBrief, ProductBrief),
      ctx.config.voiceover
        ? optional(ctx.read(jobPaths.voice(lang), Voiceover))
        : undefined,
      optional(ctx.read(jobPaths.brand, Brand)),
    ]);
  // With a voice, its lines set each part's length and captions follow its words; without, the
  // script's lines spread over their parts.
  const narration = voice ? assignNarration(storyboard, voice, edl) : [];
  const plan = planParts(edl, narration);
  const logo = brand?.logo;
  // The music bed the direct stage picked and copied in (PRD §9.7.2).
  const music =
    edl.style.music.trackId &&
    (await access(ctx.path("render/audio/music.mp3")).then(
      () => true,
      () => false,
    ))
      ? "render/audio/music.mp3"
      : undefined;
  const sfx =
    edl.style.sfx === "auto" ||
    edl.segments.some((s) => s.kind === "shot" && s.sfx?.length);
  return {
    edl,
    aspect,
    lang,
    footage: { src: jobPaths.recording("desktop"), timeline },
    narration,
    captions: voice
      ? voiceCaptions(plan.clips)
      : scriptCaptions(plan.parts, edl, storyboard, script),
    brand: {
      name: product.name,
      tagline: product.oneLiner,
      site: new URL(ctx.config.url).host.replace(/^www\./, ""),
      ...(brand?.hero ? { hero: brand.hero.file } : {}),
      ...(logo
        ? {
            logo: {
              src: logo.file,
              width: logo.width,
              height: logo.height,
              plate: logo.plate,
            },
          }
        : {}),
    },
    copy: { title: script.titleCard, cta: script.cta },
    height,
    ...(sfx || music
      ? { audio: { sfx: sfx ? await soundEffects(ctx) : {}, ...(music ? { music } : {}) } }
      : {}),
  };
}

/**
 * The sound effects, made once per machine in $AGENTCAST_HOME/sfx and copied into the job's
 * render/audio/sfx/ so renders read them like any other job file.
 */
async function soundEffects(
  ctx: StageContext,
): Promise<Partial<Record<SfxKind, string>>> {
  const made = await ensureSfx(join(agentcastHome(), "sfx"), ctx.signal);
  await mkdir(ctx.path("render/audio/sfx"), { recursive: true });
  const files: Partial<Record<SfxKind, string>> = {};
  for (const [kind, file] of Object.entries(made) as [SfxKind, string][]) {
    const rel = `render/audio/sfx/${kind}.wav`;
    await copyFile(file, ctx.path(rel));
    files[kind] = rel;
  }
  return files;
}

/**
 * Renders one variant to a job-relative path. It renders to a hidden file first (never served) and
 * moves it into place when done, so a cancelled render never leaves half a video behind.
 */
export async function renderTo(
  ctx: StageContext,
  rel: string,
  input: VideoInput,
  onProgress: (fraction: number) => void,
) {
  const out = ctx.path(rel);
  const staged = `${dirname(out)}/.rendering-${rel.split("/").pop()}`;
  await mkdir(dirname(out), { recursive: true });
  const result = await renderVideo({
    input,
    root: ctx.dir,
    out: staged,
    signal: ctx.signal,
    onProgress,
    // The director's scene files (PRD §9.7.5); the catalogue draws every other part.
    scenes: ctx.path("render/composition/compositions"),
  });
  await rename(staged, out);
  ctx.artifact(rel);
  return result;
}

export const preview: StageFn = async (ctx) => {
  if (fixtureStages()) {
    await pretend(ctx);
    await copyFixture(ctx, jobPaths.recording("desktop"), jobPaths.preview);
    return;
  }
  const lang = ctx.config.variants.langs[0] ?? "en";
  ctx.progress(0.02, "Preparing the preview");
  const input = await videoInput(ctx, "16x9", lang, 540);
  const result = await renderTo(ctx, jobPaths.preview, input, (p) =>
    ctx.progress(0.05 + p * 0.95, "Rendering 540p"),
  );
  ctx.log(
    `Preview: ${result.frames} frames in ${result.seconds.toFixed(1)} s.`,
  );
  // The reference-look numbers (PRD FR-88), so an edit that stands still or plays quiet shows here.
  const m = await measureVideo(ctx.path(jobPaths.preview), ctx.signal).catch(() => undefined);
  if (m) {
    const line = `still ${(m.stillShareExEnd * 100).toFixed(0)}% (target ≤ 10%, end card excluded), ${m.lufs ?? "no"} LUFS`;
    ctx.log(`Reference check: ${line}.`, m.stillShareExEnd > 0.1 || (m.lufs !== undefined && Math.abs(m.lufs + 14) > 1.5) ? "warn" : "info");
  }
};
