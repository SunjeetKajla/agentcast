"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import ProgressTracker from "@/components/ProgressTracker";
import ProgressBar from "@/components/ProgressBar";
import ScriptPreview from "@/components/ScriptPreview";
import { getJob } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function GeneratePage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redirectTimer = useRef<NodeJS.Timeout | null>(null);

  const pollJob = useCallback(async () => {
    try {
      const data = await getJob(jobId);
      setJob(data);

      if (data.status === "completed") {
        if (!redirectTimer.current) {
          redirectTimer.current = setTimeout(() => {
            router.push(`/video/${jobId}`);
          }, 800);
        }
      } else if (data.status === "failed") {
        setError(data.error || "Generation failed. Please try again.");
      }
    } catch {
      setError("Lost connection to generation service");
    }
  }, [jobId, router]);

  useEffect(() => {
    pollJob();
    const interval = setInterval(pollJob, 1500);
    return () => {
      clearInterval(interval);
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [pollJob]);

  // Estimate remaining time based on progress
  const progress = job?.progress ?? 15;
  const estimatedRemaining =
    progress >= 100
      ? "Finishing render..."
      : `~${Math.max(1, Math.round(((100 - progress) / Math.max(progress, 1)) * 8))}s remaining`;

  return (
    <div className="w-full max-w-2xl px-6 py-12 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-8"
      >
        {/* Header */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span>Pipeline Active</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Generating your video…
          </h1>
          {job && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {job.url}
            </p>
          )}
        </div>

        {/* Error notification */}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            <span>{error}</span>
            <button
              onClick={() => router.push("/")}
              className="rounded-lg bg-red-500/20 px-3 py-1 text-xs font-semibold hover:bg-red-500/30 text-white"
            >
              Back to Home
            </button>
          </div>
        )}

        {/* Overall Progress Bar */}
        <div className="space-y-2 rounded-2xl border border-border/80 bg-card p-6">
          <ProgressBar value={progress} />
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span className="font-medium text-foreground capitalize">
              Status: {job?.status ?? "processing"}
            </span>
            <span className="font-mono text-accent">{estimatedRemaining}</span>
          </div>
        </div>

        {/* Pipeline Step-by-Step Tracker */}
        {job?.pipeline_steps && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Execution Pipeline
            </h2>
            <ProgressTracker steps={job.pipeline_steps} />
          </div>
        )}

        {/* Script Preview (Collapsible) */}
        {job?.script && job.script.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <ScriptPreview scenes={job.script} />
          </motion.div>
        )}

        {/* Cancel / Return option */}
        <div className="flex justify-center pt-4">
          <button
            onClick={() => router.push("/")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Cancel and return to home
          </button>
        </div>
      </motion.div>
    </div>
  );
}
