import { z } from "zod";

/** Bounded exploration of observed links, never a claim of an exhaustive site crawl. */
export const ExplorationBudget = z.object({
  maxFlows: z.number().int().min(1).max(12).default(6),
  maxSections: z.number().int().min(1).max(24).default(12),
  maxScouts: z.number().int().min(1).max(4).default(3),
  scoutMaxActions: z.number().int().positive().max(64).default(18),
  flowMaxActions: z.number().int().positive().max(96).default(32),
  scoutTimeoutMs: z.number().int().positive().max(600_000).default(240_000),
  flowTimeoutMs: z.number().int().positive().max(600_000).default(300_000),
});
export type ExplorationBudget = z.infer<typeof ExplorationBudget>;

const Evidence = z.object({
  source: z.enum(["inspection", "scout", "flow", "tour"]),
  taskId: z.string(),
  observed: z.boolean(),
  attempted: z.boolean(),
  replayed: z.boolean(),
  blocked: z.boolean(),
});
const Counts = z.object({
  discovered: z.number().int().nonnegative(),
  observed: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
  replayed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  unvisited: z.number().int().nonnegative(),
});
const Path = z.object({
  url: z.url(),
  path: z.string(),
  areaId: z.string(),
  discovered: z.boolean(),
  inspected: z.boolean(),
  observed: z.boolean(),
  attempted: z.boolean(),
  replayed: z.boolean(),
  blocked: z.boolean(),
  unvisited: z.boolean(),
  evidence: z.array(Evidence),
});
export const CoverageReport = z.object({
  schemaVersion: z.literal(1),
  url: z.url(),
  scope: z.literal("bounded-same-site"),
  exhaustive: z.literal(false),
  budget: ExplorationBudget,
  areas: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        entryUrl: z.url(),
        paths: z.array(z.string()),
        counts: Counts,
      }),
    )
    .max(24),
  paths: z.array(Path).max(480),
  counts: Counts,
  tasks: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["scout", "flow"]),
      requestedUrl: z.url(),
      status: z.enum(["running", "done", "failed", "interrupted"]),
      maxActions: z.number().int().positive(),
      timeoutMs: z.number().int().positive(),
      actions: z.number().int().nonnegative(),
      elapsedMs: z.number().nonnegative().optional(),
      traceAvailable: z.boolean(),
    }),
  ),
  limits: z.object({
    inventoryTruncated: z.boolean(),
    excludedLinks: z.number().int().nonnegative(),
    candidateFlows: z.number().int().nonnegative(),
    selectedFlows: z.number().int().nonnegative(),
    scoutTasks: z.number().int().nonnegative(),
    flowTasks: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
    /** Includes one possible repair of each focused flow, not additional candidate flows. */
    maxAgentActions: z.number().int().positive(),
    maxAgentTimeMs: z.number().int().positive(),
    elapsedTaskMs: z.number().nonnegative(),
  }),
  notes: z.array(z.string()),
});
export type CoverageReport = z.infer<typeof CoverageReport>;
