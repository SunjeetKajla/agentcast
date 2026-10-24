"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Job } from "@agentcast/shared";
import { ApiError, listJobs } from "@/lib/api";
import { overallProgress, waitingGate } from "@/lib/job-state";
import { EASE, MOTION_OK, gsap, useGSAP, settle } from "@/lib/motion";

// Every job on this worker, newest first.

const MODE = { launch: "Launch video", tutorial: "Tutorial", sales: "Sales demo" } as const;

function status(job: Job): { text: string; cls: string } {
  if (job.status === "done") return { text: "Ready", cls: "text-green-400" };
  if (job.status === "failed") return { text: "Failed", cls: "text-red-400" };
  if (job.status === "cancelled") return { text: "Cancelled", cls: "text-white/40" };
  if (waitingGate(job)) return { text: "Needs your review", cls: "text-amber-400" };
  return { text: `Working · ${Math.round(overallProgress(job) * 100)}%`, cls: "text-accent" };
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>();
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      listJobs()
        .then((list) => {
          setJobs(list);
          setError(undefined);
          // Keep in-progress jobs fresh.
          if (list.some((j) => !["done", "failed", "cancelled"].includes(j.status))) timer = setTimeout(load, 4000);
        })
        .catch((err: ApiError) => setError(err.message));
    load();
    return () => clearTimeout(timer);
  }, []);

  useGSAP(
    () => {
      if (!jobs?.length) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo("[data-job-row]", ...settle({ autoAlpha: 0, y: 16, duration: 0.6, ease: EASE.expo, stagger: 0.05 }));
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [jobs === undefined] },
  );

  return (
    <div ref={root} className="w-full max-w-4xl px-6 py-14">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-5xl font-normal text-white">Your videos</h1>
          <p className="mt-2 text-sm text-white/60">Every job on this machine&apos;s worker.</p>
        </div>
        <Link href="/#hero-input" className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-white/90">
          New video
        </Link>
      </div>

      {error && <p className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-5 text-sm text-red-300">{error}</p>}
      {jobs?.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#121215]/60 p-10 text-center">
          <p className="font-serif text-2xl text-white">No videos yet.</p>
          <p className="mt-2 text-sm text-white/50">Paste your product&apos;s link on the home page to make the first one.</p>
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <ol className="space-y-2">
          {jobs.map((job) => {
            const s = status(job);
            return (
              <li key={job.id} data-job-row>
                <Link
                  href={`/jobs/${job.id}`}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#121215]/70 px-5 py-4 transition-colors hover:border-white/20 hover:bg-[#121215]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white transition-colors group-hover:text-accent">
                      {new URL(job.config.url).hostname.replace(/^www\./, "")}
                    </p>
                    <p className="mt-0.5 text-xs text-white/45">
                      {MODE[job.config.mode]} · {job.config.variants.aspects.map((a) => a.replace("x", ":")).join(", ")} ·{" "}
                      {job.config.variants.langs.join(", ").toUpperCase()} · {new Date(job.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs ${s.cls}`}>{s.text}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
