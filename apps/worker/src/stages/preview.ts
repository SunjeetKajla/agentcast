import { jobPaths } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { copyFixture, pretend } from "./stub.ts";

// preview: 540p render of the first variant (PRD §9.8). Owner: Neeraj. Stub for now: the raw recording.
export const preview: StageFn = async (ctx) => {
  await pretend(ctx);
  await copyFixture(ctx, jobPaths.recording("desktop"), jobPaths.preview);
};
