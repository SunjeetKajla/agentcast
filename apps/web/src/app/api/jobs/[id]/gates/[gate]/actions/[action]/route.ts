import { GateName } from "@agentcast/shared";
import { isJobId, notFound, relay, workerFetch } from "@/lib/worker";

/** Work a waiting gate does without releasing it (edit a step, add a flow). The worker answers 202 and reports progress as events. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; gate: string; action: string }> },
) {
  const { id, gate, action } = await params;
  if (
    !isJobId(id) ||
    !GateName.safeParse(gate).success ||
    !/^[a-z-]+$/.test(action)
  )
    return notFound();
  return relay(
    await workerFetch(`/jobs/${id}/gates/${gate}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await req.text(),
    }),
  );
}
