"use client";

import { useEffect, useRef } from "react";

export default function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.75; // subtle cinematic slow-motion
    }
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#050505]">
      {/* Ambient Video with low opacity */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        className="h-full w-full object-cover opacity-15 filter contrast-125 brightness-75 saturate-50"
      >
        <source src="/hero-bg.mp4" type="video/mp4" />
        <source
          src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
          type="video/mp4"
        />
      </video>

      {/* Dark overlay so bright video frames never overpower the UI */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Fade from the bottom mask - dissolves into deep dark background */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/80 to-transparent" />

      {/* Radial soft vignette overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#050505_85%)]" />

      {/* Subtle top header gradient */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#050505]/80 to-transparent" />
    </div>
  );
}
