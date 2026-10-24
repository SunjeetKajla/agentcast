"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { VideoMode } from "@agentcast/shared";
import { DEFAULT_CHOICES, parseComposer, readBack, type ComposerChoices } from "@/lib/compose";

interface CardboardInputProps {
  onSubmit: (url: string, prompt: string, choices: ComposerChoices) => void;
  isLoading?: boolean;
  error?: string;
}

/** Example video prompts (PRD FR-5); each also picks the mode it implies. */
const PRESETS: { label: string; prompt: string; mode: VideoMode }[] = [
  { label: "Product Hunt launch", prompt: "Punchy Product Hunt launch, 30 s", mode: "launch" },
  { label: "Calm & premium", prompt: "Calm and premium, 60 s, for enterprise buyers", mode: "launch" },
  { label: "Step-by-step tutorial", prompt: "Step-by-step tutorial, slow and clear", mode: "tutorial" },
  { label: "Sales demo", prompt: "Sales demo that shows the analytics", mode: "sales" },
];

const MODES: { mode: VideoMode; label: string }[] = [
  { mode: "launch", label: "Launch" },
  { mode: "tutorial", label: "Tutorial" },
  { mode: "sales", label: "Sales" },
];

const pill = (on: boolean) =>
  `flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
    on
      ? "border-white/20 bg-white/15 text-white"
      : "border-white/10 bg-white/[0.05] text-white/60 hover:bg-white/10 hover:text-white"
  }`;

function toggle<T>(list: T[], value: T): T[] {
  if (!list.includes(value)) return [...list, value];
  return list.length > 1 ? list.filter((v) => v !== value) : list;
}

export default function CardboardInput({ onSubmit, isLoading = false, error }: CardboardInputProps) {
  const [input, setInput] = useState("");
  const [choices, setChoices] = useState<ComposerChoices>(DEFAULT_CHOICES);
  const [selectedPreset, setSelectedPreset] = useState<string>();
  const { url, prompt } = useMemo(() => parseComposer(input), [input]);
  const set = (patch: Partial<ComposerChoices>) => setChoices((c) => ({ ...c, ...patch }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url && !isLoading) onSubmit(url, prompt, choices);
  };

  const cycleMode = () => {
    const i = MODES.findIndex((m) => m.mode === choices.mode);
    set({ mode: MODES[(i + 1) % MODES.length]!.mode });
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setSelectedPreset(preset.label);
    set({ mode: preset.mode });
    // Keep the link, replace the description.
    setInput(url ? `${url} ${preset.prompt}` : `${preset.prompt} `);
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-4">
      <form onSubmit={handleSubmit}>
        <motion.div
          whileHover={{ borderColor: "rgba(255, 255, 255, 0.16)" }}
          className="relative rounded-2xl border border-white/10 bg-[#121215]/80 p-4 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] transition-all focus-within:border-white/25 focus-within:shadow-[0_20px_70px_rgba(0,0,0,0.9)]"
        >
          <label htmlFor="composer" className="sr-only">
            Your product&apos;s URL and what kind of video you want
          </label>
          <textarea
            id="composer"
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

          {/* Bottom bar: the job's options, then send */}
          <div className="mt-2 flex items-end justify-between gap-3 pt-2 border-t border-white/[0.04]">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={cycleMode} className={pill(true)} title="Video type">
                <span className="text-white/50">+</span>
                <span>{MODES.find((m) => m.mode === choices.mode)!.label}</span>
                <span className="text-[10px] text-white/40">▾</span>
              </button>
              {(["16x9", "9x16"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={choices.aspects.includes(a)}
                  onClick={() => set({ aspects: toggle(choices.aspects, a) })}
                  className={pill(choices.aspects.includes(a))}
                >
                  {a === "16x9" ? "16:9" : "9:16"}
                </button>
              ))}
              {(["en", "hi"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={choices.langs.includes(l)}
                  onClick={() => set({ langs: toggle(choices.langs, l) })}
                  className={pill(choices.langs.includes(l))}
                >
                  {l === "en" ? "English" : "हिन्दी"}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={choices.voiceover}
                onClick={() => set({ voiceover: !choices.voiceover })}
                className={pill(choices.voiceover)}
                title="Voiceover: a narrator reads the script. Off: a silent video with the script as captions"
              >
                {choices.voiceover ? "Voiceover" : "No voiceover"}
              </button>
              <button
                type="button"
                aria-pressed={choices.auth === "sign-in-once"}
                onClick={() => set({ auth: choices.auth === "public" ? "sign-in-once" : "public" })}
                className={pill(choices.auth === "sign-in-once")}
                title="Sign in once: a Chrome window opens on the worker so you can log in yourself"
              >
                {choices.auth === "public" ? "Public site" : "Sign in once"}
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                aria-pressed={choices.autopilot}
                onClick={() => set({ autopilot: !choices.autopilot })}
                title="Autopilot: approve the flows, script and preview automatically"
                className={`text-xs transition-colors select-none cursor-pointer ${
                  choices.autopilot ? "text-accent" : "text-white/40 hover:text-white/80"
                }`}
              >
                ✦{choices.autopilot && <span className="ml-1">Autopilot</span>}
              </button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="submit"
                disabled={isLoading || !url}
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 10l7-7m0 0l7 7m-7-7v18"
                    />
                  </svg>
                )}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </form>

      {/* The plan, read back (PRD §5.1), or what's missing */}
      <p className="min-h-[1.25rem] text-xs text-white/50" aria-live="polite">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : url ? (
          <>
            <span className="text-white/80">{new URL(url).hostname}</span> · {readBack(choices, prompt)}
          </>
        ) : input.trim() ? (
          "Add your product's link, like linear.app, to start."
        ) : null}
      </p>

      {/* Example prompts */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {PRESETS.map((preset) => {
          const isActive = selectedPreset === preset.label;
          return (
            <button
              key={preset.label}
              type="button"
              data-hero-pill
              onClick={() => applyPreset(preset)}
              className={`rounded-full px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-white/15 text-white border border-white/20 shadow-sm"
                  : "bg-white/[0.04] text-white/60 border border-white/[0.07] hover:bg-white/[0.09] hover:text-white"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
