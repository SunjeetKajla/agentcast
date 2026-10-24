import { FlowsFile, Script, jobPaths, type GateName } from "@agentcast/shared";
import type { GateFn } from "./types.ts";

// What each gate decision changes before the gate releases. Owner: Kaustav.
// A preview "revise" is handled by the orchestrator: it sends direct and preview back.

/** Selection, order and titles from gate 1 → explore/flows.json. */
const flows: GateFn<"gate-flows"> = async (ctx, decision) => {
  if (!decision.flows) return;
  const file = await ctx.read(jobPaths.flows, FlowsFile);
  const byId = new Map(file.flows.map((f) => [f.id, f]));
  const unknown = decision.flows.filter((d) => !byId.has(d.id)).map((d) => d.id);
  if (unknown.length) throw new Error(`unknown flows: ${unknown.join(", ")}`);
  const listed = new Set(decision.flows.map((d) => d.id));
  const ordered = [
    ...decision.flows.map((d) => ({ ...byId.get(d.id)!, selected: d.selected, title: d.title ?? byId.get(d.id)!.title })),
    // Flows the decision left out keep their place after the listed ones, unselected.
    ...file.flows.filter((f) => !listed.has(f.id)).map((f) => ({ ...f, selected: false })),
  ];
  await ctx.write(jobPaths.flows, FlowsFile, { ...file, flows: ordered.map((f, i) => ({ ...f, rank: i + 1 })) });
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
