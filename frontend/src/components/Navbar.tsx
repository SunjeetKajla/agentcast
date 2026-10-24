"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-[#050505]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-8">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          {!isHome && (
            <Link
              href="/"
              className="mr-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span>←</span>
              <span>Home</span>
            </Link>
          )}

          <Link href="/" className="flex items-center gap-2.5 text-base font-medium tracking-tight text-white">
            <span className="text-xl">🎬</span>
            <span className="font-semibold tracking-tight text-white font-serif italic text-lg">
              AgentCast
            </span>
          </Link>
        </div>

        {/* Center: Navigation Links */}
        <div className="hidden md:flex items-center gap-8 text-xs font-medium text-white/60">
          <Link href="#features" className="hover:text-white transition-colors">
            Features
          </Link>
          <Link href="#how-it-works" className="hover:text-white transition-colors">
            How it works
          </Link>
          <Link href="#showcase" className="hover:text-white transition-colors">
            Showcase
          </Link>
          <Link href="#pricing" className="hover:text-white transition-colors">
            Pricing
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="text-xs font-medium text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("hero-input");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
            className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-all hover:bg-white/90 shadow-sm cursor-pointer"
          >
            Get started
          </button>
        </div>
      </div>
    </nav>
  );
}
