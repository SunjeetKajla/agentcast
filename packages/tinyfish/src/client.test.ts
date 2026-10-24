import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  TinyFish,
  TinyFishError,
  TinyFishTransportError,
  type RequestLog,
  type SseEvent,
} from "./index";

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
) => void;
let server: Server | undefined;

async function fake(handler: Handler) {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, body));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { agent: base, fetch: `${base}/fetch`, browser: `${base}/browser` };
}

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((r) => server!.close(r));
  server = undefined;
});

const run = (status: string, extra = {}) => ({
  run_id: "r1",
  status,
  goal: "g",
  created_at: "",
  started_at: null,
  finished_at: null,
  num_of_steps: 2,
  result: { ok: true },
  error: null,
  streaming_url: null,
  video_url: null,
  steps: [],
  ...extra,
});

describe("TinyFish client", () => {
  it("sends the key as a header and never logs it", async () => {
    const logs: RequestLog[] = [];
    const endpoints = await fake((req, res, body) => {
      expect(req.headers["x-api-key"]).toBe("secret-key");
      expect(JSON.parse(body)).toMatchObject({
        urls: ["https://a.dev"],
        format: "markdown",
      });
      res.end(JSON.stringify({ results: [], errors: [] }));
    });
    const tf = new TinyFish({
      apiKey: "secret-key",
      endpoints,
      onRequest: (l) => logs.push(l),
    });
    await tf.fetchPages({ urls: ["https://a.dev"] });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain("secret-key");
  });

  it("streams run events and returns the full run", async () => {
    const endpoints = await fake((req, res) => {
      if (req.url === "/v1/automation/run-sse") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"STARTED","run_id":"r1","timestamp":"t"}\n\n');
        res.write(
          'data: {"type":"STREAMING_URL","run_id":"r1","streaming_url":"https://live/1","timestamp":"t"}\r\n\r\n',
        );
        res.write('data: {"type":"PROGRESS","run_id":"r1",');
        res.write('"purpose":"Clicking New","timestamp":"t"}\n\n: comment\n\n');
        res.write(
          'data: {"type":"COMPLETE","run_id":"r1","status":"COMPLETED","result":{"ok":true},"timestamp":"t"}\n\n',
        );
        return; // left open on purpose: the client must stop at COMPLETE
      }
      expect(req.url).toBe("/v1/runs/r1?screenshots=url&html=none");
      // Metadata can lag the COMPLETE event; keep the streamed final status and report.
      res.end(
        JSON.stringify(
          run("RUNNING", {
            result: null,
            steps: [{ id: "s1", action: "Click New" }],
          }),
        ),
      );
    });
    const events: SseEvent[] = [];
    const result = await new TinyFish({ apiKey: "k", endpoints }).runSse(
      { url: "https://a.dev", goal: "g" },
      (e) => events.push(e),
    );
    expect(events.map((e) => e.type)).toEqual([
      "STARTED",
      "STREAMING_URL",
      "PROGRESS",
      "COMPLETE",
    ]);
    expect(result.steps).toHaveLength(1);
    expect(result.status).toBe("COMPLETED");
    expect(result.result).toEqual({ ok: true });
  });

  it("falls back to polling when the stream drops mid-run", async () => {
    let polls = 0;
    const endpoints = await fake((req, res) => {
      if (req.url === "/v1/automation/run-sse") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end('data: {"type":"STARTED","run_id":"r1","timestamp":"t"}\n\n');
        return;
      }
      polls++;
      res.end(JSON.stringify(run(polls < 2 ? "RUNNING" : "COMPLETED")));
    });
    const tf = new TinyFish({ apiKey: "k", endpoints });
    // waitForRun polls every 3 s by default; the fallback should still finish.
    const result = await tf.runSse(
      { url: "https://a.dev", goal: "g" },
      () => {},
    );
    expect(result.status).toBe("COMPLETED");
    expect(polls).toBe(2);
  }, 10_000);

  it("maps API errors and retries GETs on rate limits only", async () => {
    let gets = 0;
    const endpoints = await fake((req, res) => {
      if (req.method === "POST") {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            error: { code: "INVALID_INPUT", message: "goal is required" },
          }),
        );
      }
      gets++;
      if (gets === 1) {
        res.writeHead(429, { "retry-after": "0.05" });
        return res.end(
          JSON.stringify({
            error: { code: "RATE_LIMIT_EXCEEDED", message: "slow down" },
          }),
        );
      }
      res.end(JSON.stringify(run("RUNNING")));
    });
    const tf = new TinyFish({ apiKey: "k", endpoints });
    const err = await tf
      .runAsync({ url: "https://a.dev", goal: "" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TinyFishError);
    expect((err as TinyFishError).code).toBe("INVALID_INPUT");
    expect((err as TinyFishError).retryable).toBe(false);
    expect((await tf.getRun("r1")).status).toBe("RUNNING");
    expect(gets).toBe(2);
  });

  it("recovers a complete SSE report even when the metadata endpoint is unavailable", async () => {
    const endpoints = await fake((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          'data: {"type":"COMPLETE","run_id":"r1","status":"COMPLETED","result":{"recovered":true},"timestamp":"t"}\n\n',
        );
      } else {
        res.writeHead(503);
        res.end("unavailable");
      }
    });
    const result = await new TinyFish({
      apiKey: "k",
      endpoints,
      retryDelayMs: 1,
    }).runSse({ url: "https://a.dev", goal: "g" }, () => {});
    expect(result.status).toBe("COMPLETED");
    expect(result.result).toEqual({ recovered: true });
  });

  it("polls the same run through transient socket failures without resubmitting it", async () => {
    let gets = 0;
    let posts = 0;
    const endpoints = await fake((req, res) => {
      if (req.method === "POST") {
        posts++;
        return res.end(JSON.stringify({ run_id: "r1" }));
      }
      if (++gets <= 3) return req.socket.destroy();
      res.end(JSON.stringify(run("COMPLETED")));
    });
    const tf = new TinyFish({ apiKey: "k", endpoints, retryDelayMs: 1 });
    const id = await tf.runAsync({ url: "https://a.dev", goal: "g" });
    expect((await tf.waitForRun(id, { intervalMs: 1 })).status).toBe(
      "COMPLETED",
    );
    expect(gets).toBe(4);
    expect(posts).toBe(1);
  });

  it("reports transport codes and never retries an ambiguous creation POST", async () => {
    let posts = 0;
    const endpoints = await fake((req) => {
      posts++;
      req.socket.destroy();
    });
    const error = await new TinyFish({
      apiKey: "private-key",
      endpoints,
      retryDelayMs: 1,
    })
      .runAsync({ url: "https://a.dev", goal: "g" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(TinyFishTransportError);
    expect(error.message).toMatch(
      /TinyFish POST.*(?:UND_ERR_SOCKET|NETWORK_ERROR)/,
    );
    expect(error.message).not.toContain("private-key");
    expect(posts).toBe(1);
  });

  it("retries a truncated GET response body and returns the intact result", async () => {
    let gets = 0;
    const endpoints = await fake((_req, res) => {
      if (++gets === 1) return res.end('{"run_id":');
      res.end(JSON.stringify(run("COMPLETED")));
    });
    expect(
      (
        await new TinyFish({ apiKey: "k", endpoints, retryDelayMs: 1 }).getRun(
          "r1",
        )
      ).status,
    ).toBe("COMPLETED");
    expect(gets).toBe(2);
  });

  it("bounds missing SSE headers but keeps an established stream alive until COMPLETE", async () => {
    let respond = false;
    const endpoints = await fake((req, res) => {
      if (req.method === "GET")
        return res.end(JSON.stringify(run("COMPLETED")));
      if (!respond) return;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      setTimeout(
        () =>
          res.end(
            'data: {"type":"COMPLETE","run_id":"r1","status":"COMPLETED","timestamp":"t"}\n\n',
          ),
        80,
      );
    });
    const tf = new TinyFish({ apiKey: "k", endpoints, requestTimeoutMs: 30 });
    await expect(
      tf.runSse({ url: "https://a.dev", goal: "g" }, () => {}),
    ).rejects.toThrow(/REQUEST_TIMEOUT/);
    respond = true;
    expect(
      (await tf.runSse({ url: "https://a.dev", goal: "g" }, () => {})).status,
    ).toBe("COMPLETED");
  });

  it("does not retry a watchdog callback or cancelled polling", async () => {
    let gets = 0;
    const endpoints = await fake((_req, res) => {
      gets++;
      res.end(JSON.stringify(run("RUNNING")));
    });
    const tf = new TinyFish({ apiKey: "k", endpoints, retryDelayMs: 1 });
    await expect(
      tf.waitForRun("r1", {
        intervalMs: 1,
        onUpdate: () => {
          throw new Error("stalled");
        },
      }),
    ).rejects.toThrow("stalled");
    expect(gets).toBe(1);
    const abort = new AbortController();
    abort.abort(new Error("user cancelled"));
    await expect(tf.waitForRun("r1", { signal: abort.signal })).rejects.toThrow(
      "user cancelled",
    );
    expect(gets).toBe(1);
  });

  it("refuses to start without a key", () => {
    const saved = process.env.TINYFISH_API_KEY;
    delete process.env.TINYFISH_API_KEY;
    try {
      expect(() => new TinyFish()).toThrow(/TINYFISH_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.TINYFISH_API_KEY = saved;
    }
  });
});
