"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import CardboardInput from "@/components/CardboardInput";
import FloatingPreviewCards from "@/components/FloatingPreviewCards";
import TimelineRuler from "@/components/TimelineRuler";
import HowItWorks from "@/components/HowItWorks";
import VideoCard from "@/components/VideoCard";
import { generateVideo, getJobs } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
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
      const { job_id } = await generateVideo(url, "16:9", "explainer");
      router.push(`/generate/${job_id}`);
    } catch (err) {
      console.error(err);
      alert("Failed to start generation. Please check the URL and try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex w-full flex-col items-center">
      {/* ── Hero Section (Cardboard Aesthetic) ── */}
      <section className="relative flex min-h-[calc(100vh-4rem)] w-full flex-col items-center justify-center px-6 py-20 text-center">
        {/* Floating 3D Cards Framing the Hero */}
        <FloatingPreviewCards />

        {/* Central Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center gap-6"
        >
          {/* Headline in Editorial Serif */}
          <h1 className="font-serif text-5xl sm:text-7xl lg:text-8xl font-normal tracking-tight text-white leading-[1.08] drop-shadow-lg">
            link in. <span className="italic font-light">video out.</span>
          </h1>

          {/* Subtitle */}
          <p className="max-w-xl text-sm sm:text-base text-white/60 font-sans tracking-wide">
            Turn your web SaaS into a polished, high-impact demo video in seconds.
          </p>

          {/* Cardboard Chatbar Input */}
          <div id="hero-input" className="w-full pt-4">
            <CardboardInput onSubmit={handleGenerate} isLoading={isLoading} />
          </div>
        </motion.div>

        {/* Timeline tick ruler at bottom of hero */}
        <div className="absolute inset-x-0 bottom-2">
          <TimelineRuler />
        </div>
      </section>

      {/* ── Content Sections ── */}
      <div className="w-full max-w-6xl space-y-28 px-6 py-20">
        {/* How It Works */}
        <div id="how-it-works" className="w-full flex justify-center">
          <HowItWorks />
        </div>

        {/* Showcase / Recent Generations */}
        {recentJobs.length > 0 && (
          <section id="showcase" className="w-full space-y-8">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <div>
                <h2 className="font-serif text-3xl font-normal text-white">
                  Featured Product Videos
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  Autonomous screencast recordings and launch videos generated from live products
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-xs text-white/60">
                {recentJobs.length} videos
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {recentJobs.map((job) => (
                <VideoCard key={job.job_id} job={job} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
