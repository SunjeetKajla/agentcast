"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full border-t border-border/40 bg-background/95 py-12 text-sm">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
        {/* Brand & Tagline */}
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎬</span>
            <span className="font-bold bg-gradient-to-r from-accent to-purple-400 bg-clip-text text-transparent">
              AgentCast
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            link in. video out. — AI-powered short-form video generation.
          </p>
        </div>

        {/* Hackathon badge */}
        <div className="flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5 text-xs text-accent">
          <span>Built for</span>
          <span className="font-semibold text-foreground">HACKIIIT 🏆</span>
        </div>

        {/* Links */}
        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <a
            href="https://github.com/SunjeetKajla/agentcast"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="hover:text-foreground transition-colors"
          >
            Back to Top ↑
          </button>
        </div>
      </div>
    </footer>
  );
}
