"use client";

import { motion } from "framer-motion";
import type { VideoFormat } from "@/lib/types";

interface FormatToggleProps {
  selected: VideoFormat;
  onSelect: (value: VideoFormat) => void;
}

const formats: VideoFormat[] = ["9:16", "16:9", "1:1"];

export default function FormatToggle({ selected, onSelect }: FormatToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {formats.map((fmt) => (
        <button
          key={fmt}
          onClick={() => onSelect(fmt)}
          className="relative rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
        >
          {selected === fmt && (
            <motion.span
              layoutId="format-pill"
              className="absolute inset-0 rounded-md bg-accent"
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          <span
            className={`relative z-10 ${
              selected === fmt ? "text-white" : "text-muted-foreground"
            }`}
          >
            {fmt}
          </span>
        </button>
      ))}
    </div>
  );
}
