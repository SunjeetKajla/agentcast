import { CreativeBrief, ProductBrief, jobPaths } from "@agentcast/shared";
import {
  discoverProduct,
  recorderAdapter,
  workspaceLlm,
  fixtureStages,
  type BrowserAdapter,
  type ExploreOptions,
} from "@agentcast/explore";
import { TinyFish, type Run } from "@agentcast/tinyfish";
import type { StageContext } from "../context.ts";
import type { StageFn } from "./types.ts";
import { pretend } from "./stub.ts";
import { authRequest, sessionFor } from "./auth.ts";

export async function explorationOptions(
  ctx: StageContext,
  deps: { tf?: TinyFish; browser?: BrowserAdapter } = {},
): Promise<ExploreOptions> {
  const [product, creative, auth, state] = await Promise.all([
    ctx.read(jobPaths.productBrief, ProductBrief),
    ctx.read(jobPaths.creativeBrief, CreativeBrief),
    authRequest(ctx),
    sessionFor(ctx),
  ]);
  if (ctx.config.auth.mode !== "public" && !state)
    throw new Error(
      "The authenticated session is missing. Sign in before exploring.",
    );
  return {
    url: ctx.config.url,
    dir: ctx.dir,
    io: ctx,
    tf: deps.tf ?? new TinyFish(),
    llm: workspaceLlm(ctx.llm, ctx.llmProgress),
    browser: deps.browser ?? (await recorderAdapter()),
    product,
    creative,
    auth,
    publicMode: ctx.config.auth.mode === "public",
    browserOptions: { storageState: state },
    signal: ctx.signal,
    log: (message) => ctx.log(message),
    progress: (value, message) => ctx.progress(value, message),
    onAgent: agentEvents(ctx),
  };
}

/**
 * Turns TinyFish run polls (every ~1.5 s) into agent events for the live views. A poll only becomes an
 * event when something changed: each new step once, with TinyFish's own words for it; a new live-view
 * link; a new status. Signed-in runs never send their live view (AGENTS.md rule 5).
 */
export function agentEvents(
  ctx: Pick<StageContext, "emit" | "stage" | "config">,
) {
  const seen = new Map<
    string,
    { steps: number; url?: string; status: string }
  >();
  return (
    id: string,
    title: string,
    status: "started" | "step" | "done" | "failed" | "cancelled",
    run?: Run,
  ) => {
    const prev = seen.get(id) ?? { steps: 0, status: "" };
    const url =
      ctx.config.auth.mode === "public"
        ? (run?.streaming_url ?? prev.url)
        : undefined;
    const fresh = run?.steps.slice(prev.steps) ?? [];
    seen.set(id, { steps: prev.steps + fresh.length, url, status });
    if (!fresh.length && url === prev.url && status === prev.status) return;
    const event = {
      type: "agent",
      stage: ctx.stage,
      agentId: id,
      title,
      status,
      ...(url ? { streamingUrl: url } : {}),
    } as const;
    if (!fresh.length) return ctx.emit(event);
    fresh.forEach((step, i) =>
      ctx.emit({
        ...event,
        step: step.action?.trim().slice(0, 200) || `Step ${prev.steps + i + 1}`,
      }),
    );
  };
}
export function makeDiscover(
  deps: { tf?: TinyFish; browser?: BrowserAdapter } = {},
): StageFn {
  return async (ctx) => {
    if (fixtureStages()) {
      const agent = {
        type: "agent",
        stage: ctx.stage,
        agentId: "scout",
        title: "Find the product entrance",
      } as const;
      ctx.emit({ ...agent, status: "started" });
      await pretend(ctx);
      ctx.emit({ ...agent, status: "done" });
      return;
    }
    const result = await discoverProduct(await explorationOptions(ctx, deps));
    ctx.log(
      `Found ${result.candidates.length} candidate flow(s). Each still requires a local rehearsal.`,
    );
  };
}
export const discover = makeDiscover();
