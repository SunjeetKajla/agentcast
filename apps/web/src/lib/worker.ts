import "server-only";

// The worker is only ever called from the web app's server (AGENTS.md: all worker calls go through
// src/app/api/jobs/… proxies), so its URL never reaches the browser.
const WORKER_URL = (process.env.WORKER_URL || "http://127.0.0.1:4000").replace(/\/$/, "");

const OFFLINE = {
  error: "The AgentCast worker isn't running. Start it with `pnpm dev:worker`, then try again.",
};

/** Call the worker. A worker that isn't up becomes a 503 the UI can explain. */
export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${WORKER_URL}${path}`, { ...init, cache: "no-store" });
  } catch {
    return Response.json(OFFLINE, { status: 503 });
  }
}

/** Pass a worker response through, keeping its status and the headers that matter. */
export function relay(upstream: Response, keep = ["content-type"]): Response {
  const headers = new Headers();
  for (const name of keep) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** Job ids are job_<base36><hex>; refuse anything else before it reaches a worker URL. */
export const isJobId = (id: string) => /^job_[a-z0-9]+$/.test(id);

export const notFound = () => Response.json({ error: "not found" }, { status: 404 });
