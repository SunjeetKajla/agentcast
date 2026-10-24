import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowsFile, Job, JobConfig, JobEvent, Script, jobPaths, type JobConfigInput } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createWorker, type Worker } from "./index.ts";
import { Orchestrator } from "./orchestrator.ts";
import { gates, stages, type StageRegistry } from "./stages/index.ts";
import type { StageContext } from "./context";
import { buildServer } from "./server";
import { JobStore } from "./store.ts";

const silent = pino({ level: "silent" });
const workers: Worker[] = [];
let home: string;

beforeEach(async () => {
  process.env.AGENTCAST_STUB_DELAY_MS = "0";
  home = await mkdtemp(join(tmpdir(), "agentcast-worker-"));
});

afterEach(async () => {
  await Promise.all(workers.splice(0).map((w) => w.close()));
});

function start(): Worker {
  const worker = createWorker({ home, logger: silent });
  workers.push(worker);
  return worker;
}

function startWith(
  override: Partial<StageRegistry>,
  gateOverride: Partial<typeof gates> = {},
): Worker {
  const store = new JobStore(home);
  const orchestrator = new Orchestrator(
    store,
    { ...stages, ...override },
    { ...gates, ...gateOverride },
    silent,
  );
  const app = buildServer(orchestrator, store, silent);
  const worker: Worker = {
    app,
    orchestrator,
    store,
    log: silent,
    close: async () => {
      await app.close();
      await orchestrator.shutdown();
    },
  };
  workers.push(worker);
  return worker;
}

const config = (extra: Partial<JobConfigInput> = {}): JobConfigInput => ({
  url: "https://demoboard.vercel.app/",
  variants: {
    aspects: ["16x9", "9x16"],
    langs: ["en", "hi"],
    formFactors: ["desktop"],
  },
  ...extra,
});

async function create(worker: Worker, body: JobConfigInput): Promise<Job> {
  const res = await worker.app.inject({
    method: "POST",
    url: "/jobs",
    payload: body,
  });
  expect(res.statusCode).toBe(202);
  return res.json();
}

