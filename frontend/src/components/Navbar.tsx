"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 flex w-full justify-center pointer-events-none">
      <nav
        className={`pointer-events-auto flex items-center justify-between transition-all duration-300 ease-out ${
          isScrolled
            ? "translate-y-3 w-[calc(100%-2rem)] max-w-5xl h-14 rounded-full border border-white/15 bg-[#0a0a0d]/85 px-6 shadow-[0_16px_36px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
            : "translate-y-0 w-full h-16 rounded-none border-b border-white/[0.06] bg-[#050505]/80 px-6 sm:px-8 backdrop-blur-xl"
        }`}
      >
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

          <Link href="/" className="flex items-center gap-2.5 text-base font-medium tracking-tight text-white group">
            <span className="text-xl transition-transform duration-300 group-hover:scale-110">🎬</span>
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
        <div className="flex items-center gap-3 sm:gap-4">
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
            className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-all hover:bg-white/90 shadow-sm cursor-pointer hover:shadow-[0_0_15px_rgba(255,255,255,0.3)]"
          >
            Get started
          </button>
        </div>
      </nav>
    </header>
  );
}
