import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { GateName, JobConfig } from "@agentcast/shared";
import Fastify, { LogController } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import { WorkerError } from "./errors.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { JobStore } from "./store.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".ndjson": "application/x-ndjson; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".srt": "application/x-subrip; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/** Never served: the sealed sign-in session and anything like it (AGENTS.md rule 5). */
const PRIVATE = [/^auth(\/|$)/, /\.enc$/, /(^|\/)\./];

type IdParams = { id: string };

/**
 * The worker API (PRD §7.4). Handlers only read state or hand work to the orchestrator; nothing slow
 * runs in a request (AGENTS.md rule 4).
 */
export function buildServer(orchestrator: Orchestrator, store: JobStore, logger: Logger) {
  const app = Fastify({ loggerInstance: logger, logController: new LogController({ disableRequestLogging: true }) });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof WorkerError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/jobs", async () => ({ jobs: await orchestrator.list() }));

  app.post("/jobs", async (req, reply) => {
    const parsed = JobConfig.safeParse(req.body ?? {});
    if (!parsed.success) throw new WorkerError(400, z.prettifyError(parsed.error));
    return reply.code(202).send(await orchestrator.create(parsed.data));
  });

  app.get<{ Params: IdParams }>("/jobs/:id", async (req) => {
    const job = await orchestrator.get(req.params.id);
    if (!job) throw new WorkerError(404, `no job ${req.params.id}`);
    return job;
  });

  app.post<{ Params: IdParams & { gate: string } }>("/jobs/:id/gates/:gate", async (req, reply) => {
    const gate = GateName.safeParse(req.params.gate);
    if (!gate.success) throw new WorkerError(404, `no gate ${req.params.gate}`);
    return reply.code(202).send(await orchestrator.decide(req.params.id, gate.data, req.body ?? {}));
  });

  app.post<{ Params: IdParams }>("/jobs/:id/cancel", async (req, reply) =>
    reply.code(202).send(await orchestrator.cancel(req.params.id)),
  );

  // Server-sent events: replays the job's events after Last-Event-ID (or ?after=), then follows live ones.
  app.get<{ Params: IdParams; Querystring: { after?: string } }>("/jobs/:id/events", async (req, reply) => {
    const bus = await orchestrator.events(req.params.id);
    if (!bus) throw new WorkerError(404, `no job ${req.params.id}`);
    const after = Number(req.headers["last-event-id"] ?? req.query.after ?? 0) || 0;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (e: { seq: number }) => res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
    for (const e of bus.since(after)) send(e);
    const unsubscribe = bus.subscribe(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      unsubscribe();
      clearInterval(ping);
    });
  });

  // Job files (recordings, frames, outputs) for the web app, with byte ranges so videos can seek.
  app.get<{ Params: IdParams & { "*": string } }>("/files/:id/*", async (req, reply) => {
    const dir = store.dir(req.params.id);
    const file = resolve(dir, req.params["*"]);
    const rel = relative(dir, file).split(sep).join("/");
    if (!file.startsWith(dir + sep) || PRIVATE.some((p) => p.test(rel))) throw new WorkerError(404, "not found");
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) throw new WorkerError(404, "not found");

    reply.header("content-type", CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
    reply.header("accept-ranges", "bytes");
    reply.header("cache-control", "no-cache");
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        return reply.code(416).header("content-range", `bytes */${info.size}`).send();
      }
      reply.code(206).header("content-range", `bytes ${start}-${end}/${info.size}`);
      reply.header("content-length", end - start + 1);
      return reply.send(createReadStream(file, { start, end }));
    }
    reply.header("content-length", info.size);
    return reply.send(createReadStream(file));
  });

  return app;
}
