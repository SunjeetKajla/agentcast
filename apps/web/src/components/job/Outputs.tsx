"use client";

import { useState } from "react";
import Link from "next/link";
import { Script, jobPaths, variantMatrix, type Job } from "@agentcast/shared";
import VideoPlayer from "@/components/VideoPlayer";
import { fileUrl } from "@/lib/api";
import { hostOf, langName, sizeName } from "@/lib/job-model";
import { useArtifact } from "@/lib/useArtifact";

// The finished videos (PRD §5.1 step 7): every variant the job asked for, to watch and download, and
// the copy to post them with.

export default function Outputs({ job, versions }: { job: Job; versions: Record<string, number> }) {
  const variants = variantMatrix(job.config.variants);
  const lang = job.config.variants.langs[0] ?? "en";
  const script = useArtifact(job.id, jobPaths.script(lang), Script, versions[jobPaths.script(lang)]);
  const [copied, setCopied] = useState<"ok" | "fail">();
  const posting = script.data?.posting;
  const copyText = posting ? `${posting.title}\n\n${posting.description}\n\n${posting.hashtags.join(" ")}` : "";
  // One row per language: its 16:9 and its 9:16 side by side, at the same height.
  const langs = [...new Set(variants.map((v) => v.lang))];
  const host = hostOf(job.config.url);

  return (
    <div className="outs-real">
      {langs.map((lang) => (
        <div key={lang} className={`outs-row ${variants.some((v) => v.lang === lang && v.aspect === "9x16") && variants.some((v) => v.lang === lang && v.aspect === "16x9") ? "pair" : ""}`}>
          {variants.filter((v) => v.lang === lang).map((v) => {
            const rel = jobPaths.output(v.id, "mp4");
            const src = fileUrl(job.id, rel, versions[rel]);
            return (
              <figure key={v.id} className={`out-v ${v.aspect === "16x9" ? "w" : "v"}`}>
                <div data-ui className="out-player">
                  <VideoPlayer src={src} format={v.aspect === "16x9" ? "16:9" : "9:16"} />
                </div>
                <figcaption>
                  <span>
                    <b>{sizeName(v.aspect)} · {langName(v.lang)}{v.source === "mobile" ? " · mobile" : ""}</b>
                    <small>{v.aspect === "16x9" ? "1920 × 1080" : "1080 × 1920"}</small>
                  </span>
                  <a className="ab ab-f2" href={src} download={`${host}-${v.id}.mp4`}>Download</a>
                </figcaption>
              </figure>
            );
          })}
        </div>
      ))}

      <div className="outs-side">
        {posting && (
          <div className="post">
            <div className="post-h">
              <h3>Post it with</h3>
              <button
                type="button"
                className="ab ab-f2"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(copyText);
                    setCopied("ok");
                  } catch {
                    setCopied("fail");
                  }
                  setTimeout(() => setCopied(undefined), 2500);
                }}
              >
                {copied === "ok" ? "Copied" : copied === "fail" ? "Select it instead" : "Copy"}
              </button>
            </div>
            <p className="post-t">{posting.title}</p>
            <p>{posting.description}</p>
            <p className="post-tags">{posting.hashtags.join(" ")}</p>
          </div>
        )}
        <div className="done-act">
          <Link className="ab ab-f" href="/#top">Make another video <span className="arr" aria-hidden="true">→</span></Link>
        </div>
        <p className="rerun-hint">
          When the UI changes, film it again with <code>pnpm agentcast rerun --job {job.id}</code>. The script, voice and edit carry over.
        </p>
      </div>
    </div>
  );
}
