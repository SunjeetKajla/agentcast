/* ── Types for AgentCast ── */

export type VideoFormat = "9:16" | "16:9" | "1:1";
export type VideoStyle = "explainer" | "podcast" | "news_bite";

export interface GenerateRequest {
  url: string;
  format: VideoFormat;
  style: VideoStyle;
}

export interface Scene {
  scene_number: number;
  narration: string;
  visual_description: string;
  start_time: number;
  end_time: number;
  thumbnail_url?: string;
}

export type JobStatus =
  | "pending"
  | "scraping"
  | "scripting"
  | "voiceover"
  | "rendering"
  | "compositing"
  | "completed"
  | "failed";

export interface PipelineStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at?: string;
  completed_at?: string;
}

export interface Job {
  job_id: string;
  url: string;
  format: VideoFormat;
  style: VideoStyle;
  status: JobStatus;
  progress: number;
  title?: string;
  duration?: number;
  script?: Scene[];
  video_url?: string;
  thumbnail_url?: string;
  pipeline_steps: PipelineStep[];
  created_at: string;
  updated_at: string;
  error?: string;
}

export interface JobResult {
  job_id: string;
  title: string;
  duration: number;
  format: VideoFormat;
  style: VideoStyle;
  video_url: string;
  thumbnail_url?: string;
  script: Scene[];
  source_url: string;
}
