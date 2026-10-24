"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";

interface CardboardInputProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
}

const PRESET_PILLS = [
  "Launch Video",
  "Product Demo",
  "Explainer",
  "Feature Tour",
  "Onboarding",
];

export default function CardboardInput({ onSubmit, isLoading = false }: CardboardInputProps) {
  const [input, setInput] = useState("");
  const [selectedPill, setSelectedPill] = useState("Launch Video");
  const [mode, setMode] = useState("Auto");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSubmit(input.trim());
    }
  };

  const cycleMode = () => {
    const modes = ["Auto", "Launch", "Tutorial", "Sales"];
    const idx = (modes.indexOf(mode) + 1) % modes.length;
    setMode(modes[idx]);
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-4">
      <form onSubmit={handleSubmit}>
        <motion.div
          whileHover={{ borderColor: "rgba(255, 255, 255, 0.16)" }}
          className="relative rounded-2xl border border-white/10 bg-[#121215]/80 p-4 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] transition-all focus-within:border-white/25 focus-within:shadow-[0_20px_70px_rgba(0,0,0,0.9)]"
        >
          {/* Main Input Text */}
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your web SaaS URL, or describe your video..."
            className="w-full resize-none bg-transparent text-sm sm:text-base text-white placeholder:text-white/40 focus:outline-none leading-relaxed"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />

          {/* Bottom Bar: Mode Selector & Submit Button */}
          <div className="mt-2 flex items-center justify-between pt-2 border-t border-white/[0.04]">
            {/* Mode dropdown pill */}
            <button
              type="button"
              onClick={cycleMode}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <span className="text-white/50">+</span>
              <span>{mode}</span>
              <span className="text-[10px] text-white/40">▾</span>
            </button>

            {/* Sparkle & Action Arrow */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/40 hover:text-white/80 transition-colors select-none cursor-pointer">
                ✦
              </span>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-opacity hover:bg-white/90 disabled:opacity-20 cursor-pointer shadow-md"
                aria-label="Generate video"
              >
                {isLoading ? (
                  <svg className="h-4 w-4 animate-spin text-black" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                )}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </form>

      {/* Preset pills row */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {PRESET_PILLS.map((pill) => {
          const isActive = selectedPill === pill;
          return (
            <button
              key={pill}
              type="button"
              onClick={() => setSelectedPill(pill)}
              className={`rounded-full px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-white/15 text-white border border-white/20 shadow-sm"
                  : "bg-white/[0.04] text-white/60 border border-white/[0.07] hover:bg-white/[0.09] hover:text-white"
              }`}
            >
              {pill}
            </button>
          );
        })}
      </div>
    </div>
  );
}
