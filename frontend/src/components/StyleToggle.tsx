"use client";

import { motion } from "framer-motion";
import type { VideoStyle } from "@/lib/types";

interface StyleToggleProps {
  selected: VideoStyle;
  onSelect: (value: VideoStyle) => void;
}

const styles: { label: string; value: VideoStyle }[] = [
  { label: "Explainer", value: "explainer" },
  { label: "Podcast", value: "podcast" },
  { label: "News Bite", value: "news_bite" },
];

export default function StyleToggle({ selected, onSelect }: StyleToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {styles.map((s) => (
        <button
          key={s.value}
          onClick={() => onSelect(s.value)}
          className="relative rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
        >
          {selected === s.value && (
            <motion.span
              layoutId="style-pill"
              className="absolute inset-0 rounded-md bg-accent"
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          <span
            className={`relative z-10 ${
              selected === s.value ? "text-white" : "text-muted-foreground"
            }`}
          >
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}
