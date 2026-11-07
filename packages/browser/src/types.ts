import type { z } from "zod";
import type { BrowserContextOptions } from "playwright-core";
type RecorderStorageState = Exclude<
  NonNullable<BrowserContextOptions["storageState"]>,
  string
>;

export type PageRead = {
  url: string;
  final_url: string;
  title: string | null;
  text: string | null;
  description: string | null;
  language: string | null;
  latency_ms: number | null;
  links?: string[];
  image_links?: string[];
};
export type ExplorationRequest = {
  url: string;
  goal: string;
  output_schema?: Record<string, unknown>;
};
export type BrowserProgress = {
  id: string;
  action: string;
  screenshot?: string;
};
export type ExplorationAgent = {
  run<S extends z.ZodType>(options: {
    id: string;
    request: ExplorationRequest;
    schema: S;
    signal: AbortSignal;
    maxSteps: number;
    storageState?: RecorderStorageState;
    onStep?: (step: BrowserProgress) => void | Promise<void>;
  }): Promise<{ result: z.output<S>; sessionId?: string }>;
};
