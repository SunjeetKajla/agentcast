import { z } from "zod";
import { Flow, ReplayPlan } from "@agentcast/shared";
import { Candidate } from "./agent";

/** Proposed additive contracts for Kaustav's shared registry; all I/O validates these schemas. */
export const ExplorationTask = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  requestHash: z.string(),
  state: z.enum(["creating", "running", "done", "failed", "uncertain"]),
  runId: z.string().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export type ExplorationTask = z.infer<typeof ExplorationTask>;
export const ExplorationPlan = z.object({
  schemaVersion: z.literal(1),
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
  candidates: z.array(Candidate).max(3),
});
export type ExplorationPlan = z.infer<typeof ExplorationPlan>;
export const RehearsalFile = z.object({
  schemaVersion: z.literal(1),
  flowHash: z.string(),
  flow: Flow,
  replay: ReplayPlan.optional(),
});
export const AuthState = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["sign-in-once", "vault"]),
  profileId: z.string().optional(),
  sessionFile: z.literal("auth/session.enc"),
});
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
