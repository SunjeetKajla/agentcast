"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";

interface LinkInputProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
}

const SAMPLE_LINKS = [
  {
    label: "⚡ Quantum Computing",
    url: "https://nature.com/articles/quantum-computing-frontier",
  },
  {
    label: "🦀 Why Rust Wins",
    url: "https://blog.rust-lang.org/2026/future-of-memory-safety",
  },
  {
    label: "🤖 AI Agents in 2026",
    url: "https://techcrunch.com/2026/02/ai-agents-orchestration",
  },
];

export default function LinkInput({ onSubmit, isLoading = false }: LinkInputProps) {
  const [url, setUrl] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  };

  const handleSelectSample = (sampleUrl: string) => {
    setUrl(sampleUrl);
  };

  return (
    <div className="w-full max-w-2xl space-y-3">
      <form onSubmit={handleSubmit} className="w-full">
        <motion.div
          className={`relative flex items-center rounded-2xl border-2 bg-card p-1.5 transition-all ${
            isFocused ? "border-accent shadow-[0_0_35px_rgba(139,92,246,0.35)]" : "border-border hover:border-border/80"
          }`}
          animate={
            isFocused
              ? { scale: 1.01 }
              : { scale: 1 }
          }
          transition={{ duration: 0.2 }}
        >
          <span className="pl-4 text-xl text-muted-foreground select-none">🔗</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Paste any article, blog, or documentation link..."
            className="flex-1 bg-transparent px-3 py-3.5 text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            required
          />

          {url && (
            <button
              type="button"
              onClick={() => setUrl("")}
              className="px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Clear input"
            >
              ✕
            </button>
          )}

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            type="submit"
            disabled={isLoading || !url.trim()}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-purple-500 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:shadow-accent/40 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {isLoading ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
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
                <span>Generating…</span>
              </>
            ) : (
              <>
                <span>Generate</span>
                <span>▶</span>
              </>
            )}
          </motion.button>
        </motion.div>
      </form>

      {/* Quick try samples */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
        <span className="font-medium">Try an example:</span>
        {SAMPLE_LINKS.map((sample) => (
          <button
            key={sample.label}
            type="button"
            onClick={() => handleSelectSample(sample.url)}
            className="rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:bg-accent/10 hover:text-foreground cursor-pointer"
          >
            {sample.label}
          </button>
        ))}
      </div>
    </div>
  );
}
