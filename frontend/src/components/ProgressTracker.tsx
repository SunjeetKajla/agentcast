"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { PipelineStep } from "@/lib/types";

interface ProgressTrackerProps {
  steps: PipelineStep[];
}

function StepIcon({ status }: { status: PipelineStep["status"] }) {
  if (status === "completed") {
    return (
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500/20 text-green-400"
      >
        ✓
      </motion.span>
    );
  }
  if (status === "running") {
    return (
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/40" />
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-accent">
          <svg
            className="h-3 w-3 animate-spin text-white"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </span>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/20 text-red-400">
        ✕
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground">
      ⬜
    </span>
  );
}

function formatElapsed(start?: string, end?: string): string {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const secs = Math.round((e - s) / 1000);
  return `${secs}s`;
}

export default function ProgressTracker({ steps }: ProgressTrackerProps) {
  return (
    <div className="space-y-3">
      <AnimatePresence>
        {steps.map((step, i) => (
          <motion.div
            key={step.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors ${
              step.status === "running"
                ? "border-accent/50 bg-accent/5"
                : "border-border bg-card"
            }`}
          >
            <span className="text-sm font-mono text-muted-foreground w-5 text-right">
              {i + 1}
            </span>
            <StepIcon status={step.status} />
            <span
              className={`flex-1 text-sm font-medium ${
                step.status === "running"
                  ? "text-foreground"
                  : step.status === "completed"
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {step.name}
            </span>
            {(step.status === "running" || step.status === "completed") && (
              <span className="text-xs text-muted-foreground">
                {formatElapsed(step.started_at, step.completed_at)}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
