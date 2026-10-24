import type { z } from "zod";
import type { Brand, Flow, ReplayPlan } from "@agentcast/shared";
import type { FetchResult } from "@agentcast/tinyfish";
import type { PageColors, LogoCandidate, ColorSample } from "./brand";
import type { PageFacts } from "./tour";
import type { SessionState } from "./artifacts";

export type BrowserOptions = {
  signal?: AbortSignal;
  storageState?: SessionState;
  authorizedUrl: string;
  dir: string;
};
export type RehearsalResult = { flow: Flow; replay?: ReplayPlan };
/** Neeraj's recorder boundary. The explorer never accepts an agent's self-reported replay success. */
export type BrowserAdapter = {
  readPage(url: string, options: BrowserOptions): Promise<FetchResult>;
  inspect(
    url: string,
    options: BrowserOptions,
  ): Promise<{
    facts: PageFacts;
    colors?: PageColors;
    samples?: ColorSample[];
    logo?: Brand["logo"];
    logos?: LogoCandidate[];
    fonts?: { display: string; text: string };
    radius?: number;
    hero?: string;
    gradient?: string[];
  }>;
  rehearse(flow: Flow, options: BrowserOptions): Promise<RehearsalResult>;
  signIn?(options: {
    url: string;
    profileDir: string;
    signal?: AbortSignal;
    done?: Promise<void>;
    onOpen?: () => void;
  }): Promise<SessionState>;
};
export type ArtifactIO = {
  read<S extends z.ZodType>(rel: string, schema: S): Promise<z.output<S>>;
  write<S extends z.ZodType>(
    rel: string,
    schema: S,
    value: z.input<S>,
  ): Promise<z.output<S>>;
};

/** An explicit compatibility seam; replacing this adapter does not change provider or story logic. */
export async function recorderAdapter(): Promise<BrowserAdapter> {
  const module = (await import("@agentcast/recorder")) as {
    exploreBrowser?: BrowserAdapter;
  };
  return (
    module.exploreBrowser ?? (await import("./local")).localBrowserAdapter()
  );
}

/** Stub mode is explicit; provider errors never silently turn into fixture successes. */
export function fixtureStages(): boolean {
  return (
    process.env.AGENTCAST_STAGE_MODE === "stub" ||
    (process.env.AGENTCAST_STAGE_MODE !== "real" &&
      process.env.AGENTCAST_STUB_DELAY_MS !== undefined)
  );
}
