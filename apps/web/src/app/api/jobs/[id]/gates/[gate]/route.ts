import { GateName } from "@agentcast/shared";
import { isJobId, notFound, relay, workerFetch } from "@/lib/worker";

/** A review decision (PRD §5.1 gates). The worker checks it against GATE_DECISIONS. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; gate: string }> }) {
  const { id, gate } = await params;
  if (!isJobId(id) || !GateName.safeParse(gate).success) return notFound();
  return relay(
    await workerFetch(`/jobs/${id}/gates/${gate}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await req.text(),
    }),
  );
}
