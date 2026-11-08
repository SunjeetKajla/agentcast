import { execFile } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import {
  ArtDirection,
  BeatSheet,
  Brand,
  BrandKit,
  LayerList,
  ProductOutputs,
  CreativeBrief,
  ProductBrief,
  FlowsFile,
  Script,
  Storyboard,
  Timeline,
  MOTION_PRESETS,
  jobPaths, musicLed } from "@agentcast/shared";
import {
  candidateSpans,
  checkDirection,
  directArt,
  plainStoryboard,
  productTypeOf,
  rulesDirection,
  scriptLinesOf,
  shotBriefsOf,
  siteTextOf,
  workspaceLlm,
  writeScript,
  writeStoryboard,
} from "@agentcast/story";
import { fixtureStages, withRecordingImagery } from "@agentcast/explore";
import { beatSheetOf, describeBeatSheet, extractLayers, inventoryOf, loadReferenceLibrary, planLedFilm, productShape, shotContent } from "@agentcast/video";
import type { StageFn } from "./types.ts";
import { fixtureLangs, stub } from "./stub.ts";
const exec = promisify(execFile);

export const script: StageFn = async (ctx) => {
  if (fixtureStages()) {
    await stub(ctx, [
      jobPaths.storyboard,
      ...fixtureLangs(ctx, ctx.config).map(jobPaths.script),
    ]);
    return;
  }
  const [product, creative, file, timeline] = await Promise.all([
    ctx.read(jobPaths.productBrief, ProductBrief),
    ctx.read(jobPaths.creativeBrief, CreativeBrief),
    ctx.read(jobPaths.flows, FlowsFile),
    ctx.read(jobPaths.timeline("desktop"), Timeline),
  ]);
  const approved = file.flows.filter(
    (flow) =>
      flow.selected &&
      timeline.flows.some((recorded) => recorded.flowId === flow.id),
  );
  const missing = file.flows.filter(
    (flow) =>
      flow.selected && !approved.some((recorded) => recorded.id === flow.id),
  );
  if (missing.length)
    ctx.log(
      `Omitting ${missing.length} approved flow(s) that did not record; narration will describe only completed footage.`,
      "warn",
    );
  const spans = candidateSpans(
    approved.map((flow) => ({ flowId: flow.id, title: flow.title, timeline })),
  );
  if (!spans.length)
    throw new Error(
      "No recorded actions match the approved flows. Record those flows before writing narration.",
    );
  const llm = workspaceLlm(ctx.llm, ctx.llmProgress);
  const tokens = MOTION_PRESETS[creative.personality];
  const card = Math.max(
    3,
    tokens.durations.slow * tokens.cameraScale + tokens.hold,
  );
  await mkdir(ctx.path("script/frames"), { recursive: true });
  const frames: Record<string, string> = {};
  // Evidence must be available before the writer chooses beats, rather than after the plan exists.
  for (const [index, span] of spans.entries()) {
    ctx.signal.throwIfAborted();
    const file = `script/frames/span-${index + 1}.jpg`;
    try {
      await exec(
        "ffmpeg",
        [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          String(span.frameAt),
          "-i",
          ctx.path(jobPaths.recording("desktop")),
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-2",
          ctx.path(file),
        ],
        { signal: ctx.signal, timeout: 20_000 },
      );
      frames[span.id] = ctx.path(file);
      ctx.artifact(file);
    } catch {
      ctx.signal.throwIfAborted();
    }
  }
  const led = musicLed(ctx.config);
  const input = {
    led,
    mode: ctx.config.mode,
    creative,
    product,
    spans,
    frames,
    cardSeconds: { intro: card, outro: card },
  };
  ctx.progress(0.1, "Planning the storyboard");
  let board: Storyboard;
  try {
    board = await writeStoryboard(llm, input, ctx.signal);
  } catch (error) {
    ctx.signal.throwIfAborted();
    ctx.log(
      "The storyboard writer could not produce a valid plan; using the recorded shots in order.",
      "warn",
    );
    board = plainStoryboard(input);
  }
  await ctx.write(jobPaths.storyboard, Storyboard, board);
  for (const [index, beat] of board.beats.entries()) {
    if (beat.out === undefined) continue;
    const file = `script/frames/beat-${index + 1}.jpg`;
    const span = spans.find(
      (span) =>
        span.flowId === beat.flowId &&
        span.in === beat.in &&
        span.out === beat.out,
    );
    if (span && frames[span.id])
      await copyFile(frames[span.id]!, ctx.path(file)).then(() =>
        ctx.artifact(file),
      );
  }
  const scripts: Script[] = [];
  for (const [index, lang] of ctx.config.variants.langs.entries()) {
    const result = await writeScript(
      llm,
      { lang, storyboard: board, creative, product, led },
      ctx.signal,
    );
    await ctx.write(jobPaths.script(lang), Script, result);
    scripts.push(result);
    ctx.progress(
      0.35 + (0.65 * (index + 1)) / ctx.config.variants.langs.length,
      `${lang.toUpperCase()} script ready`,
    );
  }
  // A music-led film's beat sheet (PRD §9.7.7), before review: the bars, the moves, and any shot that
  // can't be shown, so nobody approves a line that disappears later.
  if (led) {
    try {
      const brand = await ctx.read(jobPaths.brand, Brand).catch(() => undefined);
      const direction = await artDirection(ctx, { timeline, storyboard: board, product, creative, ...(brand ? { brand } : {}), scripts, llm });
      const film = await planLedFilm({
        direction: direction.direction,
        content: direction.content,
        root: ctx.dir,
        ...(direction.kit ? { kit: direction.kit } : {}),
        ...(direction.outputs ? { outputs: direction.outputs } : {}),
        thirdPartyLogos: ctx.config.thirdPartyLogos === true,
        recording: ctx.path(jobPaths.recording("desktop")),
        timeline,
        storyboard: board,
        scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])),
        creative,
        product,
        ...(brand ? { brand } : {}),
        seed: ctx.jobId,
        site: ctx.config.url,
        signal: ctx.signal,
      });
      const sheet = beatSheetOf(film.plan.edl, { skeletonId: film.plan.skeleton.id, thesis: creative.summary, grid: film.grid, dropped: film.plan.dropped });
      await ctx.write(jobPaths.beatSheet, BeatSheet, sheet);
      ctx.log(`Beat sheet: ${describeBeatSheet(sheet)[0]}`);
      for (const d of sheet.dropped) ctx.log(`Left out before review: "${d.title ?? d.beatId}" (${d.reason}).`, "warn");
    } catch (error) {
      ctx.signal.throwIfAborted();
      ctx.log(`Couldn't plan the beat sheet (${(error as Error).message.slice(0, 200)}); the edit is planned after review instead.`, "warn");
    }
  }
};

