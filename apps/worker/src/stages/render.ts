import { jobPaths, variantMatrix } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { copyFixture, pretend } from "./stub.ts";

// render: every variant at 1080p (PRD §9.8). Owner: Neeraj. Stub for now: the raw recording per variant.
export const render: StageFn = async (ctx) => {
  const variants = variantMatrix(ctx.config.variants);
  for (const [i, variant] of variants.entries()) {
    await pretend(ctx, 1 / variants.length);
    await copyFixture(ctx, jobPaths.recording("desktop"), jobPaths.output(variant.id, "mp4"));
    ctx.progress((i + 1) / variants.length, variant.id);
  }
};
