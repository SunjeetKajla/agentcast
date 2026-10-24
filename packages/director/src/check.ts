import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Edl, Script, Storyboard, type CameraKey, type ShotSegment, type Timeline } from "@agentcast/shared";
import { calloutSeconds, cropFor, inView, moveSeconds, readSeconds } from "@agentcast/video";

// Checks the director's edl.json. The director runs it (check-cli.ts) while it works; the worker runs
// it again afterwards and doesn't take the agent's word for it.

export type Issue = { severity: "error" | "warn"; at: string; message: string };
export type CheckResult = { edl?: Edl; issues: Issue[] };

const error = (at: string, message: string): Issue => ({ severity: "error", at, message });
const warn = (at: string, message: string): Issue => ({ severity: "warn", at, message });

const readJson = async (dir: string, rel: string) => JSON.parse(await readFile(join(dir, rel), "utf8")) as unknown;

/** The timeline as the workspace keeps it (data/timeline.json): only what editing needs. */
type WorkspaceTimeline = Pick<Timeline, "viewport" | "duration"> & {
  events: Pick<Timeline["events"][number], "t" | "stepId" | "kind" | "bbox">[];
};

export async function checkWorkspace(dir: string): Promise<CheckResult> {
  let raw: unknown;
  try {
    raw = await readJson(dir, "edl.json");
  } catch (e) {
    return { issues: [error("edl.json", `isn't valid JSON: ${(e as Error).message}`)] };
  }
  const parsed = Edl.safeParse(raw);
  if (!parsed.success)
    return {
      issues: parsed.error.issues.slice(0, 15).map((i) => error(i.path.join(".") || "edl.json", i.message)),
    };
  const edl = parsed.data;
  const baseline = Edl.parse(await readJson(dir, "edl.baseline.json"));
  const storyboard = Storyboard.parse(await readJson(dir, "data/storyboard.json"));
  const timeline = (await readJson(dir, "data/timeline.json")) as WorkspaceTimeline;
  const langs = (await readdir(join(dir, "data")))
    .filter((f) => /^script\.[\w-]+\.json$/.test(f))
    .map((f) => f.slice("script.".length, -".json".length));
  for (const lang of langs) Script.parse(await readJson(dir, `data/script.${lang}.json`));
  return { edl, issues: lint(edl, baseline, storyboard, timeline, langs) };
}

