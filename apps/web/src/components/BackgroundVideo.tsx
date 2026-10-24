"use client";

export default function BackgroundVideo() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#050505]">
      {/* Ambient background lighting — video temporarily removed per user request */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(120,119,198,0.06),transparent_100%)]" />

      {/* Radial soft vignette overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#050505_85%)]" />

      {/* Subtle top header gradient */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#050505]/80 to-transparent" />
    </div>
  );
}
