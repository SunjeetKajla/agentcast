"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import LinkInput from "@/components/LinkInput";
import FormatToggle from "@/components/FormatToggle";
import StyleToggle from "@/components/StyleToggle";
import HowItWorks from "@/components/HowItWorks";
import VideoCard from "@/components/VideoCard";
import { generateVideo, getJobs } from "@/lib/api";
import type { VideoFormat, VideoStyle, Job } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const [format, setFormat] = useState<VideoFormat>("9:16");
  const [style, setStyle] = useState<VideoStyle>("explainer");
  const [isLoading, setIsLoading] = useState(false);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);

  useEffect(() => {
    getJobs()
      .then((jobs) => {
        const completed = jobs.filter((j) => j.status === "completed");
        setRecentJobs(completed.slice(0, 6));
      })
      .catch(() => {});
  }, []);

  const handleGenerate = async (url: string) => {
    setIsLoading(true);
    try {
      const { job_id } = await generateVideo(url, format, style);
      router.push(`/generate/${job_id}`);
    } catch (err) {
      console.error(err);
      alert("Failed to start generation. Please check the URL and try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-24 px-6 py-16 sm:py-24">
      {/* ── Hero Section ── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative flex w-full max-w-4xl flex-col items-center gap-8 text-center"
      >
        {/* Ambient violet radial glow */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-accent/20 blur-[140px]" />

        {/* Small badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1 text-xs font-semibold text-accent backdrop-blur-md">
          <span>✦</span>
          <span>Autonomous AI Video Engine</span>
        </div>

        {/* Hero headline */}
        <h1 className="text-5xl font-black tracking-tight sm:text-7xl lg:text-8xl">
          <span className="bg-gradient-to-r from-accent via-purple-300 to-accent bg-clip-text text-transparent">
            link in.
          </span>{" "}
          <span className="text-foreground">video out.</span>
        </h1>

        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          Turn any article, blog post, or doc into a high-impact, short-form video — with AI narration, scenes, and subtitles in seconds.
        </p>

        {/* URL Input Form */}
        <LinkInput onSubmit={handleGenerate} isLoading={isLoading} />

        {/* Format & Style Pill Selectors */}
        <div className="flex flex-wrap items-center justify-center gap-6 pt-2">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              Format:
            </span>
            <FormatToggle selected={format} onSelect={setFormat} />
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              Style:
            </span>
            <StyleToggle selected={style} onSelect={setStyle} />
          </div>
        </div>
      </motion.section>

      {/* ── How It Works ── */}
      <HowItWorks />

      {/* ── Recent Generations ── */}
      {recentJobs.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-5xl space-y-6"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Recent generations
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Explore videos generated from web articles and research papers
              </p>
            </div>
            <span className="rounded-full bg-muted/60 px-3 py-1 font-mono text-xs text-muted-foreground">
              {recentJobs.length} videos
            </span>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {recentJobs.map((job) => (
              <VideoCard key={job.job_id} job={job} />
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}
