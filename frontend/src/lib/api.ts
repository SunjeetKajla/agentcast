import type { Job, GenerateRequest, VideoFormat, VideoStyle } from "./types";
import { DEMO_JOBS } from "./mockData";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

// Local storage key for simulated jobs during mock/demo mode
const LOCAL_JOBS_KEY = "agentcast_client_jobs";

function getLocalJobs(): Job[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(LOCAL_JOBS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalJob(job: Job) {
  if (typeof window === "undefined") return;
  try {
    const jobs = getLocalJobs().filter((j) => j.job_id !== job.job_id);
    jobs.unshift(job);
    sessionStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(jobs.slice(0, 10)));
  } catch {}
}

/** Simulate progressing pipeline for a client-side mock job */
function createSimulatedJob(url: string, format: VideoFormat, style: VideoStyle): Job {
  const job_id = `job-${Date.now().toString(36)}`;
  let domain = "web-article";
  try {
    domain = new URL(url).hostname;
  } catch {}

  const title = `Insight: ${domain.replace(/^www\./, "")}`;
  const now = new Date().toISOString();

  const newJob: Job = {
    job_id,
    url,
    title,
    format,
    style,
    status: "scraping",
    progress: 15,
    duration: format === "9:16" ? 42 : 55,
    video_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    thumbnail_url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop",
    created_at: now,
    updated_at: now,
    pipeline_steps: [
      { name: "Extracting content", status: "running", started_at: now },
      { name: "Generating AI script", status: "pending" },
      { name: "Synthesizing voiceover", status: "pending" },
      { name: "Generating scene visuals", status: "pending" },
      { name: "Composing video", status: "pending" },
    ],
    script: [
      {
        scene_number: 1,
        start_time: 0,
        end_time: 14,
        narration: `Key findings and executive breakdown extracted from ${domain}. Here is what you need to know.`,
        visual_description: "Futuristic digital interface with summarized bullet highlights and dynamic motion graphics.",
        thumbnail_url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop",
      },
      {
        scene_number: 2,
        start_time: 14,
        end_time: 28,
        narration: "The core thesis addresses how emerging technological shifts disrupt traditional assumptions and drive adoption.",
        visual_description: "Interactive 3D network nodes displaying rapid convergence and exponential adoption curves.",
        thumbnail_url: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=400&auto=format&fit=crop",
      },
      {
        scene_number: 3,
        start_time: 28,
        end_time: 42,
        narration: "In summary, proactive integration and focused execution provide the ultimate competitive advantage going forward.",
        visual_description: "Clean abstract neon gradients highlighting future strategic milestones.",
        thumbnail_url: "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=400&auto=format&fit=crop",
      },
    ],
  };

  saveLocalJob(newJob);
  return newJob;
}

/** Update simulated job over time */
function advanceSimulatedJob(job: Job): Job {
  const elapsed = (Date.now() - new Date(job.created_at).getTime()) / 1000;
  const updated = { ...job };

  if (elapsed < 3) {
    updated.status = "scraping";
    updated.progress = Math.min(30, Math.round(15 + elapsed * 5));
    updated.pipeline_steps = [
      { name: "Extracting content", status: "running", started_at: job.created_at },
      { name: "Generating AI script", status: "pending" },
      { name: "Synthesizing voiceover", status: "pending" },
      { name: "Generating scene visuals", status: "pending" },
      { name: "Composing video", status: "pending" },
    ];
  } else if (elapsed < 6) {
    updated.status = "scripting";
    updated.progress = Math.min(50, Math.round(30 + (elapsed - 3) * 6));
    updated.pipeline_steps = [
      { name: "Extracting content", status: "completed", started_at: job.created_at, completed_at: new Date().toISOString() },
      { name: "Generating AI script", status: "running", started_at: new Date().toISOString() },
      { name: "Synthesizing voiceover", status: "pending" },
      { name: "Generating scene visuals", status: "pending" },
      { name: "Composing video", status: "pending" },
    ];
  } else if (elapsed < 9) {
    updated.status = "voiceover";
    updated.progress = Math.min(75, Math.round(50 + (elapsed - 6) * 8));
    updated.pipeline_steps = [
      { name: "Extracting content", status: "completed" },
      { name: "Generating AI script", status: "completed" },
      { name: "Synthesizing voiceover", status: "running", started_at: new Date().toISOString() },
      { name: "Generating scene visuals", status: "pending" },
      { name: "Composing video", status: "pending" },
    ];
  } else if (elapsed < 12) {
    updated.status = "rendering";
    updated.progress = Math.min(92, Math.round(75 + (elapsed - 9) * 5));
    updated.pipeline_steps = [
      { name: "Extracting content", status: "completed" },
      { name: "Generating AI script", status: "completed" },
      { name: "Synthesizing voiceover", status: "completed" },
      { name: "Generating scene visuals", status: "running", started_at: new Date().toISOString() },
      { name: "Composing video", status: "pending" },
    ];
  } else {
    updated.status = "completed";
    updated.progress = 100;
    updated.pipeline_steps = [
      { name: "Extracting content", status: "completed" },
      { name: "Generating AI script", status: "completed" },
      { name: "Synthesizing voiceover", status: "completed" },
      { name: "Generating scene visuals", status: "completed" },
      { name: "Composing video", status: "completed", completed_at: new Date().toISOString() },
    ];
  }

  saveLocalJob(updated);
  return updated;
}

/** POST /api/generate — kick off a new video generation job */
export async function generateVideo(
  url: string,
  format: VideoFormat,
  style: VideoStyle
): Promise<{ job_id: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const body: GenerateRequest = {
      url,
      format,
      style,
    };

    const res = await fetch(`${API_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Backend offline or timeout — fall back to client simulated job
  }

  const simulated = createSimulatedJob(url, format, style);
  return { job_id: simulated.job_id };
}

/** GET /api/jobs/{jobId} — poll a single job's progress */
export async function getJob(jobId: string): Promise<Job> {
  // Check demo jobs first
  const demo = DEMO_JOBS.find((j) => j.job_id === jobId);
  if (demo) return demo;

  // Check local simulated jobs
  const local = getLocalJobs().find((j) => j.job_id === jobId);
  if (local) {
    return advanceSimulatedJob(local);
  }

  // Attempt backend fetch
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${API_URL}/jobs/${jobId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      return await res.json();
    }
  } catch {}

  // Fallback: If job not found, return demo job so UI does not crash
  return DEMO_JOBS[0];
}

/** GET /api/jobs — list recent jobs */
export async function getJobs(): Promise<Job[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${API_URL}/jobs`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {}

  // Combine local jobs and demo jobs
  const local = getLocalJobs();
  const all = [...local, ...DEMO_JOBS];
  const unique = Array.from(new Map(all.map((j) => [j.job_id, j])).values());
  return unique;
}

/** Build the public video URL for a job */
export function getVideoUrl(jobId: string): string {
  const demo = DEMO_JOBS.find((j) => j.job_id === jobId);
  if (demo?.video_url) return demo.video_url;

  const local = getLocalJobs().find((j) => j.job_id === jobId);
  if (local?.video_url) return local.video_url;

  return `${API_URL}/jobs/${jobId}/video`;
}
