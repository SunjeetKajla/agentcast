import { jobPaths } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { stub } from "./stub.ts";

// understand: TinyFish Fetch → product brief, brand kit, creative brief (PRD §9.1, §9.4). Owner: Sunjeet. Stub for now.
export const understand: StageFn = async (ctx) => {
  await stub(ctx, [jobPaths.productBrief, jobPaths.creativeBrief, jobPaths.brand]);
};
