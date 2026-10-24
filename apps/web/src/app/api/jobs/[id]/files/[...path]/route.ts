import { isJobId, notFound, relay, workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

/** Job files (flows, scripts, frames, videos), with byte ranges so <video> can seek. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await params;
  if (!isJobId(id) || path.some((p) => p === ".." || p.startsWith("."))) return notFound();
  const range = req.headers.get("range");
  const upstream = await workerFetch(`/files/${id}/${path.map(encodeURIComponent).join("/")}`, {
    headers: range ? { range } : {},
  });
  return relay(upstream, ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"]);
}
