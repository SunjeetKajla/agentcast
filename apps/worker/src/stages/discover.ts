import type { StageFn } from "./types.ts";
import { pretend } from "./stub.ts";

// discover: the entrance scout (PRD §9.2). Owner: Sunjeet. Stub for now: fake agent events for the live views.
export const discover: StageFn = async (ctx) => {
  const agent = { type: "agent", stage: ctx.stage, agentId: "scout", title: "Find the app entrance" } as const;
  ctx.emit({ ...agent, status: "started" });
  await pretend(ctx, 0.5);
  ctx.emit({ ...agent, status: "step", step: "Opened the dashboard" });
  await pretend(ctx, 0.5);
  ctx.emit({ ...agent, status: "done" });
};
