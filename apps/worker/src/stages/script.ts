import { jobPaths } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { fixtureLangs, stub } from "./stub.ts";

// script: storyboard + one script per language (PRD §9.4). Owner: Sunjeet. Stub for now.
export const script: StageFn = async (ctx) => {
  await stub(ctx, [jobPaths.storyboard, ...fixtureLangs(ctx, ctx.config).map(jobPaths.script)]);
};
