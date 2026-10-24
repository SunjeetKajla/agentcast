"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Script, jobPaths, variantMatrix, type Job } from "@agentcast/shared";
import VideoPlayer from "@/components/VideoPlayer";
import { fileUrl } from "@/lib/api";
import { useArtifact } from "@/lib/useArtifact";
import { useReveal } from "@/lib/motion";

// The finished videos (PRD §5.1 step 7): every variant the job asked for, with downloads and the copy
// to post them with.

const LANG_NAME: Record<string, string> = { en: "English", hi: "Hindi" };

export default function Outputs({ job, versions }: { job: Job; versions: Record<string, number> }) {
  const variants = variantMatrix(job.config.variants);
  const lang = job.config.variants.langs[0] ?? "en";
  const script = useArtifact(job.id, jobPaths.script(lang), Script, versions[jobPaths.script(lang)]);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLElement>(null);
  useReveal(root, [variants.length, Boolean(script.data)]);

  const posting = script.data?.posting;
  const copyText = posting ? `${posting.title}\n\n${posting.description}\n\n${posting.hashtags.join(" ")}` : "";
  const wide = variants.filter((v) => v.aspect === "16x9");
  const tall = variants.filter((v) => v.aspect === "9x16");

  return (
    <section ref={root} className="space-y-10" aria-labelledby="outputs-title">
      <div data-reveal className="space-y-1">
        <h2 id="outputs-title" className="font-serif text-3xl text-white">
          Your videos are ready
        </h2>
        <p className="text-sm text-white/60">
          {variants.length} video{variants.length === 1 ? "" : "s"}, each timed to its own voiceover.
        </p>
      </div>

      {[wide, tall].map((group) =>
        group.length ? (
          <div key={group[0]!.aspect} className={`grid gap-6 ${group[0]!.aspect === "16x9" ? "lg:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
            {group.map((v) => {
              const src = fileUrl(job.id, jobPaths.output(v.id, "mp4"), versions[jobPaths.output(v.id, "mp4")]);
              return (
                <figure key={v.id} data-reveal className="space-y-3">
                  <VideoPlayer src={src} format={v.aspect === "16x9" ? "16:9" : "9:16"} />
                  <figcaption className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-white/80">
                      {v.aspect === "16x9" ? "16:9" : "9:16"} · {LANG_NAME[v.lang] ?? v.lang}
                      {v.source === "mobile" && " · mobile"}
                    </span>
                    <a
                      href={src}
                      download={`${new URL(job.config.url).hostname}-${v.id}.mp4`}
                      className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs text-white transition-colors hover:bg-white/10"
                    >
                      Download MP4
                    </a>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        ) : null,
      )}

      {posting && (
        <div data-reveal className="rounded-2xl border border-white/10 bg-[#121215]/80 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-white">Post it with</h3>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(copyText).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs text-white transition-colors hover:bg-white/10"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="font-serif text-xl text-white">{posting.title}</p>
          <p className="text-sm leading-relaxed text-white/70">{posting.description}</p>
          <p className="text-sm text-accent">{posting.hashtags.join(" ")}</p>
        </div>
      )}

      <div data-reveal>
        <Link href="/#hero-input" className="text-sm text-white/60 transition-colors hover:text-white">
          ← Make another video
        </Link>
      </div>
    </section>
  );
}
