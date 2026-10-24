import { readSse } from "./sse";
import {
  TERMINAL,
  type AgentRequest,
  type BrowserSession,
  type FetchRequest,
  type FetchResponse,
  type Profile,
  type ProfileUpload,
  type ProfileUploadResult,
  type Run,
  type RunError,
  type SseEvent,
  type VaultItem,
} from "./types";

export const ENDPOINTS = {
  agent: "https://agent.tinyfish.ai",
  fetch: "https://api.fetch.tinyfish.ai",
  browser: "https://api.browser.tinyfish.ai",
};

/** One finished HTTP call, for logs. Never carries the key or request bodies. */
export type RequestLog = {
  method: string;
  url: string;
  status: number;
  ms: number;
};

export type TinyFishOptions = {
  apiKey?: string;
  endpoints?: Partial<typeof ENDPOINTS>;
  onRequest?: (log: RequestLog) => void;
  retryDelayMs?: number;
  /** Override HTTP deadlines (primarily for local tests). SSE body lifetime remains caller-owned. */
  requestTimeoutMs?: number;
};

export class TinyFishError extends Error {
  override name = "TinyFishError";
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** Seconds to wait before retrying, when the API suggests it. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
  /** Rate limits and server-side failures; bad input and auth errors aren't worth retrying. */
  get retryable() {
    return (
      this.status === 429 || this.status >= 500 || this.code === "SERVICE_BUSY"
    );
  }
}

/** A failed HTTP exchange, distinct from a provider-reported agent failure. Never includes keys. */
export class TinyFishTransportError extends TinyFishError {
  override name = "TinyFishTransportError";
  constructor(
    readonly method: string,
    readonly endpoint: string,
    readonly transportCode: string,
  ) {
    super(
      `TinyFish ${method} ${endpoint}: ${transportCode}`,
      503,
      transportCode,
    );
  }
}

type Call = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  raw?: boolean;
};

/**
 * Thin typed client for the TinyFish APIs (plan Phase 1 task 4). Worker-only: the key stays here.
 * GETs retry once on rate limits and server errors; POSTs that create runs never retry, since the
 * API has no idempotency keys and a retry could start a duplicate run.
 */
export class TinyFish {
  private readonly key: string;
  private readonly ep: typeof ENDPOINTS;

  constructor(private readonly opts: TinyFishOptions = {}) {
    const key = opts.apiKey ?? process.env.TINYFISH_API_KEY;
    if (!key)
      throw new TinyFishError(
        "TINYFISH_API_KEY is not set. Add it to .env.",
        401,
        "MISSING_API_KEY",
      );
    this.key = key;
    this.ep = { ...ENDPOINTS, ...opts.endpoints };
  }

  // Fetch API

  /** Up to 10 URLs per call; per-URL failures come back in `errors`, not as a thrown error. */
  fetchPages(req: FetchRequest, signal?: AbortSignal): Promise<FetchResponse> {
    if (req.urls.length < 1 || req.urls.length > 10)
      throw new TinyFishError(
        "Fetch takes between 1 and 10 URLs per request.",
        400,
        "INVALID_INPUT",
      );
    return this.call(this.ep.fetch, "", {
      method: "POST",
      body: { format: "markdown", ...req },
      timeoutMs: 150_000,
      signal,
    });
  }

  // Agent API

