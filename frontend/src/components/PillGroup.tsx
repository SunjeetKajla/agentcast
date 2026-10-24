"use client";

import { motion } from "framer-motion";

interface PillGroupProps {
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}

export default function PillGroup({ options, selected, onSelect }: PillGroupProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onSelect(option)}
          className="relative rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
        >
          {selected === option && (
            <motion.span
              layoutId="pill-highlight"
              className="absolute inset-0 rounded-md bg-accent"
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          <span
            className={`relative z-10 ${
              selected === option ? "text-white" : "text-muted-foreground"
            }`}
          >
            {option}
          </span>
        </button>
      ))}
    </div>
  );
}
