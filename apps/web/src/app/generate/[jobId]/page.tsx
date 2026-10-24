import { redirect } from "next/navigation";

/** Older links: a job's progress now lives at /jobs/[id]. */
export default async function GenerateRedirect({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  redirect(`/jobs/${jobId}`);
}
