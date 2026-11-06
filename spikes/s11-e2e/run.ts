// An end-to-end check of the stages after explore: a prepared job folder through the real worker, with
// real LLM calls, so the story, the director and the renders run for real. Spends no TinyFish quota. It
// sets the job folder after loading .env, so a developer's own jobs are never resumed.
//   pnpm --filter @agentcast/spikes e2e --home <folder with jobs/<id>/state.json> --job <id>
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createWorker } from "../../apps/worker/src/index.ts";
import { loadDotEnv } from "../../apps/worker/src/env.ts";

const { values } = parseArgs({ options: { home: { type: "string" }, job: { type: "string" } } });
if (!values.home || !values.job) throw new Error("--home and --job are required");
await loadDotEnv();
process.env.AGENTCAST_HOME = resolve(values.home);
process.env.LOG_LEVEL = "warn";
const worker = createWorker();
const statePath = join(values.home, "jobs", values.job, "state.json");
const started = Date.now();
await worker.orchestrator.resumeAll();
const state = async () => JSON.parse(await readFile(statePath, "utf8")) as { status: string; stages: Record<string, { status: string; startedAt?: string; finishedAt?: string; message?: string; error?: { message: string } }> };
for (;;) {
  const job = await state();
  if (["done", "failed", "cancelled"].includes(job.status)) {
    console.log(`\nJOB ${job.status} in ${Math.round((Date.now() - started) / 1000)} s`);
    for (const [name, s] of Object.entries(job.stages)) {
      const secs = s.startedAt && s.finishedAt ? Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 1000) : "";
      console.log(name.padEnd(14), s.status.padEnd(9), String(secs).padStart(4), s.error?.message?.slice(0, 400) ?? s.message?.slice(0, 120) ?? "");
    }
    break;
  }
  await new Promise((done) => setTimeout(done, 3000));
}
await worker.close();
process.exit(0);
