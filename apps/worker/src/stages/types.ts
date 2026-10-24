import type { GateDecision, GateName } from "@agentcast/shared";
import type { StageContext } from "../context.ts";

/** Return nothing when done, or { skipped } when the stage had nothing to do (e.g. auth on a public site). */
export type StageResult = void | { skipped?: boolean; message?: string };

/** A stage. Throw to fail it; the message is shown on the job page. */
export type StageFn = (ctx: StageContext) => Promise<StageResult>;

/** Applies a gate decision to the job's artifacts before the gate releases. */
export type GateFn<G extends GateName> = (ctx: StageContext, decision: GateDecision<G>) => Promise<void>;
