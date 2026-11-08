import { z } from "zod";
import { Expectation, Flow, ReplayPlan } from "./flow.ts";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};
export const decodeWebsiteText = (s: string) =>
  s
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#39);/g,
      (_, e: string) => ENTITIES[e]!,
    )
    .trim();
const text = z.string().transform(decodeWebsiteText);
const optStr = z
  .string()
  .nullish()
  .transform((s) =>
    s && s.trim() ? decodeWebsiteText(s) || undefined : undefined,
  );
export const ExploreAgentStep = z
  .object({
    action: text,
    target_text: optStr,
    target_role: optStr,
    target_label: optStr,
    target_placeholder: optStr,
    near_text: optStr,
    value: z.union([optStr, z.object({ redacted: z.literal(true) })]),
    secret: z.boolean().optional(),
    result_url_path: optStr,
    result_visible_text: optStr,
    narration_hint: optStr,
    /** Checks learned by the trusted browser executor, never invented by the model. */
    expect: z.array(Expectation).optional(),
    outcome: z.enum(["verified", "unverified"]).optional(),
  })
  .transform(({ value, ...step }) => ({
    ...step,
    value: typeof value === "object" ? undefined : value,
    secret:
      step.secret ||
      (typeof value === "object" && value?.redacted) ||
      undefined,
  }));
export type ExploreAgentStep = z.infer<typeof ExploreAgentStep>;

export const ExploreCandidate = z.object({
  title: text.pipe(z.string().min(1)),
  why_it_matters: text.default(""),
  start_url: z.string().default(""),
  outline: z.array(text).default([]),
  needs_sign_in: z.boolean().nullish(),
  performed: z.boolean().default(false),
  steps: z.array(ExploreAgentStep).default([]),
  value_shown: optStr,
});
export type ExploreCandidate = z.infer<typeof ExploreCandidate>;

/** Local exploration artifacts. All I/O validates these shared schemas. */
const CurrentExplorationTask = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  requestHash: z.string(),
  state: z.enum([
    "creating",
    "running",
    "done",
    "failed",
    "uncertain",
    "interrupted",
  ]),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export const ExplorationTask = z.preprocess((raw) => {
  const value = raw as Record<string, unknown>;
  return value?.schemaVersion === 1
    ? {
        ...value,
        schemaVersion: 2,
        state: value.state === "done" ? "done" : "interrupted",
      }
    : raw;
}, CurrentExplorationTask);
export type ExplorationTask = z.infer<typeof ExplorationTask>;
const CurrentExplorationPlan = z.object({
  schemaVersion: z.literal(2),
  entryUrl: z.url(),
  access: z.enum([
    "public",
    "demo",
    "authenticated",
    "sign-in-required",
    "blocked",
  ]),
  reason: z.string(),
  blockers: z.array(z.string()),
  candidates: z.array(ExploreCandidate).max(12),
});
export const ExplorationPlan = z.preprocess((raw) => {
  const plan = raw as { schemaVersion?: number } | undefined;
  return plan?.schemaVersion === 1 ? { ...plan, schemaVersion: 2 } : raw;
}, CurrentExplorationPlan);
export type ExplorationPlan = z.infer<typeof ExplorationPlan>;
export const RehearsalFile = z.object({
  schemaVersion: z.literal(2),
  flowHash: z.string(),
  flow: Flow,
  replay: ReplayPlan.optional(),
});
export const AuthState = z.preprocess(
  (raw) => {
    const value = raw as Record<string, unknown>;
    return value?.schemaVersion === 1
      ? {
          schemaVersion: 2,
          mode: "sign-in-once",
          sessionFile: value.sessionFile,
        }
      : raw;
  },
  z.object({
    schemaVersion: z.literal(2),
    mode: z.literal("sign-in-once"),
    sessionFile: z.literal("auth/session.enc"),
  }),
);
export type AuthState = z.infer<typeof AuthState>;
export const SessionState = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(["Strict", "Lax", "None"]),
    }),
  ),
  origins: z.array(
    z.object({
      origin: z.url(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});
export type SessionState = z.infer<typeof SessionState>;

export const BrowserTraceStep = z.object({
  action: z.string(),
  target_text: z.string().optional(),
  target_role: z.string().optional(),
  target_label: z.string().optional(),
  target_placeholder: z.string().optional(),
  near_text: z.string().optional(),
  value: z.string().optional(),
  result_url_path: z.string(),
  result_url: z.url().optional(),
  result_visible_text: z.string().optional(),
  expect: z.array(Expectation).optional(),
  elapsedMs: z.number().nonnegative().optional(),
  settle: z.enum(["dom-stable", "network-idle", "timeout"]).optional(),
  outcome: z.enum(["verified", "unverified"]).optional(),
  execution: z.enum(["confirmed", "uncertain"]).optional(),
});
const CurrentBrowserTrace = z.object({
  schemaVersion: z.literal(2),
  steps: z.array(BrowserTraceStep),
});
export const BrowserTrace = z.preprocess((raw) => {
  const trace = raw as { schemaVersion?: number } | undefined;
  return trace?.schemaVersion === 1 ? { ...trace, schemaVersion: 2 } : raw;
}, CurrentBrowserTrace);

/** Facts from the actual owned Chrome process; flags alone never establish GPU use. */
export const BrowserRuntime = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string(),
  gpu: z.object({
    backend: z.enum(["dgpu", "igpu", "cpu"]),
    channel: z.string(),
    renderer: z.string(),
    vendor: z.string(),
    hardwareAccelerated: z.boolean(),
    featureStatus: z.record(z.string(), z.string()),
    attempts: z.array(
      z.object({
        backend: z.enum(["dgpu", "igpu", "cpu"]),
        status: z.enum(["selected", "failed", "skipped"]),
        reason: z.string().optional(),
      }),
    ),
  }),
});
