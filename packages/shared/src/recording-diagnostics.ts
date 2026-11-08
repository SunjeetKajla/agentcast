import { z } from "zod";
import { BrowserRuntime } from "./exploration.ts";

const interval = {
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  stepId: z.string().optional(),
};
const Navigation = z.object({
  ...interval,
  kind: z.enum(["navigation-wait", "loading-wait"]),
  startEvidence: z.enum(["main-document-request", "main-frame-commit"]),
  endEvidence: z.enum([
    "main-frame-commit",
    "domcontentloaded",
    "request-failed",
    "superseded",
    "capture-ended",
  ]),
});
export const RecordingTakeDiagnostic = z.object({
  flowId: z.string(),
  dpr: z.number().positive(),
  attempt: z.number().int().nonnegative(),
  status: z.enum(["ok", "failed"]),
  kind: z
    .enum([
      "success",
      "reused",
      "locator",
      "action",
      "outcome",
      "capture-stall",
    ])
    .optional(),
  stepId: z.string().optional(),
  reason: z.string().optional(),
  retryable: z.boolean().optional(),
  diagnostics: z
    .array(
      z.object({
        ...interval,
        kind: z.enum(["capture-stall", "navigation-wait", "loading-wait"]),
        reason: z.string(),
        retryable: z.boolean(),
      }),
    )
    .optional(),
  navigation: z.array(Navigation).optional(),
  gpu: BrowserRuntime.shape.gpu.optional(),
});
export const RecordingDiagnostics = z.object({
  schemaVersion: z.literal(1),
  takes: z.array(RecordingTakeDiagnostic),
});
export type RecordingDiagnostics = z.infer<typeof RecordingDiagnostics>;
