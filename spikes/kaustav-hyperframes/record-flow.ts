// Re-record one of a job's flows the way the record stage does, printing each take's stall report.
//   pnpm --filter @agentcast/spikes exec tsx kaustav-hyperframes/record-flow.ts --job <id> [--flow <id>]
import { readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FlowsFile, jobPaths } from "@agentcast/shared";
import { recordFlow } from "@agentcast/recorder";

const { values } = parseArgs({ options: { job: { type: "string" }, flow: { type: "string" } } });
const root = join(process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast"), "jobs", values.job!);
const { flows } = FlowsFile.parse(JSON.parse(await readFile(join(root, jobPaths.flows), "utf8")));
const flow = flows.find((f) => (values.flow ? f.id === values.flow : f.selected))!;
console.log(`Recording ${flow.id} "${flow.title}" (${flow.steps.length} steps)`);
try {
  const take = await recordFlow(flow, {
    outputPath: join(tmpdir(), `rec-${flow.id}.mp4`),
    timelinePath: join(tmpdir(), `rec-${flow.id}.json`),
    recordingId: "spike",
    browser: { formFactor: "desktop" },
    locate: { timeoutMs: 30_000 },
    onTake: (t) => console.log("take", t.attempt, t.status, t.reason ?? ""),
  });
  console.log("ok", take.path);
} catch (error) {
  const e = error as { takes?: { attempt: number; stall: { status: string; maxGapMs: number; p95GapMs: number; effectiveFps: number; motionDurationMs: number; gaps: number[] } }[]; cause?: unknown };
  console.log("failed:", (error as Error).message);
  const takes = e.takes ?? (e.cause as typeof e | undefined)?.takes;
  console.dir(takes?.[0], { depth: 3 });
  for (const t of (takes ?? []).filter((t) => t.stall))
    console.log(t.attempt, t.stall.status, `max ${t.stall.maxGapMs.toFixed(0)} ms, p95 ${t.stall.p95GapMs.toFixed(0)} ms, ${t.stall.effectiveFps.toFixed(1)} fps over ${t.stall.motionDurationMs.toFixed(0)} ms; worst gaps ${[...t.stall.gaps].sort((a, b) => b - a).slice(0, 6).map((g) => g.toFixed(0)).join(", ")}`);
}
