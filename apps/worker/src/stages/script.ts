import { execFile } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import {
  CreativeBrief,
  ProductBrief,
  FlowsFile,
  Script,
  Storyboard,
  Timeline,
  MOTION_PRESETS,
  jobPaths,
} from "@agentcast/shared";
import {
  candidateSpans,
  plainStoryboard,
  workspaceLlm,
  writeScript,
  writeStoryboard,
} from "@agentcast/story";
import { fixtureStages } from "@agentcast/explore";
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
  const input = {
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
  for (const [index, lang] of ctx.config.variants.langs.entries()) {
    const result = await writeScript(
      llm,
      { lang, storyboard: board, creative, product },
      ctx.signal,
    );
    await ctx.write(jobPaths.script(lang), Script, result);
    ctx.progress(
      0.35 + (0.65 * (index + 1)) / ctx.config.variants.langs.length,
      `${lang.toUpperCase()} script ready`,
    );
  }
};
