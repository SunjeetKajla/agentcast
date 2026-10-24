import { isJobId, notFound, relay, workerFetch } from "@/lib/worker";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isJobId(id)) return notFound();
  return relay(await workerFetch(`/jobs/${id}/cancel`, { method: "POST" }));
}
