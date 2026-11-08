"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { variantMatrix, voiced, type Job } from "@agentcast/shared";
import AppShell from "@/components/app/AppShell";
import { ApiError, listJobs } from "@/lib/api";
import { STAGE_TITLE, currentStage, elapsed, fieldState, finished, hostOf, modeName, took } from "@/lib/job-model";
import { overallProgress } from "@/lib/job-state";

// Every job on this worker, newest first. Each row's mark is the colour its job page's field shows:
// blue working, yellow waiting on you, white ready, pink failed, grey cancelled.

function status(job: Job): string {
  if (job.status === "done") return "Ready";
  if (job.status === "failed") return "Failed";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "queued") return "Starting";
  const stage = currentStage(job);
  if (job.status === "waiting" && stage) return `Needs you · ${STAGE_TITLE[stage].replace("Review the ", "review the ").replace("Review ", "review ")}`;
  return stage ? `${STAGE_TITLE[stage]} · ${Math.round(overallProgress(job) * 100)}%` : "Working";
}

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    document.title = "Your videos · AgentCast";
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const load = () =>
      listJobs()
        .then((list) => {
          if (stopped) return;
          setJobs(list);
          setNow(Date.now());
          setError(undefined);
          // Keep jobs in progress fresh.
          if (list.some((j) => !finished(j))) timer = setTimeout(load, 4000);
        })
        .catch((err: ApiError) => !stopped && setError(err.message));
    load();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  const working = jobs?.filter((j) => !finished(j) && fieldState(j) !== "wait").length ?? 0;
  const waiting = jobs?.filter((j) => fieldState(j) === "wait").length ?? 0;

  return (
    <AppShell current="videos" connection={error ? { tone: "off", text: "Can’t reach the worker" } : jobs ? { tone: "live", text: "Connected to the worker" } : { tone: "idle", text: "Connecting…" }}>
      <div className="ttl">
        <div className="ttl-l">
          <p className="crumb">Every job on this machine’s worker</p>
          <h1 className="jt">Your videos</h1>
          <p className="finding">
            {error
              ? error
              : !jobs
                ? "Loading the jobs…"
                : jobs.length === 0
                  ? "No videos yet. Paste a link on the home page to make the first."
                  : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}${working ? `, ${working} working` : ""}${waiting ? `, ${waiting} waiting on you` : ""}.`}
          </p>
        </div>
        <div className="ttl-act">
          <Link className="ab ab-inv" href="/#top">New video <span className="arr" aria-hidden="true">→</span></Link>
        </div>
      </div>

      {jobs && jobs.length > 0 && (
        <section className="blk" aria-label="Jobs">
          <table className="jl">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Status</th>
                <th scope="col" className="hide-s">Video</th>
                <th scope="col" className="num hide-s">Outputs</th>
                <th scope="col" className="num hide-s">Time</th>
                <th scope="col" className="num">Started</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const n = variantMatrix(job.config.variants).length;
                return (
                  <tr key={job.id}>
                    <th scope="row">
                      <Link href={`/jobs/${job.id}`} className="jl-link">
                        <span className={`jl-mark s-${fieldState(job)}`} aria-hidden="true" />
                        {hostOf(job.config.url)}
                      </Link>
                    </th>
                    <td>{status(job)}</td>
                    <td className="hide-s">{modeName(job)}, {voiced(job.config) ? "narrated" : "music-led"}</td>
                    <td className="num hide-s">{n}</td>
                    <td className="num hide-s">{took(elapsed(job, now))}</td>
                    <td className="num">{when(job.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="jl-key">
            <span><i className="s-run" />Working</span><span><i className="s-wait" />Needs you</span><span><i className="s-done" />Ready</span><span><i className="s-fail" />Failed</span><span><i className="s-off" />Cancelled</span>
          </p>
        </section>
      )}
      {jobs && jobs.length === 0 && (
        <section className="air" data-state="run" aria-label="No videos yet">
          <div className="air-in">
            <h2 className="air-h"><span>Nothing yet</span></h2>
            <p className="air-lead">Paste your product’s link on the home page. Its job shows up here, live.</p>
            <div><Link className="ab ab-f" href="/#top">Make your first video <span className="arr" aria-hidden="true">→</span></Link></div>
          </div>
        </section>
      )}
    </AppShell>
  );
}
