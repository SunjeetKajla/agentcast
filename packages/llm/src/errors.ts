export type LlmErrorCode =
  /** No supported CLI installed, or the chosen one is missing. */
  | "llm.unavailable"
  /** The CLI isn't logged in. */
  | "llm.auth"
  /** Subscription usage or rate limit. Retry later. */
  | "llm.limit"
  | "llm.timeout"
  | "llm.cancelled"
  /** The answer didn't match the schema, even after one repair round. */
  | "llm.invalid"
  | "llm.failed";

/** Every failure from packages/llm. `code` and `retryable` map onto StageError. */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }

  get retryable(): boolean {
    return this.code === "llm.limit" || this.code === "llm.timeout" || this.code === "llm.failed";
  }
}

/** Turn a CLI's error output into a code a person can act on. */
export function classify(backend: string, text: string): LlmError {
  const t = text.toLowerCase();
  const tail = text.trim().split("\n").slice(-5).join("\n").slice(0, 800);
  if (/not logged in|please run \/login|invalid api key|authentication|unauthorized|401|log ?in again|codex login/.test(t)) {
    return new LlmError("llm.auth", `${backend} isn't logged in. Log in to it, then try again.`, tail);
  }
  if (/usage limit|rate limit|rate_limit|429|quota|too many requests|limit reached/.test(t)) {
    return new LlmError("llm.limit", `${backend} hit a usage or rate limit. Try again later.`, tail);
  }
  return new LlmError("llm.failed", `${backend} failed: ${tail || "no output"}`, tail);
}
