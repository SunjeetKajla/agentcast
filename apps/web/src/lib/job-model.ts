import { STAGES, musicLed, variantMatrix, voiced, type Job, type StageName, type StageState } from "@agentcast/shared";

// What the job page shows, computed from the worker's job state. Pure, so the page and the tests share
// it. Every time on the page is measured from the job's createdAt, in whole seconds.

export type FieldState = "run" | "wait" | "done" | "fail" | "off";

const sec = (iso: string | undefined) => (iso ? Date.parse(iso) / 1000 : undefined);

export const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
export const took = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`;
};

export const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The big word in the field, per stage. */
export const STAGE_TITLE: Record<StageName, string> = {
  understand: "Understanding",
  auth: "Sign in",
  discover: "Exploring",
  "flow-runs": "Trying flows",
  "gate-flows": "Review flows",
  record: "Recording",
  script: "Writing",
  "gate-script": "Review the script",
  voice: "Voicing",
  direct: "Directing",
  preview: "Previewing",
  "gate-preview": "Review preview",
  render: "Rendering",
};

/** What a stage does, when the worker hasn't said more. */
export const STAGE_LEAD: Record<StageName, string> = {
  understand: "Reading your product’s pages to work out its brand and what the video has to prove.",
  auth: "A Chrome window is open on the worker’s machine. Sign in there, then press “I’m signed in” here or close that window. Your password stays in Chrome.",
  discover: "An agent is finding the real way into your app.",
  "flow-runs": "Agents try the flows worth showing, side by side. Each one is replayed in a fresh local Chrome.",
  "gate-flows": "Pick, order and rename the flows to film. These are the frames each one reached when it replayed.",
  record: "Each approved flow replays in a local Chromium and is filmed at 60 fps. A bad take is shot again.",
  script: "The storyboard first, then the lines in each language, sized to what each shot can carry.",
  "gate-script": "Read it as it will be heard. Edit any line; the meter shows whether it still fits its shot.",
  voice: "Recording a clip per line, with a timestamp on every word for the captions.",
  direct: "The coding agent edits: cuts timed to the voice or the beat, zooms, captions and callouts.",
  preview: "A quick 540p render so you can watch the whole cut before the full one.",
  "gate-preview": "Watch it. Approve it to render every format, or describe a change in plain words.",
  render: "Rendering every size and language at 1080p from the approved edit.",
};

/** Typical seconds per stage, for the parts of the timeline that haven't happened yet. */
export function estimate(job: Job, stage: StageName): number {
  const variants = variantMatrix(job.config.variants).length;
  const est: Record<StageName, number> = {
    understand: 40,
    auth: job.config.auth.mode === "public" ? 0 : 90,
    discover: 150,
    "flow-runs": 240,
    "gate-flows": job.config.autopilot ? 0 : 60,
    record: 120,
    script: 60,
    "gate-script": job.config.autopilot ? 0 : 45,
    voice: voiced(job.config) ? 45 : 0,
    direct: 240,
    preview: 60,
    "gate-preview": job.config.autopilot ? 0 : 60,
    render: 50 * variants,
  };
  return est[stage];
}

/** The stage the job is on: the one running or waiting, else the last that ended. */
export function currentStage(job: Job): StageName | undefined {
  // Sign-in runs beside Understand and is the one that needs you, so it takes the field while it runs.
  if (job.config.auth.mode !== "public" && job.stages.auth.status === "running") return "auth";
  const live = STAGES.find((s) => ["running", "waiting"].includes(job.stages[s.name].status));
  if (live) return live.name;
  const failed = STAGES.find((s) => job.stages[s.name].status === "failed");
  if (failed) return failed.name;
  // A cancel marks every stage still to come as cancelled; the stage it stopped in is the last that started.
  const started = [...STAGES].reverse().find((s) => job.stages[s.name].startedAt && job.stages[s.name].status !== "pending");
  if (started) return started.name;
  return [...STAGES].reverse().find((s) => ["done", "skipped"].includes(job.stages[s.name].status))?.name;
}

export function fieldState(job: Job): FieldState {
  if (job.status === "done") return "done";
  if (job.status === "failed") return "fail";
  if (job.status === "cancelled") return "off";
  if (job.status === "waiting" || STAGES.some((s) => job.stages[s.name].status === "waiting")) return "wait";
  return "run";
}

export const finished = (job: Job) => ["done", "failed", "cancelled"].includes(job.status);

/** Seconds from the job's creation to now, or to when it ended. */
export function elapsed(job: Job, nowMs: number): number {
  const start = sec(job.createdAt)!;
  if (!finished(job)) return nowMs / 1000 - start;
  const ends = STAGES.map((s) => sec(job.stages[s.name].finishedAt)).filter((x): x is number => x !== undefined);
  return (ends.length ? Math.max(...ends) : sec(job.updatedAt)!) - start;
}

export type Clip = {
  stage: StageName;
  label: string;
  gate: boolean;
  status: StageState["status"];
  /** Seconds from the job's start. */
  a: number;
  b: number;
  lane: 0 | 1;
  estimated: boolean;
};

/**
 * The run as an edit timeline: a clip per stage at its real start and end (running and waiting ones end
 * now), stages that ran side by side on a second lane, and the stages still to come laid end to end
 * after the last, at their typical length.
 */
export function timeline(job: Job, nowMs: number): { clips: Clip[]; total: number; now: number } {
  const start = sec(job.createdAt)!;
  const now = elapsed(job, nowMs);
  const happened: Clip[] = [];
  for (const s of STAGES) {
    const st = job.stages[s.name];
    const a = sec(st.startedAt);
    if (a === undefined) continue;
    const end = sec(st.finishedAt);
    const live = st.status === "running" || st.status === "waiting";
    happened.push({
      stage: s.name, label: s.label, gate: Boolean(s.gate), status: st.status,
      a: a - start, b: Math.max(a - start, live || end === undefined ? now : end - start), lane: 0, estimated: false,
    });
  }
  happened.sort((x, y) => x.a - y.a);
  let laneEnd = -Infinity;
  for (const c of happened) {
    if (c.a < laneEnd - 0.5 && c.b - c.a > 0.5) c.lane = 1;
    else laneEnd = Math.max(laneEnd, c.b);
  }
  // Skipped stages that never started (a public site's sign-in) sit at the end of their predecessor.
  let cursor = Math.max(now, ...happened.map((c) => c.b), 0);
  const clips: Clip[] = [...happened];
  for (const s of STAGES) {
    const st = job.stages[s.name];
    if (st.startedAt) continue;
    if (st.status === "skipped" || (finished(job) && st.status !== "pending")) {
      const prev = clips.filter((c) => c.lane === 0).reduce((m, c) => Math.max(m, c.b), 0);
      clips.push({ stage: s.name, label: s.label, gate: Boolean(s.gate), status: st.status, a: prev, b: prev, lane: 0, estimated: false });
      continue;
    }
    if (finished(job)) continue;
    const d = estimate(job, s.name);
    clips.push({ stage: s.name, label: s.label, gate: Boolean(s.gate), status: "pending", a: cursor, b: cursor + d, lane: 0, estimated: true });
    cursor += d;
  }
  const total = Math.max(60, ...clips.map((c) => c.b));
  return { clips, total, now };
}

/** The one sentence under the title: the fact that matters most right now. */
export function finding(job: Job, flows?: { total: number; selected: number }): string {
  const stage = currentStage(job);
  const n = variantMatrix(job.config.variants).length;
  const videos = `${n} ${n === 1 ? "video" : "videos"}`;
  if (job.status === "queued") return "Waiting for the worker to pick it up.";
  if (job.status === "done") return `${videos} rendered from the real product in ${took(elapsed(job, Date.now()))}.`;
  if (job.status === "cancelled") {
    const at = stage ? STAGES.find((s) => s.name === stage)?.label : undefined;
    return `Cancelled${at ? ` during ${at}` : ""}. The stages that finished are kept with the job.`;
  }
  if (job.status === "failed") {
    const failed = STAGES.find((s) => job.stages[s.name].status === "failed");
    const err = failed ? job.stages[failed.name].error?.message : undefined;
    return failed ? `${failed.label} failed${err ? `: ${err}` : "."}` : "The job failed.";
  }
  switch (stage) {
    case "auth":
      return "Sign in through the Chrome window on the worker’s machine, then say you’re signed in.";
    case "understand":
      return `Reading ${hostOf(job.config.url)} to write the product brief.`;
    case "discover":
      return "An agent is mapping the way into the app. Flows come next.";
    case "flow-runs":
      return "Agents are trying flows. Nothing is filmed until you approve them.";
    case "gate-flows":
      return flows
        ? `${flows.total} ${flows.total === 1 ? "flow" : "flows"} rehearsed, ${flows.selected} picked by the judge. Nothing is filmed until you approve.`
        : "The flows are rehearsed. Nothing is filmed until you approve them.";
    case "record":
      return flows ? `Filming the ${flows.selected} approved ${flows.selected === 1 ? "flow" : "flows"} at 60 fps.` : "Filming the approved flows at 60 fps.";
    case "script":
      return "Writing the storyboard and the lines.";
    case "gate-script":
      return musicLed(job.config) ? "The storyboard is ready. Approve it and the edit is cut next." : "The script is ready. Approve it and the voice is recorded next.";
    case "voice":
      return "Recording the voice, one clip per line.";
    case "direct":
      return "The coding agent is improving the edit, then checking it with the motion lint.";
    case "preview":
      return "Rendering a 540p preview.";
    case "gate-preview":
      return `Watch the preview. Approve it to render ${videos}.`;
    case "render":
      return `Rendering ${videos} at 1080p.`;
    default:
      return "Getting the next step ready.";
  }
}

const LANG = { en: "English", hi: "Hindi" } as Record<string, string>;
const SIZE = { "16x9": "16:9", "9x16": "9:16" } as Record<string, string>;
const MODE = { launch: "Launch video", tutorial: "Tutorial", sales: "Sales demo" } as const;

export const modeName = (job: Job) => MODE[job.config.mode];

/** "This job": what was asked for, in words. */
export function facts(job: Job): [string, string][] {
  const v = job.config.variants;
  return [
    ["Link", job.config.url],
    ["Video", `${MODE[job.config.mode]}, ${voiced(job.config) ? "narrated" : "music-led"}`],
    ["Outputs", `${variantMatrix(v).length} ${variantMatrix(v).length === 1 ? "video" : "videos"}: ${v.aspects.map((a) => SIZE[a] ?? a).join(" and ")} in ${v.langs.map((l) => LANG[l] ?? l).join(" and ")}`],
    ["Sign-in", job.config.auth.mode === "public" ? "Public site" : job.config.auth.mode === "sign-in-once" ? "Signed in once, on the worker’s machine" : "Saved credentials"],
    ["Review gates", job.config.autopilot ? "Off: runs on autopilot" : "Flows, script and preview"],
    ["Recording", job.config.recordMode === "studio" ? "Studio: frame by frame on the page’s clock" : "Live, in real time"],
    ["Your prompt", [job.config.stylePrompt.trim(), job.config.focusPrompt?.trim() && `focus on ${job.config.focusPrompt.trim()}`].filter(Boolean).join(" · ") || "None"],
  ];
}

export const langName = (l: string) => LANG[l] ?? l;
export const sizeName = (a: string) => SIZE[a] ?? a;
