"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Scene } from "@/lib/types";

interface ScriptPreviewProps {
  scenes: Scene[];
}

export default function ScriptPreview({ scenes }: ScriptPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          📝 Script Preview
        </span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-muted-foreground"
        >
          ▾
        </motion.span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-border px-5 py-4">
              {scenes.map((scene) => (
                <div
                  key={scene.scene_number}
                  className="rounded-md bg-muted/50 p-3"
                >
                  <p className="mb-1 text-xs font-semibold text-accent">
                    Scene {scene.scene_number}
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {scene.narration}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
