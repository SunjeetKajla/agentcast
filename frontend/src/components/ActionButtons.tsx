"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

interface ActionButtonsProps {
  videoUrl: string;
  jobId: string;
  onRegenerate?: () => void;
}

export default function ActionButtons({
  videoUrl,
  jobId,
  onRegenerate,
}: ActionButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      // Create a temporary anchor element to trigger download
      const a = document.createElement("a");
      a.href = videoUrl;
      a.download = `agentcast-${jobId}.mp4`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      window.open(videoUrl, "_blank");
    } finally {
      setTimeout(() => setDownloading(false), 1200);
    }
  };

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        prompt("Copy this link:", url);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt("Copy this link:", url);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Download Button */}
      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Button
          onClick={handleDownload}
          disabled={downloading}
          className="gap-2 bg-gradient-to-r from-accent to-purple-500 text-white shadow-lg shadow-accent/20 hover:shadow-accent/40 cursor-pointer"
        >
          {downloading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          )}
          <span>{downloading ? "Starting Download..." : "Download MP4"}</span>
        </Button>
      </motion.div>

      {/* Share Button */}
      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Button
          variant="outline"
          onClick={handleShare}
          className={`gap-2 border-border/80 transition-colors cursor-pointer ${
            copied ? "border-green-500 text-green-400 bg-green-500/10" : "hover:border-accent hover:text-accent"
          }`}
        >
          {copied ? (
            <>
              <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Copied Link!</span>
            </>
          ) : (
            <>
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                />
              </svg>
              <span>Share</span>
            </>
          )}
        </Button>
      </motion.div>

      {/* Regenerate Button */}
      {onRegenerate && (
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button
            variant="secondary"
            onClick={onRegenerate}
            className="gap-2 border border-border/60 bg-muted/60 hover:bg-muted cursor-pointer"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Create Another</span>
          </Button>
        </motion.div>
      )}
    </div>
  );
}
