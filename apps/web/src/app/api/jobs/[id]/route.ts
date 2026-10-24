import { isJobId, notFound, relay, workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isJobId(id)) return notFound();
  return relay(await workerFetch(`/jobs/${id}`));
}
