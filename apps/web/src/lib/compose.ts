import type { JobConfigInput, VideoMode } from "@agentcast/shared";

// The composer is one box: "Paste your web SaaS URL, or describe your video". The first link in it is
// the product; everything else is the video prompt (PRD FR-5).

const LINK = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?)/i;

export function parseComposer(text: string): { url?: string; prompt: string } {
  const match = LINK.exec(text);
  if (!match) return { prompt: text.trim() };
  const raw = match[1]!.replace(/[),.;]+$/, "");
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    new URL(url);
  } catch {
    return { prompt: text.trim() };
  }
  const prompt = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).replace(/\s+/g, " ").trim();
  return { url, prompt };
}

export type ComposerChoices = {
  mode: VideoMode;
  aspects: ("16x9" | "9x16")[];
  langs: ("en" | "hi")[];
  auth: "public" | "sign-in-once";
  autopilot: boolean;
};

export const DEFAULT_CHOICES: ComposerChoices = {
  mode: "launch",
  aspects: ["16x9", "9x16"],
  langs: ["en"],
  auth: "public",
  autopilot: false,
};

export function toJobConfig(url: string, prompt: string, c: ComposerChoices): JobConfigInput {
  return {
    url,
    stylePrompt: prompt,
    mode: c.mode,
    auth: { mode: c.auth },
    variants: { aspects: c.aspects, langs: c.langs, formFactors: ["desktop"] },
    autopilot: c.autopilot,
  };
}

const MODE_WORDS: Record<VideoMode, string> = { launch: "launch video", tutorial: "step-by-step tutorial", sales: "sales demo" };
const LANG_WORDS: Record<string, string> = { en: "English", hi: "Hindi" };

/** The plan read back before the job starts (PRD §5.1 "Plan"). */
export function readBack(c: ComposerChoices, prompt: string): string {
  const seconds = /(\d{2,3})\s*(?:s\b|sec|seconds)/i.exec(prompt)?.[1];
  const formats = c.aspects.map((a) => (a === "16x9" ? "16:9" : "9:16")).join(" and ");
  const langs = c.langs.map((l) => LANG_WORDS[l] ?? l).join(" and ");
  const length = seconds ? `about ${seconds} s, ` : "";
  const review = c.autopilot ? "straight through on autopilot" : "with your review of flows, script and preview";
  return `A ${MODE_WORDS[c.mode]}, ${length}${formats} in ${langs}, ${review}.`;
}
