import { z } from "zod";
import { Rect, Seconds } from "./common.ts";

/** All references are job-relative. Never persist signed provider URLs or session state. */
export const AssetPath = z
  .string()
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_./-]+$/);
export const FilmPlan = z.object({
  schemaVersion: z.literal(1),
  premise: z.string(),
  approach: z.enum(["demonstration", "showcase"]),
  moments: z
    .array(
      z.object({
        id: z.string(),
        action: z.string(),
        payoff: z.string(),
        verification: z.string(),
        required: z.boolean(),
      }),
    )
    .max(5),
  limitations: z.array(z.string()),
});
export type FilmPlan = z.infer<typeof FilmPlan>;

/** Capture strategies: Live screencast, Studio's virtual clock (v2), or settled states. */
export const CaptureStrategy = z.enum(["live", "studio", "states"]);
export type CaptureStrategy = z.infer<typeof CaptureStrategy>;

export const EvidenceFile = z.object({
  /** 2 added the "studio" capture. */
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  inputHash: z.string(),
  approach: z.enum(["demonstration", "showcase"]),
  moments: z.array(
    z.object({
      id: z.string(),
      flowId: z.string(),
      stepId: z.string(),
      action: z.string(),
      label: z.string(),
      from: Seconds,
      settled: Seconds,
      to: Seconds,
      box: Rect.optional(),
      source: z.enum(["agent", "tour", "user"]),
      capture: CaptureStrategy,
      /** Facts observed locally; website copy and agent narration are not observations. */
      observations: z.array(z.string()),
      outputs: z.array(AssetPath),
    }),
  ),
  outputs: z.array(
    z.object({
      file: AssetPath,
      flowId: z.string(),
      t: Seconds,
      seconds: Seconds,
      audible: z.boolean(),
      stepId: z.string().optional(),
    }),
  ),
  limitations: z.array(z.string()),
});
export type EvidenceFile = z.infer<typeof EvidenceFile>;

export const QualityIssue = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  sceneId: z.string().optional(),
  flowId: z.string().optional(),
  repair: z.enum(["explore", "capture", "reframe", "audio", "edit"]),
});
export type QualityIssue = z.infer<typeof QualityIssue>;
export const QualityReport = z.object({
  schemaVersion: z.literal(1),
  inputHash: z.string(),
  passed: z.boolean(),
  issues: z.array(QualityIssue),
  checks: z.array(z.string()),
  reviewFrames: z.array(AssetPath).default([]),
});
export type QualityReport = z.infer<typeof QualityReport>;

export const RecoveryRequest = z.object({
  kind: z.enum(["explore", "capture", "reframe", "audio", "edit"]),
  reason: z.string().min(1).max(1000),
  flowId: z.string().optional(),
  sceneId: z.string().optional(),
});
export type RecoveryRequest = z.infer<typeof RecoveryRequest>;
export const RecoveryJournal = z.object({
  schemaVersion: z.literal(1),
  attempts: z.array(
    z.object({
      id: z.string(),
      inputHash: z.string(),
      request: RecoveryRequest,
      status: z.enum(["started", "done", "failed"]),
      result: z.string().optional(),
    }),
  ),
});
export type RecoveryJournal = z.infer<typeof RecoveryJournal>;

export const CaptureReport = z.object({
  /** 2 added the "studio" strategy. */
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  flows: z.array(
    z.object({
      flowId: z.string(),
      strategy: CaptureStrategy,
      dpr: z.number().positive(),
      passed: z.boolean(),
      reason: z.string(),
      p95GapMs: z.number().nonnegative().optional(),
      maxGapMs: z.number().nonnegative().optional(),
    }),
  ),
});
export type CaptureReport = z.infer<typeof CaptureReport>;

export const CaptureOverrides = z.object({
  schemaVersion: z.literal(1),
  states: z.array(z.string()),
});
export type CaptureOverrides = z.infer<typeof CaptureOverrides>;
export const QualityRevision = z.object({
  schemaVersion: z.literal(1),
  inputHash: z.string(),
  prompt: z.string(),
});
export type QualityRevision = z.infer<typeof QualityRevision>;
export const CapturePlan = z.object({
  /** 2 added the "studio" strategy. */
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  inputHash: z.string(),
  dpr: z.number().positive(),
  strategy: CaptureStrategy,
  reason: z.string(),
});
export type CapturePlan = z.infer<typeof CapturePlan>;
export const OutputIndex = z.object({
  schemaVersion: z.literal(1),
  outputs: z.array(
    z.object({
      file: AssetPath,
      type: z.string(),
      t: Seconds,
      stepId: z.string().optional(),
    }),
  ),
});
export const StoredOutputIndex = z.preprocess(
  (raw) => (Array.isArray(raw) ? { schemaVersion: 1, outputs: raw } : raw),
  OutputIndex,
);
