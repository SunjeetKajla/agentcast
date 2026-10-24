import { access } from "node:fs/promises";
import { z } from "zod";
import {
  Brand,
  CreativeBrief,
  Edl,
  ProductBrief,
  Script,
  Storyboard,
  Timeline,
  Voiceover,
  jobPaths,
} from "@agentcast/shared";
import { fixtureStages } from "@agentcast/explore";
import {
  prepareWorkspace,
  runDirector,
  type DirectorOptions,
} from "@agentcast/director";
import { baselineEdl, renderStills, stillMoments } from "@agentcast/video";
import type { StageContext } from "../context.ts";
import type { StageFn } from "./types.ts";
import { optional, videoInput } from "./preview.ts";
import { pretend, stub } from "./stub.ts";

// direct: the edit (PRD §9.7). Owner: Kaustav. The baseline edit from the storyboard, the recording's
// timeline and the brief's motion personality, then the Claude Code director improves it in render/
// (DIRECTOR.md, the job's data, edl.json), checked by the worker. A revision from gate 3 resumes the
// director's session. AGENTCAST_DIRECTOR=off keeps the baseline.

/** The director's session and the revisions it has made, kept between runs of this stage. */
const DirectorState = z.object({
  sessionId: z.string().optional(),
  applied: z.array(z.string()).default([]),
});
const STATE = "render/director.json";

export function makeDirect(
  deps: {
    runDirector?: typeof runDirector;
    renderStills?: DirectorOptions["renderStills"];
  } = {},
): StageFn {
  const direct = deps.runDirector ?? runDirector;
  return async (ctx) => {
    const decision = await ctx.decision("gate-preview");
    const revise = decision?.action === "revise" ? decision.revise : undefined;
    if (fixtureStages()) {
      if (revise) ctx.log(`Revising: ${revise}`);
      ctx.emit({
        type: "llm",
        stage: ctx.stage,
        kind: "tool_use",
        text: "Read DIRECTOR.md",
      });
      await pretend(ctx, 0.5);
      ctx.emit({
        type: "llm",
        stage: ctx.stage,
        kind: "tool_use",
        text: "Edit edl.json",
      });
      await stub(ctx, [jobPaths.edl]);
      ctx.emit({
        type: "llm",
        stage: ctx.stage,
        kind: "done",
        text: "Stub edit",
      });
      return;
    }
    const state = (await optional(ctx.read(STATE, DirectorState))) ?? {
      applied: [],
    };
    const workspace = ctx.path("render");
    const ready = await access(ctx.path("render/DIRECTOR.md")).then(
      () => true,
      () => false,
    );
    // A revision continues from the current edit (made already if the worker restarted since);
    // anything else starts again from the baseline.
    const revised = Boolean(revise && ready && state.applied.includes(revise));
    const revising = Boolean(revise && ready && !revised);
    if (!revising && !revised) await prepareWorkspace(await workspaceFor(ctx));

    let edl = await ctx.read(jobPaths.edl, Edl);
    let note = "baseline edit";
    if (process.env.AGENTCAST_DIRECTOR === "off") {
      if (revise)
        ctx.log(
          "The director is off (AGENTCAST_DIRECTOR=off), so revisions can't be made.",
          "warn",
        );
    } else if (revised) {
      note = "revised edit";
    } else {
      ctx.log(
        revising
          ? `Revising the edit: "${revise}"`
          : "The director is planning the edit (Claude Code, a few minutes).",
      );
      let turns = 0;
      try {
        const run = await direct({
          llm: ctx.llm,
          dir: workspace,
          ...(revising
            ? {
                revise,
                ...(state.sessionId ? { resume: state.sessionId } : {}),
              }
            : {}),
          renderStills:
            deps.renderStills ?? ((current) => stillsOf(ctx, current)),
          onEvent: (event) => {
            ctx.llmProgress(event);
            if (event.kind === "tool_use")
              ctx.progress(
                Math.min(0.9, 0.05 + ++turns * 0.03),
                event.text.slice(0, 80),
              );
          },
          signal: ctx.signal,
        });
        edl = run.edl;
        note = run.fellBack
          ? "the edit it started from: the director's didn't pass the check"
          : `the director's edit${run.repairRounds ? ` after ${run.repairRounds} repair round(s)` : ""}${run.reviewedStills ? ", stills reviewed" : ""}`;
        ctx.log(
          `Director: ${run.summary.slice(0, 800)}`,
          run.fellBack ? "warn" : "info",
        );
        for (const warning of run.warnings.slice(0, 5))
          ctx.log(`Check: ${warning}`, "warn");
        await ctx.write(STATE, DirectorState, {
          sessionId: run.sessionId ?? state.sessionId,
          applied:
            revise && revising ? [...state.applied, revise] : state.applied,
        });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        ctx.log(
          `The director didn't finish (${(error as Error).message.slice(0, 300)}); using the ${revising ? "current" : "baseline"} edit.`,
          "warn",
        );
        edl = await ctx.read(jobPaths.edl, Edl);
      }
    }
    await ctx.write(jobPaths.edl, Edl, edl);
    const count = (kind: string) =>
      edl.segments.filter((s) => s.kind === kind).length;
    ctx.log(
      `Edit: ${count("shot")} shot(s), ${count("statement")} headline(s), ${edl.style.motion.personality} motion, ${edl.style.edit} cut (${note}).`,
    );
  };
}
export const direct = makeDirect();