  /**
   * Starts a run and streams its events. If the stream drops before COMPLETE (it can't be resumed),
   * falls back to polling the run until it finishes. Resolves with the final run.
   */
  async runSse(
    req: AgentRequest,
    onEvent: (e: SseEvent) => void,
    signal?: AbortSignal,
  ): Promise<Run> {
    const res = await this.call<Response>(
      this.ep.agent,
      "/v1/automation/run-sse",
      { method: "POST", body: req, timeoutMs: 30_000, signal, raw: true },
    );
    let runId: string | undefined;
    let complete: Extract<SseEvent, { type: "COMPLETE" }> | undefined;
    try {
      for await (const data of readSse(res.body!, signal)) {
        let e: SseEvent;
        try {
          e = JSON.parse(data) as SseEvent;
        } catch {
          continue;
        }
        if ("run_id" in e && e.run_id) runId = e.run_id;
        onEvent(e);
        if (e.type === "COMPLETE") {
          complete = e;
          break;
        }
      }
    } catch (err) {
      if (signal?.aborted || !runId) throw err;
    }
    if (!runId)
      throw new TinyFishError(
        "The run stream ended before the run started.",
        502,
      );
    // The stream gives the result, but steps (with screenshots) only come from the run object.
    if (!complete) return this.waitForRun(runId, { signal });
    try {
      const metadata = await this.getRun(runId, signal);
      return {
        ...metadata,
        status: complete.status,
        result: complete.result ?? metadata.result,
        error: complete.error ?? metadata.error,
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      // A completed SSE result remains useful when fetching screenshot metadata fails.
      return {
        run_id: runId,
        status: complete.status,
        result: complete.result ?? null,
        error: complete.error ?? null,
        goal: req.goal,
        created_at: "",
        started_at: null,
        finished_at: complete.timestamp,
        num_of_steps: null,
        steps: [],
        streaming_url: null,
        video_url: null,
      };
    }
  }

  async runAsync(req: AgentRequest, signal?: AbortSignal): Promise<string> {
    const r = await this.call<{
      run_id: string | null;
      error: RunError | null;
    }>(this.ep.agent, "/v1/automation/run-async", {
      method: "POST",
      body: req,
      timeoutMs: 30_000,
      signal,
    });
    if (!r.run_id)
      throw new TinyFishError(
        r.error?.message ?? "The run was not created.",
        400,
        r.error?.code,
      );
    return r.run_id;
  }

  getRun(id: string, signal?: AbortSignal): Promise<Run> {
    return this.call(this.ep.agent, `/v1/runs/${encodeURIComponent(id)}`, {
      query: { screenshots: "url", html: "none" },
      timeoutMs: 30_000,
      signal,
    });
  }

  /** Polls until the run finishes. `onUpdate` sees every poll (status, streaming_url, steps so far). */
  async waitForRun(
    id: string,
    o: {
      intervalMs?: number;
      signal?: AbortSignal;
      onUpdate?: (run: Run) => void | Promise<void>;
      maxConsecutiveErrors?: number;
    } = {},
  ): Promise<Run> {
    let errors = 0;
    for (;;) {
      let run: Run;
      try {
        run = await this.getRun(id, o.signal);
        errors = 0;
      } catch (err) {
        if (
          o.signal?.aborted ||
          !(err instanceof TinyFishError) ||
          !err.retryable ||
          ++errors >= (o.maxConsecutiveErrors ?? 3)
        )
          throw err;
        await sleep(o.intervalMs ?? 3000, o.signal);
        continue;
      }
      await o.onUpdate?.(run);
      if (TERMINAL.includes(run.status)) return run;
      await sleep(o.intervalMs ?? 3000, o.signal);
    }
  }

  async cancelRun(id: string): Promise<void> {
    await this.call(
      this.ep.agent,
      `/v1/runs/${encodeURIComponent(id)}/cancel`,
      { method: "POST", timeoutMs: 15_000 },
    );
  }

  /** JPEG bytes of one step's screenshot. */
  async stepScreenshot(
    runId: string,
    stepId: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const res = await this.call<Response>(
      this.ep.agent,
      `/v1/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/screenshot`,
      { timeoutMs: 30_000, signal, raw: true },
    );
    return Buffer.from(await res.arrayBuffer());
  }

  /** Validates the key with a free call (lists one run). */
  async checkKey(signal?: AbortSignal): Promise<void> {
    await this.call(this.ep.agent, "/v1/runs", {
      query: { limit: "1" },
      timeoutMs: 15_000,
      signal,
    });
  }

  // Browser API (fallback recorder)

  createBrowser(
    body: {
      url?: string;
      timeout_seconds?: number;
      proxy_config?: AgentRequest["proxy_config"];
    } = {},
    signal?: AbortSignal,
  ): Promise<BrowserSession> {
    return this.call(this.ep.browser, "", {
      method: "POST",
      body,
      timeoutMs: 90_000,
      signal,
    });
  }

  /** Always call this in a `finally` (AGENTS.md rule 6). Never throws. */
  async deleteBrowser(sessionId: string): Promise<void> {
    await this.call(this.ep.browser, `/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      timeoutMs: 15_000,
      raw: true,
    }).catch(() => undefined);
  }

  // Browser Context Profiles

  /** A new profile for agent runs (`use_profile: true, profile_id`). */
  createProfile(
    body: {
      name: string;
      set_as_default?: boolean;
      proxy_country_code?: string | null;
    },
    signal?: AbortSignal,
  ): Promise<Profile> {
    return this.call(this.ep.agent, "/v1/profiles", {
      method: "POST",
      body,
      timeoutMs: 30_000,
      signal,
    });
  }

  /** Puts exported browser state (cookies, local and session storage) into a profile. Values go to TinyFish only, never to logs. */
  uploadProfile(
    profileId: string,
    body: ProfileUpload,
    signal?: AbortSignal,
  ): Promise<ProfileUploadResult> {
    return this.call(
      this.ep.agent,
      `/v1/profiles/${encodeURIComponent(profileId)}/upload`,
      { method: "POST", body, timeoutMs: 60_000, signal },
    );
  }

  deleteProfile(profileId: string, signal?: AbortSignal): Promise<unknown> {
    return this.call(
      this.ep.agent,
      `/v1/profiles/${encodeURIComponent(profileId)}`,
      { method: "DELETE", timeoutMs: 30_000, signal },
    );
  }

  async profiles(signal?: AbortSignal): Promise<Profile[]> {
    const result = await this.call<{ profiles: Profile[] } | Profile[]>(
      this.ep.agent,
      "/v1/profiles",
      { timeoutMs: 30_000, signal },
    );
    return Array.isArray(result) ? result : result.profiles;
  }

  getProfile(id: string, signal?: AbortSignal): Promise<Profile> {
    return this.call(this.ep.agent, `/v1/profiles/${encodeURIComponent(id)}`, {
      timeoutMs: 30_000,
      signal,
    });
  }

  /** Owner must save or cancel this setup session; an unconfirmed create is never retried. */
  setupProfile(
    id: string,
    body: { url: string; timeout_seconds?: number },
    signal?: AbortSignal,
  ): Promise<BrowserSession & { timeout_seconds: number; expires_at: string }> {
    return this.call(
      this.ep.agent,
      `/v1/profiles/${encodeURIComponent(id)}/setup-session`,
      { method: "POST", body, timeoutMs: 90_000, signal },
    );
  }

  saveProfile(
    id: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.call(
      this.ep.agent,
      `/v1/profiles/${encodeURIComponent(id)}/save`,
      {
        method: "POST",
        body: { session_id: sessionId },
        timeoutMs: 60_000,
        signal,
      },
    );
  }

  // Vault

  async vaultItems(signal?: AbortSignal): Promise<VaultItem[]> {
    return (
      await this.call<{ items: VaultItem[] }>(
        this.ep.agent,
        "/v1/vault/items",
        { timeoutMs: 30_000, signal },
      )
    ).items;
  }

  private async call<T>(base: string, path: string, c: Call): Promise<T> {
    const method = c.method ?? "GET";
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(c.query ?? {}))
      url.searchParams.set(k, v);
    for (let attempt = 1; ; attempt++) {
      const t0 = performance.now();
      const connect = new AbortController();
      const streaming = c.raw && method === "POST";
      const timeoutMs = this.opts.requestTimeoutMs ?? c.timeoutMs;
      const timer = streaming
        ? setTimeout(
            () =>
              connect.abort(
                new DOMException("Response headers timed out", "TimeoutError"),
              ),
            timeoutMs,
          )
        : undefined;
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            "X-API-Key": this.key,
            ...(c.body !== undefined
              ? { "content-type": "application/json" }
              : {}),
          },
          body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
          // Clear the header deadline once SSE connects; its body uses the caller's deadline.
          signal: AbortSignal.any([
            streaming ? connect.signal : AbortSignal.timeout(timeoutMs),
            ...(c.signal ? [c.signal] : []),
          ]),
        });
      } catch (err) {
        if (c.signal?.aborted) throw c.signal.reason;
        const cause = (err as { cause?: { code?: string }; name?: string })
          .cause?.code;
        const code =
          cause && /^[A-Z0-9_]+$/.test(cause)
            ? cause
            : (err as Error).name === "TimeoutError"
              ? "REQUEST_TIMEOUT"
              : "NETWORK_ERROR";
        const failure = new TinyFishTransportError(
          method,
          url.origin + url.pathname,
          code,
        );
        if (method !== "GET" || attempt >= 2) throw failure;
        await sleep(this.opts.retryDelayMs ?? 2000, c.signal);
        continue;
      } finally {
        clearTimeout(timer);
      }
      this.opts.onRequest?.({
        method,
        url: url.origin + url.pathname,
        status: res.status,
        ms: Math.round(performance.now() - t0),
      });
      if (res.ok) {
        if (c.raw) return res as T;
        try {
          return (await res.json()) as T;
        } catch (error) {
          if (c.signal?.aborted) throw c.signal.reason;
          const failure = new TinyFishTransportError(
            method,
            url.origin + url.pathname,
            "RESPONSE_BODY_ERROR",
          );
          if (method !== "GET" || attempt >= 2) throw failure;
          await sleep(this.opts.retryDelayMs ?? 2000, c.signal);
          continue;
        }
      }
      const err = await toError(res, this.key);
      if (method !== "GET" || attempt >= 2 || !err.retryable) throw err;
      await sleep(
        err.retryAfter !== undefined
          ? err.retryAfter * 1000
          : (this.opts.retryDelayMs ?? 2000),
        c.signal,
      );
    }
  }
}

async function toError(res: Response, key: string): Promise<TinyFishError> {
  const text = await res.text().catch(() => "");
  let code: string | undefined;
  let message = text.slice(0, 300) || res.statusText;
  try {
    const body = JSON.parse(text) as {
      error?: { code?: string; message?: string } | string;
      message?: string;
      code?: string;
    };
    if (typeof body.error === "object" && body.error) {
      code = body.error.code;
      message = body.error.message ?? message;
    } else {
      code =
        body.code ?? (typeof body.error === "string" ? body.error : undefined);
      message = body.message ?? message;
    }
  } catch {}
  message = message.replaceAll(key, "[redacted]");
  const retryAfter =
    Math.min(30, Math.max(0, Number(res.headers.get("retry-after")) || 0)) ||
    undefined;
  return new TinyFishError(
    `TinyFish ${res.status}${code ? ` ${code}` : ""}: ${message}`,
    res.status,
    code,
    retryAfter,
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
