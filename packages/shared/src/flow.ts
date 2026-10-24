import { z } from "zod";
import { FormFactor, LocatorStrategy, Seconds } from "./common.ts";

// flows.json, replay-plan.json (PRD §10, §9.2, §9.3.1)

export const Expectation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), pattern: z.string() }),
  z.object({ type: z.literal("text"), text: z.string(), match: z.enum(["loose", "exact"]) }),
  z.object({ type: z.literal("element"), role: z.string(), name: z.string() }),
  z.object({ type: z.literal("value"), target: z.string(), value: z.string() }),
  z.object({ type: z.literal("changed") }),
]);
export type Expectation = z.infer<typeof Expectation>;

export const StepAction = z.enum(["navigate", "click", "type", "select", "press", "scroll", "hover", "wait"]);
export type StepAction = z.infer<typeof StepAction>;

/** A semantic target: what a human sees, never a CSS selector (PRD §7.1 row 1). */
export const Target = z.object({
  text: z.string().optional(),
  role: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  near: z.string().optional(),
});
export type Target = z.infer<typeof Target>;

export const Step = z.object({
  id: z.string(),
  action: StepAction,
  target: Target.optional(),
  value: z.string().optional(),
  secret: z.boolean().optional(),
  expected: z.string().optional(),
  narrationHint: z.string().optional(),
  /** TinyFish step screenshot. */
  screenshotUrl: z.string().optional(),
  /** Rehearsal frame after this step, relative to the job dir. Gate 1 shows it. */
  frame: z.string().optional(),
  expect: z.array(Expectation).optional(),
});
export type Step = z.infer<typeof Step>;

export const StoryRole = z.enum(["setup", "core", "payoff", "share"]);
export type StoryRole = z.infer<typeof StoryRole>;

/** PRD §9.2.1. Judge scores are 0–5, deterministic signals 0–1. */
export const FlowScoring = z.object({
  valueAlignment: z.number().min(0).max(5),
  visiblePayoff: z.number().min(0).max(5),
  lengthFit: z.number().min(0).max(1),
  distinctness: z.number().min(0).max(1),
  focusMatch: z.number().min(0).max(5).optional(),
  riskPenalty: z.number().max(0),
  score: z.number(),
  storyRole: StoryRole,
  valuePropCited: z.string(),
  rationale: z.string(),
});
export type FlowScoring = z.infer<typeof FlowScoring>;

export const Flow = z.object({
  id: z.string(),
  title: z.string(),
  whyItMatters: z.string(),
  startUrl: z.url(),
  requiresAuth: z.boolean(),
  rank: z.number().int(),
  selected: z.boolean(),
  /** Missing until the judge has run. */
  scoring: FlowScoring.optional(),
  steps: z.array(Step).min(1),
  /** Missing for guided-tour flows, which no agent ran. */
  tinyfishRunId: z.string().optional(),
  source: z.enum(["agent", "tour", "user"]).default("agent"),
  /** Result of the local rehearsal (§9.2 step 2). Only flows that replay are eligible. */
  rehearsal: z
    .object({ ok: z.boolean(), seconds: Seconds.optional(), reason: z.string().optional() })
    .optional(),
});
export type Flow = z.infer<typeof Flow>;

export const FlowsFile = z.object({
  schemaVersion: z.literal(1),
  flows: z.array(Flow),
});
export type FlowsFile = z.infer<typeof FlowsFile>;

export const ReplayEntry = z.object({
  strategy: LocatorStrategy,
  locator: z.string(),
  lastOk: z.string(),
  /** From the last clean take; preferred over Step.expect. */
  learnedExpect: z.array(Expectation).optional(),
});
export type ReplayEntry = z.infer<typeof ReplayEntry>;

/** Resolved locators and learned checks, per form factor, keyed by step id. */
export const ReplayPlan = z.object({
  schemaVersion: z.literal(1),
  byFormFactor: z.partialRecord(FormFactor, z.record(z.string(), ReplayEntry)),
});
export type ReplayPlan = z.infer<typeof ReplayPlan>;
