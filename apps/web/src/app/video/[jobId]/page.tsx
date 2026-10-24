import { redirect } from "next/navigation";

/** Older links: a job's finished videos now live at /jobs/[id]. */
export default async function VideoRedirect({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  redirect(`/jobs/${jobId}`);
}
