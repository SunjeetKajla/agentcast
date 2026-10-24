"use client";
/* eslint-disable @next/next/no-img-element */

import { motion } from "framer-motion";
import type { Scene } from "@/lib/types";

interface SceneCardProps {
  scene: Scene;
  isActive?: boolean;
  onSeek?: (time: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function SceneCard({ scene, isActive = false, onSeek }: SceneCardProps) {
  return (
    <motion.button
      type="button"
      onClick={() => onSeek?.(scene.start_time)}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={`group w-full text-left rounded-xl border p-4 transition-all cursor-pointer ${
        isActive
          ? "border-accent bg-accent/10 shadow-[0_0_20px_rgba(139,92,246,0.2)] ring-1 ring-accent"
          : "border-border/80 bg-card hover:border-accent/40 hover:bg-card/90"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 space-y-2">
          {/* Header */}
          <div className="flex items-center gap-3">
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                isActive ? "bg-accent text-white" : "bg-muted text-accent"
              }`}
            >
              Scene {scene.scene_number}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatTime(scene.start_time)} – {formatTime(scene.end_time)}
            </span>
            {isActive && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-accent animate-pulse">
                <span>●</span> Playing
              </span>
            )}
          </div>

          {/* Narration */}
          <div className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5 text-base select-none">🎙️</span>
            <p className="leading-relaxed text-foreground/90 font-normal">
              {scene.narration}
            </p>
          </div>

          {/* Visual prompt */}
          <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
            <span className="mt-0.5 text-sm select-none">🖼️</span>
            <p className="italic leading-relaxed">{scene.visual_description}</p>
          </div>
        </div>

        {/* Thumbnail Preview */}
        {scene.thumbnail_url && (
          <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-border/80 bg-muted">
            <img
              src={scene.thumbnail_url}
              alt={`Scene ${scene.scene_number}`}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-white text-xs font-semibold">▶ Seek</span>
            </div>
          </div>
        )}
      </div>
    </motion.button>
  );
}
