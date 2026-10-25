// Phase 10 spike: re-render an existing job's edit through HyperFrames (or Remotion) and measure it
// against the reference look (PRD FR-88). Reads the job's artifacts the way the preview stage does.
//   pnpm --filter @agentcast/spikes hf --job <id> [--aspect 16x9|9x16] [--lang en] [--height 1080] [--remotion]
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Aspect } from "@agentcast/shared";
import {
  checkComposition,
  compileComposition,
  snapshotComposition,
  variantDir,
  measureVideo,
  renderVideo,
} from "@agentcast/video";
import { jobInput } from "./job-input.ts";

const { values } = parseArgs({
  options: {
    job: { type: "string" },
    aspect: { type: "string", default: "16x9" },
    lang: { type: "string", default: "en" },
    height: { type: "string", default: "1080" },
    out: { type: "string" },
    remotion: { type: "boolean", default: false },
    measure: { type: "string" },
    stills: { type: "string" },
  },
});

if (values.measure) {
  console.log(JSON.stringify(await measureVideo(values.measure), null, 2));
  process.exit(0);
}
if (!values.job) throw new Error("--job <id> is required");
const root = join(process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast"), "jobs", values.job);
const input = await jobInput(root, values.aspect as Aspect, values.lang!, Number(values.height));
if (values.stills) {
  // Compile and look: frames every `--stills` seconds plus the check's findings, no render.
  const dir = variantDir(root, input);
  const { duration, scenes } = await compileComposition({ input, root, out: dir, scenes: join(root, "render", "composition", "compositions") });
  console.log(scenes.map((s) => `${s.id} ${s.kind} ${s.start}–${(s.start + s.duration).toFixed(2)}`).join("\n"));
  const step = Number(values.stills);
  const times = Array.from({ length: Math.floor(duration / step) }, (_, i) => (i + 0.5) * step);
  const outDir = join(root, "render", "stills-hf");
  await snapshotComposition({ dir, outDir, times });
  console.log(`${outDir}/contact-sheet.jpg`);
  const check = await checkComposition(dir);
  console.log(`check ok=${check.ok}`);
  for (const f of check.findings.slice(0, 25)) console.log(`  ${f.severity} ${f.section}/${f.code}: ${f.message.slice(0, 160)}`);
  process.exit(0);
}
if (values.remotion) process.env.AGENTCAST_RENDERER = "remotion";
const out = values.out ?? join(root, "out", `hf-${input.aspect}-${input.lang}-${input.height}.mp4`);
let last = -1;
const result = await renderVideo({
  input,
  root,
  out,
  scenes: join(root, "render", "composition", "compositions"),
  onProgress: (p) => {
    const pct = Math.floor(p * 10) * 10;
    if (pct !== last) console.log(`  ${pct}%`), (last = pct);
  },
});
console.log(`${out}: ${result.frames} frames in ${result.seconds.toFixed(1)} s`);
console.log(JSON.stringify(await measureVideo(out), null, 2));
