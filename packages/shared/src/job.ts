import { z } from "zod";
import { Aspect, FormFactor, IsoTime, Lang, Seconds, VideoMode } from "./common.ts";

// The job: config (POST /jobs body), state (state.json), stages and gate decisions (PRD §7.3, §7.4)

export const StageName = z.enum([
  "understand",
  "auth",
  "discover",
  "flow-runs",
  "gate-flows",
  "record",
  "script",
  "gate-script",
  "voice",
  "direct",
  "preview",
  "gate-preview",
  "render",
]);
export type StageName = z.infer<typeof StageName>;

export const GateName = z.enum(["gate-flows", "gate-script", "gate-preview"]);
export type GateName = z.infer<typeof GateName>;

export type StageInfo = {
  name: StageName;
  /** For the stage rail. */
  label: string;
  /** Stages that must be done (or skipped) first. */
  after: StageName[];
  /** Waits for a decision on POST /jobs/:id/gates/:name; autopilot approves it. */
  gate?: true;
};

/** The pipeline in display order. Brand kit and creative brief run inside understand. */
export const STAGES: readonly StageInfo[] = [
  { name: "understand", label: "Understand", after: [] },
  { name: "auth", label: "Sign in", after: [] },
  { name: "discover", label: "Explore", after: ["understand", "auth"] },
  { name: "flow-runs", label: "Try flows", after: ["discover"] },
  { name: "gate-flows", label: "Review flows", after: ["flow-runs"], gate: true },
  { name: "record", label: "Record", after: ["gate-flows"] },
  { name: "script", label: "Script", after: ["record"] },
  { name: "gate-script", label: "Review script", after: ["script"], gate: true },
  { name: "voice", label: "Voice", after: ["gate-script"] },
  { name: "direct", label: "Direct", after: ["voice"] },
  { name: "preview", label: "Preview", after: ["direct"] },
  { name: "gate-preview", label: "Review preview", after: ["preview"], gate: true },
  { name: "render", label: "Render", after: ["gate-preview"] },
];

export const AuthConfig = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("public") }),
  /** A TinyFish profile for the agents plus a sealed local session for the recorder (§8.2). */
  z.object({ mode: z.literal("sign-in-once"), profileId: z.string().optional() }),
  z.object({ mode: z.literal("vault"), credentialItemIds: z.array(z.string()).min(1) }),
]);
export type AuthConfig = z.infer<typeof AuthConfig>;

/** The POST /jobs body. Defaults fill in what the composer leaves out. */
export const JobConfig = z.object({
  url: z.url({ protocol: /^https?$/ }),
  auth: AuthConfig.default({ mode: "public" }),
  /** The optional video prompt (FR-5). */
  stylePrompt: z.string().default(""),
  focusPrompt: z.string().optional(),
  mode: VideoMode.default("launch"),
  variants: z
    .object({
      aspects: z.array(Aspect).min(1),
      langs: z.array(Lang).min(1),
      formFactors: z.array(FormFactor).min(1),
    })
    .default({ aspects: ["16x9"], langs: ["en"], formFactors: ["desktop"] }),
  autopilot: z.boolean().default(false),
  /** Narrate the video (ElevenLabs). Off: a silent edit with the script as captions. */
  voiceover: z.boolean().default(true),
  /** A re-run of job `of` (§9.8.1). */
  rerun: z.object({ of: z.string(), skipIfUnchanged: z.boolean() }).optional(),
});
export type JobConfig = z.infer<typeof JobConfig>;
export type JobConfigInput = z.input<typeof JobConfig>;

export const StageStatus = z.enum(["pending", "running", "waiting", "done", "failed", "skipped", "cancelled"]);
export type StageStatus = z.infer<typeof StageStatus>;

export const JobStatus = z.enum(["queued", "running", "waiting", "done", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const StageError = z.object({
  message: z.string(),
  /** Machine-readable cause, e.g. "tinyfish.blocked", "llm.unavailable". */
  code: z.string().optional(),
  retryable: z.boolean().optional(),
});
export type StageError = z.infer<typeof StageError>;

export const StageState = z.object({
  status: StageStatus,
  attempts: z.number().int().nonnegative(),
  startedAt: IsoTime.optional(),
  finishedAt: IsoTime.optional(),
  /** 0–1 */
  progress: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
  error: StageError.optional(),
  cacheKey: z.string().optional(),
});
export type StageState = z.infer<typeof StageState>;

/** state.json: everything the worker needs to resume, and what GET /jobs/:id returns. Version 3 added `config.voiceover`. */
export const Job = z.object({
  schemaVersion: z.literal(3),
  id: z.string(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
  status: JobStatus,
  config: JobConfig,
  stages: z.record(StageName, StageState),
});
export type Job = z.infer<typeof Job>;

/** A state.json from an older version, brought up to date: version 2 jobs were all narrated. */
export function upgradeJob(raw: unknown): unknown {
  const job = raw as { schemaVersion?: number; config?: Record<string, unknown> } | undefined;
  if (job?.schemaVersion !== 2 || !job.config) return raw;
  return { ...job, schemaVersion: 3, config: { voiceover: true, ...job.config } };
}

/** How the worker reads state.json: older versions are upgraded, then checked as the current one. */
export const StoredJob = z.preprocess(upgradeJob, Job);

// Gate decisions: the POST /jobs/:id/gates/:gate body

export const FlowsDecision = z.object({
  action: z.literal("approve"),
  /** Array order is the new flow order. Leave out to accept the selection as is. */
  flows: z.array(z.object({ id: z.string(), selected: z.boolean(), title: z.string().optional() })).optional(),
});
export type FlowsDecision = z.infer<typeof FlowsDecision>;

export const ScriptDecision = z.object({
  action: z.literal("approve"),
  /** Line edits, written back to script/script.<lang>.json. */
  edits: z.array(z.object({ lang: Lang, beatId: z.string(), text: z.string() })).optional(),
});
export type ScriptDecision = z.infer<typeof ScriptDecision>;

export const PreviewDecision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  /** Sends direct and preview back with the request; the director resumes its session. */
  z.object({ action: z.literal("revise"), revise: z.string().min(1), at: Seconds.optional() }),
]);
export type PreviewDecision = z.infer<typeof PreviewDecision>;

export const GATE_DECISIONS = {
  "gate-flows": FlowsDecision,
  "gate-script": ScriptDecision,
  "gate-preview": PreviewDecision,
} as const satisfies Record<GateName, z.ZodType>;
export type GateDecision<G extends GateName> = z.infer<(typeof GATE_DECISIONS)[G]>;