/** Frames of an edit for the director to look at: 540p, 16:9, the first language. */
async function stillsOf(ctx: StageContext, edl: Edl): Promise<string[]> {
  ctx.progress(0.7, "Rendering stills for the director to review");
  const lang = ctx.config.variants.langs[0] ?? "en";
  const input = await videoInput(ctx, "16x9", lang, 540);
  return renderStills({
    input: { ...input, edl },
    root: ctx.dir,
    outDir: ctx.path("render/stills"),
    moments: stillMoments(edl, input.narration).slice(0, 12),
    signal: ctx.signal,
  });
}

/** Everything the director's workspace holds, with the baseline edit to start from. */
async function workspaceFor(ctx: StageContext) {
  const langs = ctx.config.variants.langs;
  const [timeline, storyboard, creative, product, brand] = await Promise.all([
    ctx.read(jobPaths.timeline("desktop"), Timeline),
    ctx.read(jobPaths.storyboard, Storyboard),
    ctx.read(jobPaths.creativeBrief, CreativeBrief),
    optional(ctx.read(jobPaths.productBrief, ProductBrief)),
    optional(ctx.read(jobPaths.brand, Brand)),
  ]);
  const scripts = await Promise.all(
    langs.map((lang) => ctx.read(jobPaths.script(lang), Script)),
  );
  const voices = ctx.config.voiceover
    ? (
        await Promise.all(
          langs.map((lang) =>
            optional(ctx.read(jobPaths.voice(lang), Voiceover)),
          ),
        )
      ).filter((voice) => voice !== undefined)
    : [];
  if (ctx.config.voiceover && voices.length < langs.length)
    ctx.log(
      "Some languages have no voice; their shots keep the footage's length.",
      "warn",
    );
  const baseline = baselineEdl({
    timeline,
    storyboard,
    scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])),
    voices,
    personality: creative.personality,
    ...(brand ? { brand } : {}),
  });
  // The script stage saved a frame of each footage beat, by its place in the storyboard.
  const frames: Record<string, string> = {};
  for (const [i, beat] of storyboard.beats.entries()) {
    const file = ctx.path(`script/frames/beat-${i + 1}.jpg`);
    if (
      beat.flowId &&
      (await access(file).then(
        () => true,
        () => false,
      ))
    )
      frames[beat.id] = file;
  }
  return {
    dir: ctx.path("render"),
    creative,
    ...(product ? { product } : {}),
    storyboard,
    scripts,
    timeline,
    voices,
    baseline,
    ...(brand ? { brand } : {}),
    frames,
  };
}
