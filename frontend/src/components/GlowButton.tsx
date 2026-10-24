"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlowButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export default function GlowButton({
  children,
  className,
  onClick,
  disabled,
  type = "button",
}: GlowButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-purple-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-shadow hover:shadow-accent/40 disabled:opacity-50",
        className
      )}
    >
      {children}
    </motion.button>
  );
}
