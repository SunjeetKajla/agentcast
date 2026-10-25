import { isJobId, notFound, relay, workerFetch } from "@/lib/worker";

/** Human sign-in completion only. Credentials never pass through this endpoint. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; stage: string; name: string }> },
) {
  const { id, stage, name } = await params;
  if (!isJobId(id) || stage !== "auth" || name !== "signed-in") return notFound();
  return relay(await workerFetch(`/jobs/${id}/stages/auth/signals/signed-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await req.text(),
  }));
}
