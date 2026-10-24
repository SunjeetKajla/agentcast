// pnpm dev:worker: loads .env, resumes unfinished jobs, listens on WORKER_URL.
import { createWorker } from "./index.ts";
import { loadDotEnv, workerAddress } from "./env.ts";

const overrode = await loadDotEnv();
const worker = createWorker();
if (overrode.length) worker.log.info(`.env overrode your shell's ${overrode.join(", ")}`);

const { host, port } = workerAddress();
await worker.app.listen({ host, port });
worker.log.info(`worker on http://${host}:${port}, jobs in ${worker.store.jobsDir}`);

const resumed = await worker.orchestrator.resumeAll();
if (resumed.length) worker.log.info(`resumed ${resumed.join(", ")}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    worker.log.info("shutting down");
    void worker.close().finally(() => process.exit(0));
  });
}
