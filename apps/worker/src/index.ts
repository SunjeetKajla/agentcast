// @agentcast/worker: Fastify worker and orchestrator; stages in src/stages/, one file each (PRD §7.4).
// createWorker() is also how the CLI runs the pipeline in-process when no worker is up.
import { pino, type Logger } from "pino";
import { agentcastHome } from "./env.ts";
import { Orchestrator } from "./orchestrator.ts";
import { buildServer } from "./server.ts";
import { gates, stages } from "./stages/index.ts";
import { JobStore } from "./store.ts";

export type Worker = {
  app: ReturnType<typeof buildServer>;
  orchestrator: Orchestrator;
  store: JobStore;
  log: Logger;
  close(): Promise<void>;
};

export function createWorker(opts: { home?: string; logger?: Logger } = {}): Worker {
  const log = opts.logger ?? pino({ level: process.env.LOG_LEVEL || "info" });
  const store = new JobStore(opts.home ?? agentcastHome());
  const orchestrator = new Orchestrator(store, stages, gates, log);
  const app = buildServer(orchestrator, store, log);
  return {
    app,
    orchestrator,
    store,
    log,
    async close() {
      await app.close();
      await orchestrator.shutdown();
    },
  };
}

export { agentcastHome, loadDotEnv, workerAddress } from "./env.ts";
export type { StageContext } from "./context.ts";
export type { StageFn, StageResult } from "./stages/index.ts";