/** Saturation of a #rrggbb colour, 0–1. */
function saturation(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Art direction (PRD §9.7.8): the recording's pieces cut out as layers, what the job has (B), and the design
 * chosen from it and the product (A), by the director's turn or the rules table, checked either way.
 */
async function artDirection(
  ctx: Parameters<StageFn>[0],
  o: { timeline: Timeline; storyboard: Storyboard; product: ProductBrief; creative: CreativeBrief; brand?: Brand; scripts?: Script[]; llm: ReturnType<typeof workspaceLlm> },
) {
  const recording = ctx.path(jobPaths.recording("desktop"));
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", recording], { signal: ctx.signal });
  const width = Number(stdout.trim()) || o.timeline.viewport.w;
  const layers = await extractLayers({ recording, timeline: o.timeline, width, dir: ctx.path("render/layers"), rel: "render/layers", signal: ctx.signal });
  await ctx.write(jobPaths.layers, LayerList, layers);
  let kit = await ctx.read(jobPaths.brandKit, BrandKit).catch(() => undefined);
  // The brand's objects as the product shows them, from the recording, added to what the pages gave.
  const more = kit ? await withRecordingImagery({ kit, dir: ctx.dir, recording, timeline: o.timeline, signal: ctx.signal }) : undefined;
  if (more) {
    kit = more;
    await ctx.write(jobPaths.brandKit, BrandKit, kit);
    for (const i of kit.imagery) ctx.artifact(i.file);
    ctx.log(`Brand imagery: ${kit.imagery.length} object(s) (${kit.imagery.filter((i) => i.from === "recording").length} from the recording)${kit.colours.length ? `, colours ${kit.colours.join(" ")}` : ""}.`);
  }
  const outputs = await ctx.read(jobPaths.outputs, ProductOutputs).catch(() => undefined);
  const content = await shotContent(recording, o.storyboard, o.timeline, ctx.signal);
  const accent = o.brand?.palette.accent ?? "#888888";
  const inventory = inventoryOf({
    timeline: o.timeline,
    layers,
    ...(kit ? { kit } : {}),
    theme: o.brand?.theme ?? "dark",
    colourful: o.brand?.accentFrom !== "text" && saturation(accent) > 0.3,
    hero: Boolean(o.brand?.hero),
    density: width / o.timeline.viewport.w,
    content,
    outputs: outputs?.outputs.length ?? 0,
    thirdPartyLogos: ctx.config.thirdPartyLogos === true,
  });
  const library = await loadReferenceLibrary().catch(() => undefined);
  const skeletons = (library?.skeletons ?? []).map((s) => ({ id: s.id, name: s.name, feel: s.feel, suits: s.suits }));
  const shape = productShape(o.storyboard, o.timeline, content);
  const input = { inventory, skeletons, shape, seed: ctx.config.url };
  const scriptLines = scriptLinesOf(o.scripts ?? []);
  const shots = shotBriefsOf(o.storyboard, o.timeline, outputs);
  const siteText = await siteTextOf(ctx.path("brief/pages"));
  const direction =
    process.env.AGENTCAST_DIRECTOR === "off" || !skeletons.length
      ? checkDirection(rulesDirection({ productType: productTypeOf(o.product), ...input }), input)
      : await directArt(o.llm, { product: o.product, creative: o.creative, ...input, shots, siteText, scriptLines }, ctx.signal);
  await ctx.write(jobPaths.artDirection, ArtDirection, direction);
  ctx.log(
    `Art direction (${direction.by}): ${direction.productType}, ${direction.skeletonId}, logo ${direction.brand.logo}, cursor ${direction.brand.cursor}, ${direction.brand.world} ground${direction.featured.length ? `, built around ${direction.featured.join(", ")}` : ""}.`,
  );
  for (const change of direction.changed) ctx.log(`Art direction changed: ${change}.`, "warn");
  return { direction, content, kit, outputs };
}
