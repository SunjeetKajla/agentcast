import type { z } from "zod";
import type { FormFactor, Lang } from "./common.ts";
import { Brand, CreativeBrief, ProductBrief } from "./brief.ts";
import { ChangeReport } from "./changes.ts";
import { Edl } from "./edl.ts";
import { FlowsFile, ReplayPlan } from "./flow.ts";
import { Job } from "./job.ts";
import { Script, Storyboard } from "./story.ts";
import { Timeline } from "./timeline.ts";
import { Voiceover } from "./voice.ts";

// Where everything lives inside a job dir ($AGENTCAST_HOME/jobs/<id>/). Use these, don't hand-write paths.

export const jobPaths = {
  state: "state.json",
  events: "events.ndjson",
  productBrief: "brief/product-brief.json",
  creativeBrief: "brief/creative.json",
  brand: "brief/brand.json",
  hero: "brief/hero.jpg",
  flows: "explore/flows.json",
  recording: (ff: FormFactor) => `record/${ff}/recording.mp4`,
  timeline: (ff: FormFactor) => `record/${ff}/timeline.json`,
  replayPlan: "record/replay-plan.json",
  changes: "record/changes.json",
  storyboard: "script/storyboard.json",
  script: (lang: Lang) => `script/script.${lang}.json`,
  voice: (lang: Lang) => `voice/${lang}.json`,
  voiceClip: (lang: Lang, beatId: string) => `voice/${lang}/${beatId}.mp3`,
  edl: "render/edl.json",
  preview: "out/preview.mp4",
  output: (variantId: string, ext: "mp4" | "srt" | "vtt") => `out/${variantId}.${ext}`,
} as const;

/** Every schema-validated artifact, by job-relative path. */
export const ARTIFACTS: { pattern: RegExp; schema: z.ZodType }[] = [
  { pattern: /^state\.json$/, schema: Job },
  { pattern: /^brief\/product-brief\.json$/, schema: ProductBrief },
  { pattern: /^brief\/creative\.json$/, schema: CreativeBrief },
  { pattern: /^brief\/brand\.json$/, schema: Brand },
  { pattern: /^explore\/flows\.json$/, schema: FlowsFile },
  { pattern: /^record\/(desktop|mobile)\/timeline\.json$/, schema: Timeline },
  { pattern: /^record\/replay-plan\.json$/, schema: ReplayPlan },
  { pattern: /^record\/changes\.json$/, schema: ChangeReport },
  { pattern: /^script\/storyboard\.json$/, schema: Storyboard },
  { pattern: /^script\/script\.[a-z-]+\.json$/, schema: Script },
  { pattern: /^voice\/[a-z-]+\.json$/, schema: Voiceover },
  { pattern: /^render\/edl\.json$/, schema: Edl },
];

export function schemaForPath(relPath: string): z.ZodType | undefined {
  return ARTIFACTS.find((a) => a.pattern.test(relPath))?.schema;
}
