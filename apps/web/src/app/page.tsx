"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Job } from "@agentcast/shared";
import CardboardInput from "@/components/CardboardInput";
import FloatingPreviewCards from "@/components/FloatingPreviewCards";
import TimelineRuler from "@/components/TimelineRuler";
import HowItWorks from "@/components/HowItWorks";
import Features from "@/components/Features";
import VideoCard from "@/components/VideoCard";
import { ApiError, createJob, listJobs } from "@/lib/api";
import { toJobConfig, type ComposerChoices } from "@/lib/compose";
import { DUR, EASE, MOTION_OK, gsap, useGSAP, useReveal, settle } from "@/lib/motion";

export default function HomePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const hero = useRef<HTMLElement>(null);
  const showcase = useRef<HTMLElement>(null);

  useEffect(() => {
    listJobs()
      .then((jobs) => setRecentJobs(jobs.filter((j) => j.status === "done").slice(0, 6)))
      .catch(() => {});
  }, []);

  // Hero load sequence: the headline's lines rise out of their masks, then the sentence, the composer
  // and the example prompts. Over in about 1.2 s; nothing waits for the load event.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({ defaults: { ease: EASE.expo } });
        tl.set("[data-hero]", { visibility: "visible" })
          .fromTo("[data-hero-line]", ...settle({ yPercent: 110, duration: 1, stagger: 0.09 }))
          .fromTo("[data-hero-sub]", ...settle({ autoAlpha: 0, y: 16, duration: DUR.reveal }), 0.35)
          .fromTo("[data-hero-input]", ...settle({ autoAlpha: 0, y: 24, duration: DUR.reveal }), 0.45)
          .fromTo("[data-hero-pill]", ...settle({ autoAlpha: 0, y: 10, duration: 0.5, stagger: 0.05, ease: EASE.out }), 0.7);
      });
      return () => mm.revert();
    },
    { scope: hero },
  );
  useReveal(showcase, [recentJobs.length]);

  const handleGenerate = async (url: string, prompt: string, choices: ComposerChoices) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const job = await createJob(toJobConfig(url, prompt, choices));
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the job. Try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex w-full flex-col items-center">
      {/* ── Hero ── */}
      <section
        ref={hero}
        className="relative flex min-h-[calc(100vh-4rem)] w-full flex-col items-center justify-center px-6 py-20 text-center"
      >
        <FloatingPreviewCards />

        <div className="relative z-30 mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
          <h1
            data-hero
            className="font-serif text-5xl sm:text-7xl lg:text-8xl font-normal tracking-tight text-white leading-[1.08] drop-shadow-2xl"
          >
            <span className="line-mask">
              <span data-hero-line className="inline-block">
                link in. <span className="italic font-light">video out.</span>
              </span>
            </span>
          </h1>

          <p data-hero data-hero-sub className="max-w-xl text-sm sm:text-base text-white/70 font-sans tracking-wide">
            Paste your product&apos;s link. Web agents explore it, film the flows worth showing, and cut a
            narrated demo video.
          </p>

          <div id="hero-input" data-hero data-hero-input className="w-full scroll-mt-32 pt-4">
            <CardboardInput onSubmit={handleGenerate} isLoading={isLoading} error={error} />
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-2 z-20">
          <TimelineRuler />
        </div>
      </section>

      {/* ── Content ── */}
      <div className="relative z-20 w-full max-w-6xl space-y-40 px-6 py-24">
        <div id="how-it-works" className="w-full scroll-mt-24">
          <HowItWorks />
        </div>

        <div id="features" className="w-full scroll-mt-24">
          <Features />
        </div>

        <section ref={showcase} id="showcase" className="w-full scroll-mt-24 space-y-8">
          <div data-reveal className="flex items-end justify-between border-b border-white/[0.08] pb-4">
            <div>
              <h2 className="font-serif text-3xl font-normal text-white">Made with AgentCast</h2>
              <p className="mt-1 text-sm text-white/50">
                Finished videos from this worker, recorded from the real products.
              </p>
            </div>
            <Link href="/jobs" className="text-xs text-white/60 transition-colors hover:text-white">
              All videos →
            </Link>
          </div>

          {recentJobs.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {recentJobs.map((job) => (
                <div key={job.id} data-reveal>
                  <VideoCard job={job} />
                </div>
              ))}
            </div>
          ) : (
            <div data-reveal className="rounded-2xl border border-white/10 bg-[#121215]/60 p-10 text-center">
              <p className="font-serif text-2xl text-white">Your first video will show up here.</p>
              <p className="mt-2 text-sm text-white/50">
                Paste a link above. Finished videos from this machine&apos;s worker are listed as they render.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