async function until(worker: Worker, id: string, done: (job: Job) => boolean): Promise<Job> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const job = await worker.orchestrator.get(id);
    if (job && done(job)) return job;
    if (Date.now() > deadline) throw new Error(`timed out; job is ${JSON.stringify(job?.status)}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const waitingAt = (gate: string) => (job: Job) => job.stages[gate as keyof Job["stages"]].status === "waiting";

function decide(worker: Worker, id: string, gate: string, payload: unknown) {
  return worker.app.inject({
    method: "POST",
    url: `/jobs/${id}/gates/${gate}`,
    payload: payload as object,
  });
}

describe("a job through the stub pipeline", () => {
  test("stops at each gate, applies decisions, revises the preview, and renders every variant", async () => {
    const worker = start();
    const { id } = await create(worker, config());
    const dir = join(home, "jobs", id);

    // Gate 1: reorder, select both, rename one.
    let job = await until(worker, id, waitingAt("gate-flows"));
    expect(job.status).toBe("waiting");
    expect(job.stages.auth.status).toBe("skipped");
    let res = await decide(worker, id, "gate-flows", {
      action: "approve",
      flows: [
        { id: "flow-export", selected: true },
        { id: "flow-template", selected: true, title: "Start from a template" },
      ],
    });
    expect(res.statusCode).toBe(202);
    const { flows } = await readArtifact(join(dir, jobPaths.flows), FlowsFile);
    expect(flows.map((f) => [f.id, f.rank, f.selected])).toEqual([
      ["flow-export", 1, true],
      ["flow-template", 2, true],
    ]);
    expect(flows[1]!.title).toBe("Start from a template");

    // Gate 2: edit a Hindi line.
    await until(worker, id, waitingAt("gate-script"));
    res = await decide(worker, id, "gate-script", {
      action: "approve",
      edits: [{ lang: "hi", beatId: "b-cta", text: "अभी आज़माएँ।" }],
    });
    expect(res.statusCode).toBe(202);
    const hi = await readArtifact(join(dir, jobPaths.script("hi")), Script);
    expect(hi.segments.find((s) => s.beatId === "b-cta")!.text).toBe("अभी आज़माएँ।");

    // Gate 3: revise once, then approve.
    job = await until(worker, id, waitingAt("gate-preview"));
    expect(job.stages.direct.attempts).toBe(1);
    res = await decide(worker, id, "gate-preview", {
      action: "revise",
      revise: "Zoom harder on the template",
    });
    expect(res.statusCode).toBe(202);
    job = await until(worker, id, (j) => waitingAt("gate-preview")(j) && j.stages.direct.attempts === 2);
    expect(job.stages.preview.attempts).toBe(2);
    res = await decide(worker, id, "gate-preview", { action: "approve" });
    expect(res.statusCode).toBe(202);

    job = await until(worker, id, (j) => j.status === "done");
    for (const v of ["16x9-en", "9x16-en", "16x9-hi", "9x16-hi"]) {
      await readFile(join(dir, jobPaths.output(v, "mp4")));
    }

    // state.json and events.ndjson on disk agree with what the API said.
    await worker.orchestrator.flush();
    expect((await readArtifact(join(dir, jobPaths.state), Job)).status).toBe("done");
    const events = (await readFile(join(dir, jobPaths.events), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JobEvent.parse(JSON.parse(line)));
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.at(-1)).toMatchObject({ type: "job", status: "done" });
    expect(events.some((e) => e.type === "agent")).toBe(true);
    expect(events.some((e) => e.type === "artifact" && e.path === jobPaths.edl)).toBe(true);
  });

  test("autopilot runs to the end with no decisions", async () => {
    const worker = start();
    const { id } = await create(worker, config({ autopilot: true }));
    const job = await until(worker, id, (j) => j.status === "done");
    expect(job.stages["gate-flows"].message).toBe("Approved on autopilot");
  });

  test("a failing stage fails the job, says why, and starts nothing after it", async () => {
    const store = new JobStore(home);
    const failing = {
      ...stages,
      record: async () => Promise.reject(new Error("Chrome crashed")),
    };
    const orchestrator = new Orchestrator(store, failing, gates, silent);
    const { id } = await orchestrator.create(JobConfig.parse(config({ autopilot: true })));
    const job = await until({ orchestrator } as Worker, id, (j) => j.status === "failed");
    expect(job.stages.record).toMatchObject({
      status: "failed",
      error: { message: "Chrome crashed" },
    });
    expect(job.stages.script.status).toBe("pending");
    await orchestrator.flush();
  });
});

describe("gates", () => {
  test("keeps review open when a client approves a failed rehearsal or no flows",async()=>{
    const worker=start();
    const {id}=await create(worker,config());
    await until(worker,id,waitingAt("gate-flows"));
    const path=join(home,"jobs",id,jobPaths.flows);
    const file=await readArtifact(path,FlowsFile);
    file.flows[0]!.rehearsal={ok:false,reason:"An overlay prevented the click"};
    await writeArtifact(path,FlowsFile,file);
    const response=await decide(worker,id,"gate-flows",{action:"approve",flows:[{id:file.flows[0]!.id,selected:true}]});
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("rehearsal failed");
    expect((await worker.orchestrator.get(id))?.stages["gate-flows"].status).toBe("waiting");
    const empty=await decide(worker,id,"gate-flows",{action:"approve",flows:file.flows.map(flow=>({id:flow.id,selected:false}))});
    expect(empty.statusCode).toBe(400);
  });
  test("rejects unknown gates, early decisions, bad bodies and unknown flows", async () => {
    const worker = start();
    const { id } = await create(worker, config());
    expect((await decide(worker, id, "gate-nope", { action: "approve" })).statusCode).toBe(404);
    expect((await decide(worker, id, "gate-script", { action: "approve" })).statusCode).toBe(409);
    await until(worker, id, waitingAt("gate-flows"));
    expect((await decide(worker, id, "gate-flows", { action: "yes" })).statusCode).toBe(400);
    const res = await decide(worker, id, "gate-flows", {
      action: "approve",
      flows: [{ id: "flow-ghost", selected: true }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/flow-ghost/);
    const job = await worker.orchestrator.get(id);
    expect(job!.stages["gate-flows"].status).toBe("waiting");
  });
});

describe("gate actions", () => {
  test("run in the background while the gate waits, one at a time, and report how they went", async () => {
    const store = new JobStore(home);
    let finish!: () => void;
    const actions = {
      "gate-flows": {
        "edit-step": {
          schema: z.object({ text: z.string().min(1) }),
          run: () => new Promise<unknown>((resolve) => (finish = () => resolve({ title: "Create" }))),
          done: (r: unknown) => `edited ${(r as { title: string }).title}`,
        },
        "add-flow": {
          schema: z.object({}),
          run: async () => Promise.reject(new Error("TinyFish run failed")),
          done: () => "added",
        },
      },
    };
    const orchestrator = new Orchestrator(store, stages, gates, silent, actions);
    const { id } = await orchestrator.create(JobConfig.parse(config()));
    await expect(orchestrator.act(id, "gate-flows", "edit-step", { text: "x" })).rejects.toMatchObject({ status: 409 });
    await until({ orchestrator } as Worker, id, waitingAt("gate-flows"));
    await expect(orchestrator.act(id, "gate-flows", "nope", {})).rejects.toMatchObject({ status: 404 });
    await expect(orchestrator.act(id, "gate-flows", "edit-step", { text: "" })).rejects.toMatchObject({ status: 400 });

    await expect(orchestrator.act(id, "gate-flows", "edit-step", { text: "Create" })).resolves.toEqual({
      accepted: true,
    });
    // Still working: no second action, no decision.
    await expect(orchestrator.act(id, "gate-flows", "add-flow", {})).rejects.toMatchObject({ status: 409 });
    await expect(orchestrator.decide(id, "gate-flows", { action: "approve" })).rejects.toMatchObject({ status: 409 });
    finish();
    const bus = (await orchestrator.events(id))!;
    const actionEvents = async (n: number) => {
      for (let i = 0; i < 100; i++) {
        const found = bus.since(0).filter((e) => e.type === "action");
        if (found.length >= n) return found;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("no action events");
    };
    expect((await actionEvents(2)).map((e) => e.type === "action" && [e.name, e.status, e.message])).toEqual([
      ["edit-step", "started", undefined],
      ["edit-step", "done", "edited Create"],
    ]);
    await orchestrator.act(id, "gate-flows", "add-flow", {});
    const events = await actionEvents(4);
    expect(events.at(-1)).toMatchObject({
      name: "add-flow",
      status: "failed",
      message: "TinyFish run failed",
    });
    expect((await orchestrator.get(id))!.stages["gate-flows"].status).toBe("waiting");
    await orchestrator.decide(id, "gate-flows", { action: "approve" });
    await orchestrator.cancel(id);
    await orchestrator.flush();
  });

  test("are reachable over HTTP", async () => {
    const worker = start();
    const { id } = await create(worker, config());
    await until(worker, id, waitingAt("gate-flows"));
    const res = await worker.app.inject({
      method: "POST",
      url: `/jobs/${id}/gates/gate-flows/actions/add-flow`,
      payload: { description: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(
      (
        await worker.app.inject({
          method: "POST",
          url: `/jobs/${id}/gates/gate-nope/actions/add-flow`,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("API", () => {
  test("validates new jobs and 404s unknown ones", async () => {
    const worker = start();
    expect(
      (
        await worker.app.inject({
          method: "POST",
          url: "/jobs",
          payload: { url: "ftp://x" },
        })
      ).statusCode,
    ).toBe(400);
    expect((await worker.app.inject({ url: "/jobs/job_nope" })).statusCode).toBe(404);
    expect((await worker.app.inject({ url: "/jobs/..%2F..%2Fetc" })).statusCode).toBe(404);
    const { id } = await create(worker, config());
    const list = (await worker.app.inject({ url: "/jobs" })).json();
    expect(list.jobs.map((j: Job) => j.id)).toEqual([id]);
  });

  test("serves job files with ranges, but nothing outside the job or under auth/", async () => {
    const worker = start();
    const { id } = await create(worker, config({ autopilot: true }));
    await until(worker, id, (j) => j.status === "done");
    const dir = join(home, "jobs", id);
    await mkdir(join(dir, "auth"), { recursive: true });
    await writeFile(join(dir, "auth", "session.enc"), "sealed");

    const full = await worker.app.inject({
      url: `/files/${id}/${jobPaths.recording("desktop")}`,
    });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("video/mp4");
    const part = await worker.app.inject({
      url: `/files/${id}/${jobPaths.recording("desktop")}`,
      headers: { range: "bytes=0-99" },
    });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(100);
    expect(part.headers["content-range"]).toMatch(/^bytes 0-99\/\d+$/);

    for (const path of ["auth/session.enc", "../../secret.key", "%2E%2E/%2E%2E/secret.key", "missing.json"]) {
      expect((await worker.app.inject({ url: `/files/${id}/${path}` })).statusCode, path).toBe(404);
    }
  });

  test("streams events over SSE, resuming after Last-Event-ID", async () => {
    const worker = start();
    const { id } = await create(worker, config({ autopilot: true }));
    await until(worker, id, (j) => j.status === "done");
    await worker.app.listen({ host: "127.0.0.1", port: 0 });
    const address = worker.app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${address.port}/jobs/${id}/events`, {
      headers: { "last-event-id": "3" },
    });
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes('"status":"done"}')) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(4);
    expect(ids).toEqual(ids.map((_, i) => i + 4));
  });
});

