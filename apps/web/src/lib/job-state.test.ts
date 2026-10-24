import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Job, JobEvent } from "@agentcast/shared";
import { FIXTURES_DIR } from "@agentcast/shared/node";
import { describe, expect, test } from "vitest";
import { initialView, overallProgress, reduceJob, waitingGate, type JobView } from "./job-state";

const fixture = async () => {
  const state = Job.parse(JSON.parse(await readFile(join(FIXTURES_DIR, "job-state.json"), "utf8")));
  const events = (await readFile(join(FIXTURES_DIR, "events.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JobEvent.parse(JSON.parse(l)));
  // Start from a fresh job: every stage pending, as POST /jobs returns it.
  const fresh: Job = {
    ...state,
    status: "queued",
    stages: Object.fromEntries(Object.keys(state.stages).map((k) => [k, { status: "pending", attempts: 0 }])) as Job["stages"],
  };
  return { fresh, events };
};

const replay = (view: JobView, events: JobEvent[]) => events.reduce((v, e) => reduceJob(v, { type: "event", event: e }), view);

describe("reduceJob", () => {
  test("replaying a full run ends where the worker ended", async () => {
    const { fresh, events } = await fixture();
    const view = replay(initialView(fresh), events);
    expect(view.job.status).toBe("done");
    expect(Object.values(view.job.stages).every((s) => s.status === "done" || s.status === "skipped")).toBe(true);
    expect(view.job.stages.auth.status).toBe("skipped");
    expect(view.lastSeq).toBe(events.length);
    expect(overallProgress(view.job)).toBe(1);
  });

  test("stops at gate 1 halfway through, waiting for a review", async () => {
    const { fresh, events } = await fixture();
    const upToGate = events.slice(0, events.findIndex((e) => e.type === "stage" && e.stage === "gate-flows") + 1);
    const view = replay(initialView(fresh), upToGate);
    expect(waitingGate(view.job)).toBe("gate-flows");
    expect(view.job.stages.understand.status).toBe("done");
    expect(view.job.stages.record.status).toBe("pending");
    // The flows file was announced, so the review can load it.
    expect(view.artifacts["explore/flows.json"]).toBeGreaterThan(0);
  });

  test("tracks each agent's live view and steps", async () => {
    const { fresh, events } = await fixture();
    const view = replay(initialView(fresh), events);
    const template = view.agents.find((a) => a.agentId === "flow-template")!;
    expect(template).toMatchObject({ status: "done", title: "Create a project from a template" });
    expect(template.streamingUrl).toMatch(/^https:\/\//);
    expect(template.steps).toEqual(["Clicked 'New project'"]);
  });

  test("ignores events it has already seen and events for other jobs", async () => {
    const { fresh, events } = await fixture();
    const once = replay(initialView(fresh), events);
    expect(replay(once, events)).toBe(once);
    const stranger = { ...events[5]!, seq: events.length + 1, jobId: "job_other" };
    expect(reduceJob(once, { type: "event", event: stranger })).toBe(once);
  });

  test("a snapshot replaces the job (e.g. after a gate decision)", async () => {
    const { fresh } = await fixture();
    const view = initialView(fresh);
    const next = reduceJob(view, { type: "snapshot", job: { ...fresh, status: "running" } });
    expect(next.job.status).toBe("running");
  });
});