/** The rules, on parsed inputs. */
export function lint(
  edl: Edl,
  baseline: Edl,
  storyboard: Storyboard,
  timeline: WorkspaceTimeline,
  langs: string[],
): Issue[] {
  const issues: Issue[] = [];
  const { motion } = edl.style;
  const move = moveSeconds(motion);
  const view = { w: timeline.viewport.w, h: timeline.viewport.h };
  const beats = new Map(storyboard.beats.map((b) => [b.id, b]));

  // What the brief, the brand and the renderer fix.
  if (motion.personality !== baseline.style.motion.personality)
    issues.push(error("style.motion.personality", `must stay "${baseline.style.motion.personality}" (the brief's)`));
  if (edl.style.edit !== baseline.style.edit) issues.push(error("style.edit", `must stay "${baseline.style.edit}"`));
  if (edl.style.music.trackId)
    issues.push(error("style.music", "music isn't rendered yet: leave style.music as it was"));
  if (edl.style.look.theme !== baseline.style.look.theme)
    issues.push(error("style.look.theme", `must stay "${baseline.style.look.theme}" (the product's own)`));
  if (edl.style.captionStyle === "karaoke" && baseline.style.captionStyle === "block")
    issues.push(error("style.captionStyle", "karaoke needs the voice's word timings, and this video has no voice"));

  // The storyboard: every baseline segment, with its id, in order.
  const ids = edl.segments.map((s) => s.id);
  const expected = baseline.segments.map((s) => s.id);
  if (ids.filter((id) => expected.includes(id)).join() !== expected.join())
    issues.push(
      error("segments", `must keep the baseline's segments in order (${expected.join(", ")}); found ${ids.join(", ")}`),
    );
  if (new Set(ids).size !== ids.length) issues.push(error("segments", "segment ids must be unique"));
  if (edl.style.edit === "guide" && edl.segments.some((s) => s.kind !== "shot"))
    issues.push(error("segments", "a guide (tutorial) has only shots"));
  for (const kind of ["stat", "montage"] as const)
    if (edl.segments.filter((s) => s.kind === kind).length > 1) issues.push(error("segments", `at most one ${kind}`));

  const fullText = (at: string, what: string, text: Record<string, string>) => {
    const missing = langs.filter((l) => !text[l]?.trim());
    if (missing.length) issues.push(error(at, `${what} has no text for ${missing.join(", ")}`));
  };
  const onRecording = (at: string, box: [number, number, number, number]) => {
    const [x, y, w, h] = box;
    if (x < -1 || y < -1 || x + w > view.w + 1 || y + h > view.h + 1 || w <= 0 || h <= 0)
      issues.push(error(at, `[${box.join(", ")}] isn't inside the ${view.w}×${view.h} recording`));
  };

  edl.segments.forEach((segment, i) => {
    const at = `segments[${i}] (${segment.id})`;
    if (segment.kind === "statement") {
      fullText(at, "the headline", segment.text);
      if (segment.kicker) fullText(at, "the kicker", segment.kicker);
      return;
    }
    if (segment.kind === "stat") return fullText(at, "the label", segment.label);
    if (segment.kind === "montage") {
      if (segment.clips.length < 2 || segment.clips.length > 4) issues.push(error(at, "a montage has 2–4 clips"));
      for (const c of segment.clips)
        if (c.in < 0 || c.out > timeline.duration || c.out - c.in < 0.5)
          issues.push(
            error(at, `clip ${c.in}–${c.out}s must be at least 0.5 s inside the recording (0–${timeline.duration}s)`),
          );
      if (segment.text) fullText(at, "the line", segment.text);
      return;
    }
    shotIssues(segment, at);
  });

  function shotIssues(shot: ShotSegment, at: string) {
    const beat = shot.beatId ? beats.get(shot.beatId) : undefined;
    const original = baseline.segments.find((s) => s.id === shot.id);
    if (!original || original.kind !== "shot")
      return void issues.push(error(at, "shots come from the storyboard: keep the baseline's"));
    if (
      beat &&
      beat.in !== undefined &&
      beat.out !== undefined &&
      (shot.in < beat.in - 0.05 || shot.out > beat.out + 0.05)
    )
      issues.push(
        error(at, `must stay inside its beat's footage (${beat.in}–${beat.out}s); it's ${shot.in}–${shot.out}s`),
      );
    if (shot.flowId !== original.flowId) issues.push(error(at, `must keep flowId "${original.flowId}"`));
    if (shot.out - shot.in < 0.5) issues.push(error(at, "is shorter than 0.5 s"));
    const ramps = [...(shot.ramps ?? [])].sort((a, b) => a.from - b.from);
    ramps.forEach((r, k) => {
      const where = `${at}.ramps[${k}]`;
      if (r.from < shot.in || r.to > shot.out) issues.push(error(where, `${r.from}–${r.to}s is outside the shot`));
      if (r.to - r.from < 0.5) issues.push(error(where, "shorter than 0.5 s: it would read as a glitch"));
      if (k && r.from < ramps[k - 1]!.to) issues.push(error(where, "overlaps the ramp before it"));
    });
    for (const [k, cue] of (shot.sfx ?? []).entries())
      if (cue.t < shot.in || cue.t > shot.out) issues.push(error(`${at}.sfx[${k}]`, `t ${cue.t} is outside the shot`));

    // The camera.
    let prev: CameraKey | undefined;
    shot.camera.forEach((key, k) => {
      const where = `${at}.camera[${k}]`;
      if (key.t < shot.in - 0.01 || key.t >= shot.out)
        issues.push(error(where, `t ${key.t} is outside the shot (${shot.in}–${shot.out}s)`));
      if (key.target !== "full") onRecording(`${where}.target`, key.target);
      if (prev && key.t < prev.t) issues.push(error(where, "keys must be in time order"));
      else if (prev && key.ease !== "cut" && key.t - prev.t < move / 2)
        issues.push(error(where, `less than half a move (${(move / 2).toFixed(2)} s) after the key before`));
      // The 1/3 rule: a zoomed move across more than a third of the frame goes out first, or cuts.
      if (prev && prev.target !== "full" && key.target !== "full" && key.ease !== "cut") {
        const a = cropFor(prev.target, prev.zoom, view, 16 / 9);
        const b = cropFor(key.target, key.zoom, view, 16 / 9);
        if (Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) > view.w / 3)
          issues.push(
            error(where, "travels more than a third of the frame: go out to 'full' first, or use ease 'cut'"),
          );
      }
      prev = key;
    });

    // On-screen text: every language, one at a time, and callouts on something the camera shows.
    const shown: [string, number, number][] = [];
    const words = (text: Record<string, string>) => text[langs[0] ?? "en"] ?? Object.values(text)[0] ?? "";
    if (shot.title) {
      fullText(`${at}.title`, "the title", shot.title.text);
      if (words(shot.title.text).split(/\s+/).length > 6) issues.push(warn(`${at}.title`, "longer than 6 words"));
      shown.push(["the title", shot.in, shot.in + shot.title.seconds]);
    }
    (shot.callouts ?? []).forEach((c, k) => {
      const where = `${at}.callouts[${k}]`;
      fullText(where, "the callout", c.text);
      onRecording(`${where}.anchor`, c.anchor);
      if (c.t < shot.in || c.t > shot.out) issues.push(error(where, `t ${c.t} is outside the shot`));
      shown.push([`the callout at ${c.t}s`, c.t, c.t + calloutSeconds(words(c.text))]);
      if (!inView(shot.camera, c.t + Math.min(0.5, calloutSeconds(words(c.text)) / 2), c.anchor, view, motion))
        issues.push(error(where, "points at something the camera isn't showing then: move the camera there first"));
    });
    (shot.lowerThirds ?? []).forEach((l, k) => {
      const where = `${at}.lowerThirds[${k}]`;
      fullText(where, "the lower third", l.text);
      if (l.t < shot.in || l.t > shot.out) issues.push(error(where, `t ${l.t} is outside the shot`));
      shown.push([`the lower third at ${l.t}s`, l.t, l.t + readSeconds(words(l.text), 2)]);
    });
    shown.sort((a, b) => a[1] - b[1]);
    for (let k = 1; k < shown.length; k++) {
      const [what, start] = shown[k]!;
      const [before, , end] = shown[k - 1]!;
      if (start < end - 0.2) issues.push(error(at, `${what} overlaps ${before}: one text at a time`));
    }
    // Text reads at normal speed: no ramp while it's up.
    for (const [what, start, end] of shown)
      if (ramps.some((r) => r.from < end && r.to > start))
        issues.push(error(`${at}.ramps`, `a ramp speeds through ${what}: text plays at normal speed`));
    if (beat?.motion.focusStepId && !shot.camera.some((key) => key.target !== "full"))
      issues.push(warn(at, `the camera never moves to the focus step (${beat.motion.focusStepId})`));
  }
  return issues;
}

export const errorsOf = (r: CheckResult) => r.issues.filter((i) => i.severity === "error");

export const describeIssues = (issues: Issue[]) =>
  issues.map((i) => `- [${i.severity}] ${i.at}: ${i.message}`).join("\n");
