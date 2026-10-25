"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { variantMatrix, jobPaths, type Job } from "@agentcast/shared";
import { fileUrl } from "@/lib/api";

const MODE_LABEL = { launch: "Launch video", tutorial: "Tutorial", sales: "Sales demo" } as const;

/** A finished job: its first rendered variant plays silently on hover. */
export default function VideoCard({ job }: { job: Job }) {
  const video = useRef<HTMLVideoElement>(null);
  const variant = variantMatrix(job.config.variants)[0];
  const host = new URL(job.config.url).hostname.replace(/^www\./, "");

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="block"
      onMouseEnter={() => video.current?.play().catch(() => {})}
      onMouseLeave={() => video.current?.pause()}
    >
      <motion.div
        whileHover={{ y: -6, boxShadow: "0 16px 40px rgba(56,189,248,0.25)" }}
        transition={{ type: "spring", stiffness: 350, damping: 22 }}
        className="group cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/80 transition-colors hover:border-white/20"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-white/5 to-black">
          {variant && (
            <video
              ref={video}
              src={`${fileUrl(job.id, jobPaths.output(variant.id, "mp4"))}#t=0.5`}
              muted
              loop
              playsInline
              preload="metadata"
              className={`h-full w-full transition-transform duration-500 group-hover:scale-105 ${
                variant.aspect === "9x16" ? "object-contain" : "object-cover"
              }`}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute top-3 right-3">
            <span className="rounded-md bg-black/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-white/90 backdrop-blur-md border border-white/10">
              {job.config.variants.aspects.map((a) => a.replace("x", ":")).join(" · ")}
            </span>
          </div>
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-xl transition-transform group-hover:scale-110">
              <svg className="h-5 w-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-1.5">
          <h3 className="line-clamp-1 text-sm font-semibold text-white group-hover:text-white/80 transition-colors">{host}</h3>
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>
              {MODE_LABEL[job.config.mode]} · {job.config.variants.langs.join(", ").toUpperCase()}
            </span>
            <span className="text-[11px] text-white/40">{new Date(job.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
