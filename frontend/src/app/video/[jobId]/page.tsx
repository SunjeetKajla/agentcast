"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import VideoPlayer from "@/components/VideoPlayer";
import ActionButtons from "@/components/ActionButtons";
import SceneCard from "@/components/SceneCard";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJob, getVideoUrl } from "@/lib/api";
import type { Job } from "@/lib/types";

function formatDuration(seconds?: number): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VideoPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;
  const videoRef = useRef<HTMLVideoElement>(null);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    getJob(jobId)
      .then((data) => {
        if (data.status !== "completed") {
          router.push(`/generate/${jobId}`);
          return;
        }
        setJob(data);
      })
      .catch(() => setError("Failed to load video"));
  }, [jobId, router]);

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play().catch(() => {});
    }
  };

  const handleRegenerate = () => {
    router.push("/");
  };

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => router.push("/")}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
        >
          Return Home
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-accent border-t-transparent" />
        <p className="text-sm text-muted-foreground animate-pulse">Loading video and scenes...</p>
      </div>
    );
  }

  const videoUrl = job.video_url || getVideoUrl(jobId);
  const title = job.title || "Untitled Video";

  return (
    <div className="w-full max-w-4xl px-4 py-10 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-8"
      >
        {/* Video player with custom controls and format responsiveness */}
        <VideoPlayer
          src={videoUrl}
          poster={job.thumbnail_url}
          format={job.format}
          videoRef={videoRef}
          onTimeUpdate={setCurrentTime}
        />

        {/* Title + Metadata */}
        <div className="space-y-3 rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-accent/40 bg-accent/10 text-accent font-mono text-xs">
                {job.format}
              </Badge>
              <Badge variant="secondary" className="capitalize text-xs font-medium">
                {job.style}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1 font-mono">
              <span>⏱</span>
              <span>{formatDuration(job.duration)}</span>
            </span>
            <span>•</span>
            <span className="truncate max-w-md">
              Source:{" "}
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline font-mono"
              >
                {job.url}
              </a>
            </span>
          </div>

          {/* Action buttons */}
          <div className="pt-2">
            <ActionButtons
              videoUrl={videoUrl}
              jobId={jobId}
              onRegenerate={handleRegenerate}
            />
          </div>
        </div>

        {/* Tabs: Scenes / Script / Details */}
        <Tabs defaultValue="scenes" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-muted/60 p-1">
            <TabsTrigger value="scenes" className="text-xs sm:text-sm">
              🖼️ Scenes ({job.script?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="script" className="text-xs sm:text-sm">
              📝 Script
            </TabsTrigger>
            <TabsTrigger value="details" className="text-xs sm:text-sm">
              ⚙️ Details
            </TabsTrigger>
          </TabsList>

          {/* Scenes Tab */}
          <TabsContent value="scenes" className="mt-6 space-y-3">
            {job.script && job.script.length > 0 ? (
              <div className="space-y-3">
                {job.script.map((scene) => (
                  <SceneCard
                    key={scene.scene_number}
                    scene={scene}
                    isActive={
                      currentTime >= scene.start_time &&
                      currentTime < scene.end_time
                    }
                    onSeek={handleSeek}
                  />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No scenes available.
              </p>
            )}
          </TabsContent>

          {/* Script Tab */}
          <TabsContent value="script" className="mt-6">
            {job.script && job.script.length > 0 ? (
              <div className="space-y-4 rounded-xl border border-border bg-card p-6">
                <h3 className="text-sm font-semibold text-accent uppercase tracking-wider">
                  Full Narration Script
                </h3>
                <div className="space-y-4 divide-y divide-border/60">
                  {job.script.map((scene) => (
                    <div key={scene.scene_number} className="pt-3 first:pt-0">
                      <span className="text-xs font-mono text-muted-foreground block mb-1">
                        [{formatDuration(scene.start_time)} – {formatDuration(scene.end_time)}]
                      </span>
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {scene.narration}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No script available.
              </p>
            )}
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="mt-6">
            <div className="divide-y divide-border/60 rounded-xl border border-border bg-card p-6 text-sm">
              <div className="flex justify-between py-3 first:pt-0">
                <span className="text-muted-foreground">Job ID</span>
                <span className="font-mono text-foreground text-xs">{job.job_id}</span>
              </div>
              <div className="flex justify-between py-3">
                <span className="text-muted-foreground">Aspect Format</span>
                <span className="text-foreground font-mono">{job.format}</span>
              </div>
              <div className="flex justify-between py-3">
                <span className="text-muted-foreground">Video Style</span>
                <span className="capitalize text-foreground">{job.style}</span>
              </div>
              <div className="flex justify-between py-3">
                <span className="text-muted-foreground">Total Duration</span>
                <span className="text-foreground font-mono">
                  {formatDuration(job.duration)} ({job.duration}s)
                </span>
              </div>
              <div className="flex justify-between py-3">
                <span className="text-muted-foreground">Total Scenes</span>
                <span className="text-foreground">{job.script?.length ?? 0}</span>
              </div>
              <div className="flex justify-between py-3">
                <span className="text-muted-foreground">Created Date</span>
                <span className="text-foreground">
                  {new Date(job.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-3 last:pb-0">
                <span className="text-muted-foreground">Original Article</span>
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate max-w-xs text-accent hover:underline font-mono text-xs"
                >
                  {job.url}
                </a>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
