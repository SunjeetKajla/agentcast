"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full border-t border-white/[0.05] bg-[#050505]/95 py-12 text-xs">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row sm:px-8">
        {/* Brand */}
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="AgentCast" className="h-4 w-4 rounded object-contain" />
            <span className="font-serif italic font-medium text-white text-sm">
              AgentCast
            </span>
          </div>
          <p className="text-[11px] text-white/40">
            link in. video out. — Autonomous AI SaaS demo video suite.
          </p>
        </div>

        {/* Hackathon badge */}
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-[11px] text-white/60">
          <span>Built for</span>
          <span className="font-medium text-white">HACKIIIT 🏆</span>
        </div>

        {/* Links */}
        <div className="flex items-center gap-6 text-[11px] text-white/50">
          <Link href="/" className="hover:text-white transition-colors">
            Home
          </Link>
          <a
            href="https://github.com/SunjeetKajla/agentcast"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            GitHub
          </a>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="hover:text-white transition-colors cursor-pointer"
          >
            Back to Top ↑
          </button>
        </div>
      </div>
    </footer>
  );
}
