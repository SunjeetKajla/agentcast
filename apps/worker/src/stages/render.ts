import { jobPaths, variantMatrix } from "@agentcast/shared";
import { fixtureStages } from "@agentcast/explore";
import type { StageFn } from "./types.ts";
import { renderTo, videoInput } from "./preview.ts";
import { copyFixture, pretend } from "./stub.ts";

// render: every variant at 1080p (PRD §9.8). Owner: Neeraj. One at a time: Remotion already uses
// every core for each. Desktop footage only until mobile recording exists.
export const render: StageFn = async (ctx) => {
  const all = variantMatrix(ctx.config.variants);
  if (fixtureStages()) {
    for (const [i, variant] of all.entries()) {
      await pretend(ctx, 1 / all.length);
      await copyFixture(
        ctx,
        jobPaths.recording("desktop"),
        jobPaths.output(variant.id, "mp4"),
      );
      ctx.progress((i + 1) / all.length, variant.id);
    }
    return;
  }
  const variants = all.filter((v) => v.source === "desktop");
  if (variants.length < all.length)
    ctx.log(
      "Mobile footage isn't recorded yet; its variants are skipped.",
      "warn",
    );
  for (const [i, variant] of variants.entries()) {
    const input = await videoInput(ctx, variant.aspect, variant.lang, 1080);
    const result = await renderTo(
      ctx,
      jobPaths.output(variant.id, "mp4"),
      input,
      (p) => ctx.progress((i + p) / variants.length, variant.id),
    );
    ctx.log(
      `${variant.id}: ${result.frames} frames in ${result.seconds.toFixed(1)} s.`,
    );
  }
};
