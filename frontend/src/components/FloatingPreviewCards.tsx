/* eslint-disable @next/next/no-img-element */
"use client";

import { motion } from "framer-motion";

export default function FloatingPreviewCards() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden lg:block select-none">
      {/* 1. Top-Left Floating Card (Vertical) */}
      <motion.div
        initial={{ opacity: 0, y: -20, rotate: -14 }}
        animate={{ opacity: 1, y: [0, -12, 0], rotate: -12 }}
        transition={{
          opacity: { duration: 1 },
          y: { duration: 7, repeat: Infinity, ease: "easeInOut" },
        }}
        className="pointer-events-auto absolute left-[10%] top-[12%] w-44 h-64 overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/60 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md transition-transform duration-500 hover:rotate-0 hover:scale-105"
      >
        <img
          src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=600&auto=format&fit=crop"
          alt="Card 1"
          className="h-full w-full object-cover filter brightness-75 contrast-125"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      </motion.div>

      {/* 2. Middle-Left Floating Card (Horizontal) */}
      <motion.div
        initial={{ opacity: 0, x: -30, rotate: -9 }}
        animate={{ opacity: 1, y: [0, 10, 0], rotate: -7 }}
        transition={{
          opacity: { duration: 1, delay: 0.2 },
          y: { duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 },
        }}
        className="pointer-events-auto absolute left-[4%] top-[38%] w-60 h-36 overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/60 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md transition-transform duration-500 hover:rotate-0 hover:scale-105"
      >
        <img
          src="https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=600&auto=format&fit=crop"
          alt="Card 2"
          className="h-full w-full object-cover filter brightness-75 contrast-125"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      </motion.div>

      {/* 3. Bottom-Left Floating Card (Vertical Portrait) */}
      <motion.div
        initial={{ opacity: 0, y: 30, rotate: 6 }}
        animate={{ opacity: 1, y: [0, -8, 0], rotate: 4 }}
        transition={{
          opacity: { duration: 1, delay: 0.4 },
          y: { duration: 8, repeat: Infinity, ease: "easeInOut", delay: 0.5 },
        }}
        className="pointer-events-auto absolute left-[12%] bottom-[12%] w-40 h-56 overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/60 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md transition-transform duration-500 hover:rotate-0 hover:scale-105"
      >
        <img
          src="https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?q=80&w=600&auto=format&fit=crop"
          alt="Card 3"
          className="h-full w-full object-cover filter brightness-75 contrast-125"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      </motion.div>

      {/* 4. Top-Right Floating Card (Vertical Document/Code) */}
      <motion.div
        initial={{ opacity: 0, y: -20, rotate: 14 }}
        animate={{ opacity: 1, y: [0, 12, 0], rotate: 12 }}
        transition={{
          opacity: { duration: 1, delay: 0.3 },
          y: { duration: 7.5, repeat: Infinity, ease: "easeInOut", delay: 1.5 },
        }}
        className="pointer-events-auto absolute right-[10%] top-[14%] w-44 h-64 overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/60 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md transition-transform duration-500 hover:rotate-0 hover:scale-105"
      >
        <img
          src="https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=600&auto=format&fit=crop"
          alt="Card 4"
          className="h-full w-full object-cover filter brightness-75 contrast-125"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      </motion.div>

      {/* 5. Bottom-Right Floating Card (Horizontal Video Frame) */}
      <motion.div
        initial={{ opacity: 0, x: 30, rotate: -8 }}
        animate={{ opacity: 1, y: [0, -10, 0], rotate: -6 }}
        transition={{
          opacity: { duration: 1, delay: 0.5 },
          y: { duration: 6.5, repeat: Infinity, ease: "easeInOut", delay: 2 },
        }}
        className="pointer-events-auto absolute right-[8%] bottom-[16%] w-64 h-40 overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/60 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md transition-transform duration-500 hover:rotate-0 hover:scale-105"
      >
        <img
          src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=600&auto=format&fit=crop"
          alt="Card 5"
          className="h-full w-full object-cover filter brightness-75 contrast-125"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      </motion.div>
    </div>
  );
}
