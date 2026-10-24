import { z } from "zod";
import { FlowsFile, ReplayPlan, jobPaths } from "@agentcast/shared";
import {
  Candidate,
  FlowRunResult,
  FLOW_RUN_SCHEMA,
  flowGoal,
  toFlow,
  executeFlows,
  fixtureStages,
  rehearseCandidate,
  runTask,
  requestHash,
  hasSecretTarget,
  type BrowserAdapter,
} from "@agentcast/explore";
import { type TinyFish } from "@agentcast/tinyfish";
import type { StageContext } from "../context.ts";
import type { StageFn } from "./types.ts";
import { copyFixture, pretend } from "./stub.ts";
import { explorationOptions } from "./discover.ts";

export function makeFlowRuns(
  deps: { tf?: TinyFish; browser?: BrowserAdapter } = {},
): StageFn {
  return async (ctx) => {
    if (fixtureStages()) {
      await copyFixture(ctx, jobPaths.flows, jobPaths.flows);
      const { flows } = await ctx.read(jobPaths.flows, FlowsFile);
      for (const flow of flows) {
        const agent = {
          type: "agent",
          stage: ctx.stage,
          agentId: flow.id,
          title: flow.title,
        } as const;
        ctx.emit({ ...agent, status: "started" });
        await pretend(ctx);
        ctx.emit({ ...agent, status: "done" });
      }
      return;
    }
    const flows = await executeFlows(await explorationOptions(ctx, deps));
    ctx.log(
      `Selected ${flows.filter((flow) => flow.selected).length} independently rehearsed flow(s).`,
    );
  };
}
export const flowRuns = makeFlowRuns();
export const StepEdit = z
  .object({
    flowId: z.string(),
    stepId: z.string(),
    text: z.string().trim().min(1).max(200).optional(),
    value: z.string().max(500).optional(),
  })
  .refine(
    (edit) => edit.text !== undefined || edit.value !== undefined,
    "Provide replacement text or a value.",
  );
export const AddFlow = z.object({
  description: z.string().trim().min(3).max(2000),
});

/** Gate action implementation. Kaustav's gate-action router can call this without releasing the gate. */
export async function editStep(
  ctx: StageContext,
  payload: unknown,
  deps: { tf?: TinyFish; browser?: BrowserAdapter } = {},
) {
  const edit = StepEdit.parse(payload);
  const file = await ctx.read(jobPaths.flows, FlowsFile);
  const flow = file.flows.find((candidate) => candidate.id === edit.flowId);
  const step = flow?.steps.find((candidate) => candidate.id === edit.stepId);
  if (!flow || !step)
    throw new Error("The selected flow step no longer exists.");
  if (hasSecretTarget(step))
    throw new Error(
      "Secret inputs cannot be edited or saved through the flow review. Use sign-in-once.",
    );
  const updated = {
    ...flow,
    scoring: undefined,
    rehearsal: undefined,
    steps: flow.steps.map((current) =>
      current.id === step.id
        ? {
            ...current,
            ...(edit.text === undefined
              ? {}
              : { target: { ...current.target, text: edit.text } }),
            ...(edit.value === undefined ? {} : { value: edit.value }),
          }
        : current,
    ),
  };
  if (updated.steps.some(hasSecretTarget))
    throw new Error(
      "Secret inputs cannot be edited or saved through the flow review. Use sign-in-once.",
    );
  const result = await rehearseCandidate(
    await explorationOptions(ctx, deps),
    updated,
  );
  const final = {
    ...result.flow,
    selected: flow.selected && Boolean(result.flow.rehearsal?.ok),
  };
  file.flows = file.flows.map((current) =>
    current.id === flow.id ? final : current,
  );
  await ctx.write(jobPaths.flows, FlowsFile, file);
  await saveReplay(ctx, flow.id, result.replay);
  return final;
}

async function saveReplay(
  ctx: StageContext,
  flowId: string,
  updated?: ReplayPlan,
) {
  let replay: ReplayPlan;
  try {
    replay = await ctx.read(jobPaths.replayPlan, ReplayPlan);
  } catch (error) {
    if ((error as { cause?: NodeJS.ErrnoException }).cause?.code !== "ENOENT")
      throw error;
    replay = { schemaVersion: 1, byFormFactor: {} };
  }
  const desktop = { ...replay.byFormFactor.desktop };
  for (const key of Object.keys(desktop))
    if (key.startsWith(`${flowId}.`)) delete desktop[key];
  Object.assign(desktop, updated?.byFormFactor.desktop);
  replay.byFormFactor.desktop = desktop;
  await ctx.write(jobPaths.replayPlan, ReplayPlan, replay);
}

/** One focused user-requested run, with the same boundaries, durable IDs and fresh rehearsal. */
export async function addFlow(
  ctx: StageContext,
  payload: unknown,
  deps: { tf?: TinyFish; browser?: BrowserAdapter } = {},
) {
  const { description } = AddFlow.parse(payload);
  const options = await explorationOptions(ctx, deps);
  const file = await ctx.read(jobPaths.flows, FlowsFile);
  const id = `user-${requestHash(description).slice(0, 12)}`;
  if (file.flows.some((flow) => flow.id === id))
    return file.flows.find((flow) => flow.id === id)!;
  const candidate = Candidate.parse({
    title: description.slice(0, 100),
    why_it_matters: description,
    start_url: ctx.config.url,
    outline: [description],
    needs_sign_in: !options.publicMode,
  });
  const result = await runTask({
    id,
    request: {
      url: ctx.config.url,
      goal: flowGoal(candidate, new URL(ctx.config.url).hostname),
      output_schema: FLOW_RUN_SCHEMA,
      browser_profile: "stealth",
      agent_config: { max_duration_seconds: 120 },
      ...options.auth,
    },
    schema: FlowRunResult,
    io: ctx,
    tf: options.tf,
    signal: ctx.signal,
    maxMs: 300_000,
    onUpdate: (run) => options.onAgent?.(id, candidate.title, "step", run),
  });
  const normalized = toFlow(FlowRunResult.parse(result.result), {
    id,
    candidate,
    productUrl: ctx.config.url,
    runId: result.runId,
    startedAt: ctx.config.url,
  });
  if (normalized.issues.length)
    throw new Error(
      "The new flow could not be completed safely. Its task checkpoint was saved.",
    );
  const rehearsed = await rehearseCandidate(options, {
    ...normalized.flow,
    source: "user",
  });
  const flow = {
    ...rehearsed.flow,
    rank: file.flows.length + 1,
    selected: Boolean(rehearsed.flow.rehearsal?.ok),
  };
  await ctx.write(jobPaths.flows, FlowsFile, {
    ...file,
    flows: [...file.flows, flow],
  });
  await saveReplay(ctx, flow.id, rehearsed.replay);
  return flow;
}
