import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ChangeReport,
  Edl,
  FlowsFile,
  Job,
  JobConfig,
  JobEvent,
  Script,
  Storyboard,
  Timeline,
  Voiceover,
  jobPaths,
  schemaForPath,
} from "./index.ts";
import { FIXTURES_DIR, FIXTURE_JOB_DIR, readArtifact } from "./node.ts";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  );
  return files.flat();
}

const job = (rel: string) => join(FIXTURE_JOB_DIR, rel);

describe("fixture job dir", () => {
  test("every JSON file is a known artifact and validates", async () => {
    const files = (await walk(FIXTURE_JOB_DIR)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const rel = relative(FIXTURE_JOB_DIR, file);
      const schema = schemaForPath(rel);
      expect(schema, `no schema registered for ${rel}`).toBeDefined();
      await readArtifact(file, schema!);
    }
  });

  test("files agree with each other", async () => {
    const { flows } = await readArtifact(job(jobPaths.flows), FlowsFile);
    const timeline = await readArtifact(job(jobPaths.timeline("desktop")), Timeline);
    const storyboard = await readArtifact(job(jobPaths.storyboard), Storyboard);
    const edl = await readArtifact(job(jobPaths.edl), Edl);
    const flowIds = new Set(flows.map((f) => f.id));
    const stepIds = new Set(flows.flatMap((f) => f.steps.map((s) => s.id)));
    const beatIds = storyboard.beats.map((b) => b.id);

    await access(job(jobPaths.recording("desktop")));
    for (const e of timeline.events) {
      expect(flowIds).toContain(e.flowId);
      expect(stepIds).toContain(e.stepId);
      expect(e.t).toBeLessThanOrEqual(timeline.duration);
    }
    for (const b of storyboard.beats) {
      if (b.flowId) expect(flowIds).toContain(b.flowId);
      if (b.out !== undefined) expect(b.out).toBeLessThanOrEqual(timeline.duration);
    }
    for (const lang of ["en", "hi"]) {
      const script = await readArtifact(job(jobPaths.script(lang)), Script);
      expect(script.segments.map((s) => s.beatId)).toEqual(beatIds);
      const voice = await readArtifact(job(jobPaths.voice(lang)), Voiceover);
      expect(voice.clips.map((c) => c.beatId)).toEqual(beatIds);
      for (const clip of voice.clips) {
        expect(clip.file).toBe(jobPaths.voiceClip(lang, clip.beatId));
        await access(job(clip.file));
        expect(clip.words.at(-1)!.end).toBeLessThanOrEqual(clip.seconds);
      }
    }
    for (const seg of edl.segments) {
      if ("beatId" in seg && seg.beatId) expect(beatIds).toContain(seg.beatId);
      if (seg.kind === "shot") expect(flowIds).toContain(seg.flowId);
    }
  });
});

describe("other fixtures", () => {
  const read = async (name: string) => readFile(join(FIXTURES_DIR, name), "utf8");

  test("job-config.json is a valid POST /jobs body", async () => {
    JobConfig.parse(JSON.parse(await read("job-config.json")));
  });

  test("job-state.json is a valid state.json, waiting at gate 1", async () => {
    const state = Job.parse(JSON.parse(await read("job-state.json")));
    expect(state.status).toBe("waiting");
    expect(state.stages["gate-flows"].status).toBe("waiting");
  });

  test("events.ndjson is a valid, ordered event stream", async () => {
    const events = (await read("events.ndjson"))
      .trim()
      .split("\n")
      .map((line) => JobEvent.parse(JSON.parse(line)));
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.at(-1)).toMatchObject({ type: "job", status: "done" });
  });

  test("changes.json is a valid change report", async () => {
    ChangeReport.parse(JSON.parse(await read("changes.json")));
  });
});
