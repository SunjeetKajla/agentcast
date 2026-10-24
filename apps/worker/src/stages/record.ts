import { jobPaths } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { stub } from "./stub.ts";

// record: film each approved flow in local Chromium (PRD §9.3). Owner: Neeraj. Stub for now (desktop only).
export const record: StageFn = async (ctx) => {
  if (ctx.config.variants.formFactors.includes("mobile")) ctx.log("Stub: no mobile fixture; desktop only", "warn");
  await stub(ctx, [jobPaths.recording("desktop"), jobPaths.timeline("desktop"), jobPaths.replayPlan]);
};
