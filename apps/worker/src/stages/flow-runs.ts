import { FlowsFile, jobPaths } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { copyFixture, pretend } from "./stub.ts";

// flow-runs: focused agent runs, local rehearsal, judge and selection (PRD §9.2, §9.2.1). Owner: Sunjeet. Stub for now.
export const flowRuns: StageFn = async (ctx) => {
  await copyFixture(ctx, jobPaths.flows, jobPaths.flows);
  const { flows } = await ctx.read(jobPaths.flows, FlowsFile);
  for (const [i, flow] of flows.entries()) {
    const agent = { type: "agent", stage: ctx.stage, agentId: flow.id, title: flow.title } as const;
    ctx.emit({ ...agent, status: "started" });
    await pretend(ctx, 0.5);
    ctx.emit({ ...agent, status: "step", step: `Clicked '${flow.steps[0]?.target?.text ?? "start"}'` });
    ctx.emit({ ...agent, status: "done" });
    ctx.progress((i + 1) / flows.length);
  }
};
