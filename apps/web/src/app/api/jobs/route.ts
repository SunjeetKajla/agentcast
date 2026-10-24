import { relay, workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

/** Every job, newest first. */
export async function GET() {
  return relay(await workerFetch("/jobs"));
}

/** Start a job. The worker validates the body against JobConfig and answers 202. */
export async function POST(req: Request) {
  const body = await req.text();
  return relay(
    await workerFetch("/jobs", { method: "POST", headers: { "content-type": "application/json" }, body }),
  );
}
