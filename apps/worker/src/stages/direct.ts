import { jobPaths } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { pretend, stub } from "./stub.ts";

// direct: baseline edit (Neeraj, packages/video) improved by the Claude Code director (PRD §9.7). Owner: Kaustav. Stub for now.
export const direct: StageFn = async (ctx) => {
  const revision = await ctx.decision("gate-preview");
  if (revision?.action === "revise") ctx.log(`Revising: ${revision.revise}`);
  ctx.emit({ type: "llm", stage: ctx.stage, kind: "tool_use", text: "Read DIRECTOR.md" });
  await pretend(ctx, 0.5);
  ctx.emit({ type: "llm", stage: ctx.stage, kind: "tool_use", text: "Edit edl.json" });
  await stub(ctx, [jobPaths.edl]);
  ctx.emit({ type: "llm", stage: ctx.stage, kind: "done", text: "Stub edit" });
};
