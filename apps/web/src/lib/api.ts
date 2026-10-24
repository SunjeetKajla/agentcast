import type { GateDecision, GateName, Job, JobConfigInput } from "@agentcast/shared";
import type { z } from "zod";

// Browser-side calls. Everything goes through the web app's /api proxies, never to the worker directly.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "Can't reach the AgentCast web server.");
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const message = (body as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const createJob = (config: JobConfigInput) => call<Job>("/api/jobs", json(config));
export const listJobs = () => call<{ jobs: Job[] }>("/api/jobs").then((r) => r.jobs);
export const getJob = (id: string) => call<Job>(`/api/jobs/${id}`);
export const cancelJob = (id: string) => call<Job>(`/api/jobs/${id}/cancel`, { method: "POST" });
export const decide = <G extends GateName>(id: string, gate: G, decision: GateDecision<G>) =>
  call<Job>(`/api/jobs/${id}/gates/${gate}`, json(decision));

/** Work a waiting gate does without releasing it: "edit-step" or "add-flow" at gate-flows. Progress arrives as "action" events. */
export const gateAction = (id: string, gate: GateName, action: string, body: unknown) =>
  call<{ accepted: true }>(`/api/jobs/${id}/gates/${gate}/actions/${action}`, json(body));

/** A job file's URL. `version` (an artifact event's seq) busts the cache when the file is rewritten. */
export function fileUrl(id: string, rel: string, version?: number): string {
  const path = rel.split("/").map(encodeURIComponent).join("/");
  return `/api/jobs/${id}/files/${path}${version ? `?v=${version}` : ""}`;
}

/** Read and validate a JSON artifact (AGENTS.md rule 3: validated on read). */
export async function readArtifact<S extends z.ZodType>(
  id: string,
  rel: string,
  schema: S,
  version?: number,
): Promise<z.output<S>> {
  const data = await call<unknown>(fileUrl(id, rel, version));
  return schema.parse(data);
}
