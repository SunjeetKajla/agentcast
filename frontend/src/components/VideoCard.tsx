"use client";
/* eslint-disable @next/next/no-img-element */

import { motion } from "framer-motion";
import Link from "next/link";
import type { Job } from "@/lib/types";

interface VideoCardProps {
  job: Job;
}

export default function VideoCard({ job }: VideoCardProps) {
  let fallbackTitle = "Untitled Video";
  try {
    fallbackTitle = new URL(job.url).hostname;
  } catch {}
  const title = job.title || fallbackTitle;
  const duration = job.duration
    ? `${Math.floor(job.duration / 60)}:${String(job.duration % 60).padStart(2, "0")}`
    : "--:--";

  return (
    <Link href={`/video/${job.job_id}`} className="block">
      <motion.div
        whileHover={{ y: -6, boxShadow: "0 16px 40px rgba(139,92,246,0.25)" }}
        transition={{ type: "spring", stiffness: 350, damping: 22 }}
        className="group cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/80 transition-colors hover:border-white/20"
      >
        {/* Thumbnail container */}
        <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-white/5 to-black">
          {job.thumbnail_url ? (
            <img
              src={job.thumbnail_url}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 filter brightness-85"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl select-none">
              🎬
            </div>
          )}

          {/* Dark gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

          {/* Format badge on thumbnail */}
          <div className="absolute top-3 right-3">
            <span className="rounded-md bg-black/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-white/90 backdrop-blur-md border border-white/10">
              {job.format}
            </span>
          </div>

          {/* Duration tag on thumbnail */}
          <div className="absolute bottom-3 right-3">
            <span className="rounded-md bg-black/90 px-2 py-0.5 font-mono text-[11px] text-white/90 backdrop-blur-md">
              {duration}
            </span>
          </div>

          {/* Centered play icon on hover */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-xl transition-transform group-hover:scale-110">
              <svg className="h-5 w-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="p-4 space-y-1.5">
          <h3 className="line-clamp-1 text-sm font-semibold text-white group-hover:text-white/80 transition-colors">
            {title}
          </h3>
          <div className="flex items-center justify-between text-xs text-white/50">
            <span className="capitalize">{job.style}</span>
            <span className="text-[11px] text-white/40">
              {new Date(job.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
