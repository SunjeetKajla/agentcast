// Phase 10.5 spike: the free-form director's workspace on a copy of a real job. Lays it out with the
// composition, rewrites one scene the way the director would, runs the worker's check (scene contract
// + hyperframes check), then renders the preview with that scene.
//   pnpm --filter @agentcast/spikes hf-director --job <id> [--keep]
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CreativeBrief, Edl, Script, Storyboard, Timeline, jobPaths } from "@agentcast/shared";
import { checkWorkspace, describeIssues, prepareWorkspace } from "@agentcast/director";
import { measureVideo, renderVideo } from "@agentcast/video";
import { jobInput } from "./job-input.ts";

const { values } = parseArgs({ options: { job: { type: "string" }, keep: { type: "boolean", default: false } } });
if (!values.job) throw new Error("--job <id> is required");
const source = join(process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast"), "jobs", values.job);
const root = await mkdtemp(join(tmpdir(), "agentcast-director-"));
await cp(source, root, { recursive: true, filter: (p) => !p.includes("/render/variants") && !p.includes("/out/") });
const read = async <T>(rel: string, schema: { parse(v: unknown): T }) => schema.parse(JSON.parse(await readFile(join(root, rel), "utf8")));
const baseline = await read("render/edl.baseline.json", Edl).catch(() => read(jobPaths.edl, Edl));
const { edl: _drop, ...render } = await jobInput(root, "16x9", "en", 540, baseline);
const dir = join(root, "render");
console.time("prepareWorkspace");
await prepareWorkspace({
  dir,
  creative: await read(jobPaths.creativeBrief, CreativeBrief),
  storyboard: await read(jobPaths.storyboard, Storyboard),
  scripts: [await read(jobPaths.script("en"), Script)],
  timeline: await read(jobPaths.timeline("desktop"), Timeline),
  voices: [],
  baseline,
  render,
});
console.timeEnd("prepareWorkspace");

// The director rewrites the first statement as a LangEase-style build on a ribbon, and breaks two rules
// in a second file to prove the contract catches them.
const statement = baseline.segments.find((s) => s.kind === "statement");
if (statement) {
  const id = statement.id;
  await writeFile(
    join(dir, "composition", "compositions", `${id}.html`),
    `<template>
<style>
#root { position: absolute; inset: 0; overflow: hidden; }
#${id}-band { position: absolute; left: -10%; right: -10%; top: 38%; height: 24%; background: linear-gradient(90deg, var(--ac-accent), var(--ac-accent2)); transform-origin: 0 50%; }
#${id}-words { color: var(--ac-on-field); }
</style>
<div id="root" data-composition-id="${id}" data-width="960" data-height="540">
  <div id="${id}-in" class="ac-fill"><div id="${id}-out" class="ac-fill">
    <div id="${id}-band"></div>
    <div id="${id}-words" class="ac-fill ac-center"></div>
  </div></div>
</div>
<script>
(function () {
  var S = AC.scene("${id}", window.__hyperframes.getVariables()), v = S.v, tl = S.tl;
  AC.enter(tl, S.el("in"), v.enter, Number(v.enterSecs));
  tl.fromTo(S.el("band"), { scaleX: 0, rotation: -4 }, { scaleX: 1, rotation: -2, duration: 0.6, ease: "power4.out" }, 0.05);
  tl.fromTo(S.el("band"), { rotation: -2 }, { rotation: 1, duration: S.dur, ease: "none", immediateRender: false }, 0.65);
  AC.words(tl, S.el("words"), v.text, v.accent, 0.35, S.dur - 0.2, "build", 150);
  AC.drift(tl, S.el("words"), S.dur, 0.1);
  S.done();
})();
</script>
</template>
`,
  );
  await writeFile(join(dir, "composition", "compositions", "bad.html"), `<template><div id="root" data-composition-id="bad"></div><script>fetch("https://x.example"); Math.random();</script></template>`);
}
console.time("check (with the broken file)");
let result = await checkWorkspace(dir);
console.timeEnd("check (with the broken file)");
console.log(describeIssues(result.issues.filter((i) => i.severity === "error")));
await rm(join(dir, "composition", "compositions", "bad.html"));
console.time("check");
result = await checkWorkspace(dir);
console.timeEnd("check");
console.log(result.issues.filter((i) => i.severity === "error").length ? describeIssues(result.issues) : "passes");

const input = await jobInput(root, "16x9", "en", 540, result.edl);
const out = join(root, "preview.mp4");
const r = await renderVideo({ input, root, out, scenes: join(dir, "composition", "compositions") });
console.log(`${out}: ${r.frames} frames in ${r.seconds.toFixed(1)} s`);
console.log(JSON.stringify(await measureVideo(out)));
if (!values.keep) await rm(root, { recursive: true, force: true });
else console.log(`kept ${root}`);
