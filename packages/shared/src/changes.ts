import { z } from "zod";
import { IsoTime, LocatorStrategy, Seconds } from "./common.ts";

// record/changes.json, a re-run's change report (PRD §9.8.1, FR-91)

export const ChangeReport = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string(),
  parentJobId: z.string(),
  at: IsoTime,
  changed: z.boolean(),
  /** "UI changed in 1 of 2 flows. …" */
  summary: z.string(),
  flows: z.array(
    z.object({
      flowId: z.string(),
      title: z.string(),
      status: z.enum(["unchanged", "changed", "failed"]),
      reason: z.string().optional(),
      seconds: z.object({ before: Seconds, after: Seconds }).optional(),
      /** Changed steps only. */
      steps: z.array(
        z.object({
          stepId: z.string(),
          label: z.string(),
          locator: z.object({ before: z.string(), after: z.string(), strategy: LocatorStrategy }).optional(),
          /** Why the learned check was dropped. */
          outcome: z.string().optional(),
          /** 0–1 */
          visual: z.object({ page: z.number().min(0).max(1), element: z.number().min(0).max(1).optional() }).optional(),
          frames: z.object({ before: z.string(), after: z.string() }).optional(),
        }),
      ),
    }),
  ),
});
export type ChangeReport = z.infer<typeof ChangeReport>;