describe("lifecycle", () => {
  test("cancel aborts active work before replying, persists it, and suppresses late activity", async () => {
    let stageContext!: StageContext;
    let stopped = false;
    const worker = startWith({
      understand: async (ctx) => {
        stageContext = ctx;
        ctx.emit({
          type: "agent",
          stage: "understand",
          agentId: "active-agent",
          title: "Active work",
          status: "started",
        });
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener(
            "abort",
            () => {
              stopped = true;
              resolve();
            },
            { once: true },
          ),
        );
      },
    });
    const { id } = await create(worker, config());
    await until(
      worker,
      id,
      (job) =>
        job.stages.understand.status === "running" && Boolean(stageContext),
    );
    const started = performance.now();
    const res = await worker.app.inject({
      method: "POST",
      url: `/jobs/${id}/cancel`,
    });
    expect(res.statusCode).toBe(202);
    expect(performance.now() - started).toBeLessThan(500);
    expect(stopped).toBe(true);
    expect(
      (await readArtifact(join(home, "jobs", id, jobPaths.state), Job)).status,
    ).toBe("cancelled");
    const bus = (await worker.orchestrator.events(id))!;
    const before = bus.since(0).length;
    stageContext.progress(0.9, "should not revive");
    stageContext.llmProgress({ kind: "text", text: "should not revive" });
    stageContext.emit({
      type: "agent",
      stage: "understand",
      agentId: "active-agent",
      title: "Active work",
      status: "step",
    });
    expect(bus.since(0)).toHaveLength(before);
    expect(
      bus
        .since(0)
        .filter((event) => event.type === "agent")
        .at(-1),
    ).toMatchObject({ status: "cancelled" });
    expect((await worker.orchestrator.get(id))?.stages.discover.status).toBe(
      "cancelled",
    );
  });

  test("a gate completion arriving after cancellation cannot reopen or finish the cancelled gate", async () => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const work = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = startWith(
      {},
      {
        "gate-flows": async () => {
          entered();
          await work;
        },
      },
    );
    const { id } = await create(worker, config());
    await until(worker, id, waitingAt("gate-flows"));
    const pending = decide(worker, id, "gate-flows", { action: "approve" });
    // Fastify inject is lazy until its promise is awaited/subscribed.
    const deciding = pending.then((response) => response);
    await ready;
    await worker.app.inject({ method: "POST", url: `/jobs/${id}/cancel` });
    release();
    await deciding;
    const job = await worker.orchestrator.get(id);
    expect(job?.status).toBe("cancelled");
    expect(job?.stages["gate-flows"].status).toBe("cancelled");
    expect(job?.stages.record.status).toBe("cancelled");
  });
  test("cancel stops the job", async () => {
    process.env.AGENTCAST_STUB_DELAY_MS = "10000";
    const worker = start();
    const { id } = await create(worker, config());
    const res = await worker.app.inject({
      method: "POST",
      url: `/jobs/${id}/cancel`,
    });
    expect(res.statusCode).toBe(202);
    const job = res.json() as Job;
    expect(job.status).toBe("cancelled");
    expect(job.stages.understand.status).toBe("cancelled");
    expect((await worker.app.inject({ method: "POST", url: `/jobs/${id}/cancel` })).statusCode).toBe(202);
    expect((await readArtifact(join(home, "jobs", id, jobPaths.state), Job)).status).toBe("cancelled");
  });

  test("a restarted worker resumes running stages and waiting gates", async () => {
    process.env.AGENTCAST_STUB_DELAY_MS = "10000";
    const first = start();
    const { id } = await create(first, config({ autopilot: true }));
    await until(first, id, (j) => j.stages.understand.status === "running");
    await first.close();

    process.env.AGENTCAST_STUB_DELAY_MS = "0";
    const second = start();
    expect(await second.orchestrator.resumeAll()).toEqual([id]);
    const job = await until(second, id, (j) => j.status === "done");
    expect(job.stages.understand.attempts).toBe(2);
  });
});
