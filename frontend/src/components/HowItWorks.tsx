"use client";

import { motion } from "framer-motion";

const steps = [
  {
    icon: "🔗",
    title: "1. Paste SaaS link",
    desc: "Enter your web app or product URL.",
  },
  {
    icon: "🤖",
    title: "2. AI explores product",
    desc: "Autonomous agents discover key user flows.",
  },
  {
    icon: "🎥",
    title: "3. Records demo flows",
    desc: "Captures high-frame-rate browser screencasts.",
  },
  {
    icon: "🎬",
    title: "4. Video rendered",
    desc: "Assembles MP4 with zooms, voiceover & music.",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0 },
};

export default function HowItWorks() {
  return (
    <section className="w-full max-w-5xl space-y-8">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          How it works
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Autonomous multi-step pipeline from web SaaS to ready-to-share video
        </p>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {steps.map((step, i) => (
          <motion.div
            key={step.title}
            variants={item}
            className="group relative flex flex-col items-center rounded-2xl border border-border/80 bg-card/60 p-6 text-center backdrop-blur-md transition-all hover:border-accent/50 hover:bg-card hover:shadow-xl hover:shadow-accent/5"
          >
            {/* Step number badge */}
            <span className="absolute top-3 right-4 font-mono text-[11px] text-muted-foreground/60 font-semibold">
              0{i + 1}
            </span>

            {/* Icon container with glow */}
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/80 bg-gradient-to-br from-muted to-muted/30 text-3xl shadow-inner transition-transform group-hover:scale-110">
              {step.icon}
            </div>

            <h3 className="mb-1 text-sm font-semibold text-foreground">
              {step.title}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {step.desc}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
