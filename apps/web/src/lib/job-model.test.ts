import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Job, JobEvent, STAGES, type StageStatus } from "@agentcast/shared";
import { FIXTURES_DIR } from "@agentcast/shared/node";
import { describe, expect, test } from "vitest";
import { initialView, reduceJob } from "./job-state";
import { currentStage, elapsed, facts, fieldState, finding, timeline } from "./job-model";

const T0 = Date.parse("2026-11-07T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

/** A job created at T0 whose stages ran as given: [stage, status, startSec?, endSec?]. */
async function jobWith(rows: [string, StageStatus, number?, number?][], status: Job["status"], extra: Partial<Job["config"]> = {}): Promise<Job> {
  const base = Job.parse(JSON.parse(await readFile(join(FIXTURES_DIR, "job-state.json"), "utf8")));
  const stages = Object.fromEntries(STAGES.map((s) => [s.name, { status: "pending", attempts: 0 }])) as Job["stages"];
  for (const [name, st, a, b] of rows) {
    stages[name as keyof typeof stages] = { status: st, attempts: 1, startedAt: a === undefined ? undefined : at(a), finishedAt: b === undefined ? undefined : at(b) };
  }
  return { ...base, createdAt: at(0), updatedAt: at(0), status, stages, config: { ...base.config, ...extra } };
}

describe("the job page model", () => {
  test("a running job: the stage, the colour, and a timeline that ends at now with estimates after", async () => {
    const job = await jobWith([["understand", "done", 0, 21], ["auth", "skipped"], ["discover", "done", 21, 129], ["flow-runs", "running", 129]], "running");
    const now = T0 + 160_000;
    expect(currentStage(job)).toBe("flow-runs");
    expect(fieldState(job)).toBe("run");
    expect(elapsed(job, now)).toBe(160);
    const { clips, now: t } = timeline(job, now);
    expect(t).toBe(160);
    const byStage = Object.fromEntries(clips.map((c) => [c.stage, c]));
    expect(byStage["discover"]).toMatchObject({ a: 21, b: 129, estimated: false });
    expect(byStage["flow-runs"]).toMatchObject({ a: 129, b: 160, estimated: false });
    // What's to come starts at now and runs end to end.
    expect(byStage["gate-flows"]!.a).toBe(160);
    expect(byStage["record"]!.a).toBe(byStage["gate-flows"]!.b);
    expect(byStage["record"]!.estimated).toBe(true);
    expect(clips.every((c) => c.lane === 0)).toBe(true);
  });

  test("stages that ran side by side get a second lane", async () => {
    const job = await jobWith([["understand", "done", 0, 30], ["auth", "done", 2, 80], ["discover", "running", 80]], "running", { auth: { mode: "sign-in-once" } });
    const lanes = Object.fromEntries(timeline(job, T0 + 90_000).clips.map((c) => [c.stage, c.lane]));
    expect(lanes).toMatchObject({ understand: 0, auth: 1, discover: 0 });
  });

  test("sign-in takes the field while it runs, though Understand runs beside it", async () => {
    const job = await jobWith([["understand", "running", 0], ["auth", "running", 0]], "running", { auth: { mode: "sign-in-once" } });
    expect(currentStage(job)).toBe("auth");
    expect(finding(job)).toContain("Sign in through the Chrome window");
  });

  test("a waiting gate turns the field yellow and says what to do", async () => {
    const job = await jobWith([["understand", "done", 0, 21], ["discover", "done", 21, 129], ["flow-runs", "done", 129, 201], ["gate-flows", "waiting", 201]], "waiting");
    expect(currentStage(job)).toBe("gate-flows");
    expect(fieldState(job)).toBe("wait");
    expect(finding(job, { total: 4, selected: 3 })).toBe("4 flows rehearsed, 3 picked by the judge. Nothing is filmed until you approve.");
  });

  test("a finished job measures to its last stage, not to now", async () => {
    const rows = STAGES.map((s, i): [string, "done", number, number] => [s.name, "done", i * 10, i * 10 + 10]);
    const job = await jobWith(rows, "done");
    expect(fieldState(job)).toBe("done");
    expect(elapsed(job, T0 + 10_000_000)).toBe(STAGES.length * 10);
    expect(timeline(job, T0 + 10_000_000).clips.some((c) => c.estimated)).toBe(false);
  });

  test("a failure names the stage and the reason", async () => {
    const job = await jobWith([["understand", "done", 0, 21], ["discover", "failed", 21, 40]], "failed");
    job.stages.discover.error = { message: "TinyFish blocked the run" };
    expect(fieldState(job)).toBe("fail");
    expect(finding(job)).toBe("Explore failed: TinyFish blocked the run");
  });

  test("a cancelled job stopped in the stage that was running, not the last one marked cancelled", async () => {
    const job = await jobWith([["understand", "done", 0, 21], ["discover", "done", 21, 40], ["flow-runs", "cancelled", 40, 55], ["record", "cancelled"], ["render", "cancelled"]], "cancelled");
    expect(currentStage(job)).toBe("flow-runs");
    expect(finding(job)).toBe("Cancelled during Try flows. The stages that finished are kept with the job.");
  });

  test("the facts say what was asked for", async () => {
    const job = await jobWith([], "queued", { mode: "launch", voiceover: false, autopilot: true, stylePrompt: "" });
    const f = Object.fromEntries(facts(job));
    expect(f["Video"]).toBe("Launch video, music-led");
    expect(f["Review gates"]).toBe("Off: runs on autopilot");
    expect(f["Your prompt"]).toBe("None");
  });

  test("replaying the fixture's events ends on a coherent finished page", async () => {
    const state = Job.parse(JSON.parse(await readFile(join(FIXTURES_DIR, "job-state.json"), "utf8")));
    const events = (await readFile(join(FIXTURES_DIR, "events.ndjson"), "utf8")).trim().split("\n").map((l) => JobEvent.parse(JSON.parse(l)));
    const fresh: Job = { ...state, status: "queued", stages: Object.fromEntries(STAGES.map((s) => [s.name, { status: "pending", attempts: 0 }])) as Job["stages"] };
    const view = events.reduce((v, e) => reduceJob(v, { type: "event", event: e }), initialView(fresh));
    const { clips, total } = timeline(view.job, Date.now());
    for (const c of clips) {
      expect(c.b).toBeGreaterThanOrEqual(c.a);
      expect(c.b).toBeLessThanOrEqual(total);
    }
  });
});
