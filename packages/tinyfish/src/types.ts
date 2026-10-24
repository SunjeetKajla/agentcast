/** TinyFish API shapes we use (docs.tinyfish.ai; Agent, Runs, Fetch, Browser, Vault). Field names follow the API. */

export type RunStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export const TERMINAL: readonly RunStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

export type RunError = {
  code?: string;
  message: string;
  category?: "SYSTEM_FAILURE" | "AGENT_FAILURE" | "BILLING_FAILURE" | "UNKNOWN";
  retry_after?: number | null;
  help_url?: string;
  help_message?: string;
};

/**
 * `output_schema` accepts a subset of JSON Schema: type, properties, required, items, enum, format,
 * nullable, anyOf, min/maxItems, minimum/maximum, propertyOrdering. No `description`, no
 * `additionalProperties`, and the top level must be an object.
 */
export type OutputSchema = Record<string, unknown>;

export type AgentRequest = {
  url: string;
  goal: string;
  output_schema?: OutputSchema;
  browser_profile?: "lite" | "stealth";
  proxy_config?: { enabled: boolean; type?: "tinyfish"; country_code?: string };
  agent_config?: {
    max_duration_seconds?: number;
    max_steps?: number;
    mode?: "default" | "strict";
  };
  use_profile?: boolean;
  profile_id?: string;
  use_vault?: boolean;
  credential_item_ids?: string[];
};

export type RunStep = {
  id: string;
  timestamp: string;
  status: RunStatus;
  action: string | null;
  /** With `screenshots=url` this needs a browser session; use `stepScreenshot()` with the API key instead. */
  screenshot: string | null;
  duration: string | null;
};

export type Run = {
  run_id: string;
  status: RunStatus;
  goal: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  num_of_steps: number | null;
  result: Record<string, unknown> | null;
  error: RunError | null;
  /** Live view while the run is active. Safe to show in the browser. */
  streaming_url: string | null;
  video_url: string | null;
  steps: RunStep[];
};

export type SseEvent =
  | { type: "STARTED"; run_id: string; timestamp: string }
  | {
      type: "STREAMING_URL";
      run_id: string;
      streaming_url: string;
      timestamp: string;
    }
  | { type: "PROGRESS"; run_id: string; purpose: string; timestamp: string }
  | { type: "HEARTBEAT"; timestamp: string }
  | {
      type: "COMPLETE";
      run_id: string;
      status: RunStatus;
      result?: Record<string, unknown> | null;
      error?: RunError | null;
      timestamp: string;
    };

export type FetchRequest = {
  urls: string[];
  format?: "markdown" | "html" | "json";
  links?: boolean;
  image_links?: boolean;
  /** Seconds a cached copy may be old; 0 forces a live fetch. */
  ttl?: number;
  per_url_timeout_ms?: number;
  purpose?: string;
};

export type FetchResult = {
  url: string;
  final_url: string;
  title: string | null;
  description: string | null;
  language: string | null;
  text: string | null;
  links?: string[];
  image_links?: string[];
  latency_ms: number | null;
};

export type FetchResponse = {
  results: FetchResult[];
  errors: Array<{ url: string; error: string; status?: number }>;
};

export type BrowserSession = {
  session_id: string;
  cdp_url: string;
  base_url: string;
};

export type VaultItem = {
  itemId: string;
  connectionId: string | null;
  label: string;
  vaultName: string;
  domains: string[];
  hasTotp: boolean;
};

/** A Browser Context Profile: saved logged-in state that agent runs can start from. */
export type Profile = {
  id: string;
  name: string;
  created_at: string;
  is_default?: boolean;
  proxy_country_code?: string | null;
  domain_count?: number;
};

/** POST /v1/profiles/{id}/upload: Playwright's storageState, almost field for field. */
export type ProfileUpload = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  }>;
  localStorage?: Array<{
    origin: string;
    items: Array<{ name: string; value: string }>;
  }>;
  sessionStorage?: Array<{
    origin: string;
    items: Array<{ name: string; value: string }>;
  }>;
};

export type ProfileUploadResult = {
  domains_updated: string[];
  domains_failed: string[];
  cookie_count?: number;
};
