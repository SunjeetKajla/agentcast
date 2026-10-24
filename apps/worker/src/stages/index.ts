import type { GateName, StageName } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { auth } from "./auth.ts";
import { direct } from "./direct.ts";
import { discover } from "./discover.ts";
import { flowRuns } from "./flow-runs.ts";
import { preview } from "./preview.ts";
import { record } from "./record.ts";
import { render } from "./render.ts";
import { script } from "./script.ts";
import { understand } from "./understand.ts";
import { voice } from "./voice.ts";

// The stage registry. Owner: Kaustav. Each stage lives in its own file; edit that file, not this one.
// Gates have no stage function: the orchestrator waits for a decision and applies it (gates.ts).

export type StageRegistry = Record<Exclude<StageName, GateName>, StageFn>;

export const stages: StageRegistry = {
  understand,
  auth,
  discover,
  "flow-runs": flowRuns,
  record,
  script,
  voice,
  direct,
  preview,
  render,
};

export { gateActions, gates, type GateAction } from "./gates.ts";
export type { GateFn, StageFn, StageResult } from "./types.ts";
