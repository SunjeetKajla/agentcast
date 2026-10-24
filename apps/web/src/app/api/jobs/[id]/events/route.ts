import { isJobId, notFound, workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * The job's live event stream (server-sent events), passed through from the worker. EventSource sends
 * Last-Event-ID when it reconnects, and the worker replays everything after it, so nothing is missed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isJobId(id)) return notFound();
  const lastEventId = req.headers.get("last-event-id");
  const upstream = await workerFetch(`/jobs/${id}/events`, {
    headers: lastEventId ? { "last-event-id": lastEventId } : {},
    signal: req.signal,
  });
  if (!upstream.ok || !upstream.body) return upstream;
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
