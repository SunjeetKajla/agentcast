import type { z } from "zod";
import { FlowsFile, Script, jobPaths, type GateName } from "@agentcast/shared";
import type { StageContext } from "../context.ts";
import { AddFlow, StepEdit, addFlow, editStep } from "./flow-runs.ts";
import type { GateFn } from "./types.ts";

// What each gate decision changes before the gate releases. Owner: Kaustav.
// A preview "revise" is handled by the orchestrator: it sends direct and preview back.

/** Selection, order and titles from gate 1 → explore/flows.json. */
const flows: GateFn<"gate-flows"> = async (ctx, decision) => {
  const file = await ctx.read(jobPaths.flows, FlowsFile);
  const selections=decision.flows??file.flows;
  const failed=selections.filter(item=>item.selected && file.flows.some(flow=>flow.id===item.id && flow.rehearsal?.ok===false));
  if(failed.length) throw new Error(`Cannot approve flows whose rehearsal failed: ${failed.map(flow=>flow.id).join(", ")}. Rehearse them successfully or deselect them.`);
  if(!selections.some(flow=>flow.selected)) throw new Error("Select at least one successfully rehearsed flow.");
  if (!decision.flows) return;
  const byId = new Map(file.flows.map((f) => [f.id, f]));
  const unknown = decision.flows.filter((d) => !byId.has(d.id)).map((d) => d.id);
  if (unknown.length) throw new Error(`unknown flows: ${unknown.join(", ")}`);
  const listed = new Set(decision.flows.map((d) => d.id));
  const ordered = [
    ...decision.flows.map((d) => ({
      ...byId.get(d.id)!,
      selected: d.selected,
      title: d.title ?? byId.get(d.id)!.title,
    })),
    // Flows the decision left out keep their place after the listed ones, unselected.
    ...file.flows.filter((f) => !listed.has(f.id)).map((f) => ({ ...f, selected: false })),
  ];
  await ctx.write(jobPaths.flows, FlowsFile, {
    ...file,
    flows: ordered.map((f, i) => ({ ...f, rank: i + 1 })),
  });
};

/** Line edits from gate 2 → script/script.<lang>.json. */
const script: GateFn<"gate-script"> = async (ctx, decision) => {
  const langs = new Set((decision.edits ?? []).map((e) => e.lang));
  for (const lang of langs) {
    const edits = decision.edits!.filter((e) => e.lang === lang);
    const file = await ctx.read(jobPaths.script(lang), Script);
    for (const edit of edits) {
      const segment = file.segments.find((s) => s.beatId === edit.beatId);
      if (!segment) throw new Error(`no beat ${edit.beatId} in the ${lang} script`);
      segment.text = edit.text;
    }
    await ctx.write(jobPaths.script(lang), Script, file);
  }
};

export const gates: { [G in GateName]?: GateFn<G> } = {
  "gate-flows": flows,
  "gate-script": script,
};

/**
 * Work a waiting gate does without releasing it (PRD §5.1 gate 1): re-rehearse an edited step, or
 * explore and rehearse a flow the person describes. Each checks its payload before it starts.
 */
export type GateAction = {
  schema: z.ZodType;
  run: (ctx: StageContext, payload: unknown) => Promise<unknown>;
  /** What the activity log says when it's done. */
  done: (result: unknown) => string;
};

export const gateActions: { [G in GateName]?: Record<string, GateAction> } = {
  "gate-flows": {
    "edit-step": {
      schema: StepEdit,
      run: (ctx, payload) => editStep(ctx, payload),
      done: (flow) => {
        const f = flow as {
          title: string;
          rehearsal?: { ok: boolean; reason?: string };
        };
        return f.rehearsal?.ok
          ? `"${f.title}" replays with the edit`
          : `"${f.title}" didn't replay: ${f.rehearsal?.reason ?? "unknown"}`;
      },
    },
    "add-flow": {
      schema: AddFlow,
      run: (ctx, payload) => addFlow(ctx, payload),
      done: (flow) => {
        const f = flow as { title: string; selected: boolean };
        return f.selected ? `Added "${f.title}"` : `Added "${f.title}", but it didn't replay, so it isn't selected`;
      },
    },
  },
};
