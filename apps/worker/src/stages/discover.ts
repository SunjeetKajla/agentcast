import { CreativeBrief, ProductBrief, jobPaths } from "@agentcast/shared";
import {
  discoverProduct,
  recorderAdapter,
  workspaceLlm,
  fixtureStages,
  type BrowserAdapter,
  type ExploreOptions,
} from "@agentcast/explore";
import { createBrowserAgent, type ExplorationAgent } from "@agentcast/browser";
import { siteOf, type ExplorationUpdate } from "@agentcast/explore";
import type { StageContext } from "../context.ts";
import type { StageFn } from "./types.ts";
import { pretend } from "./stub.ts";
import { sessionFor } from "./auth.ts";

export async function explorationOptions(
  ctx: StageContext,
  deps: { agent?: ExplorationAgent; browser?: BrowserAdapter } = {},
): Promise<ExploreOptions> {
  const [product, creative, state] = await Promise.all([
    ctx.read(jobPaths.productBrief, ProductBrief),
    ctx.read(jobPaths.creativeBrief, CreativeBrief),
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
    agent:
      deps.agent ??
      createBrowserAgent({
        llm: ctx.llm,
        dir: ctx.dir,
        authorizedUrl: ctx.config.url,
        siteOf,
      }),
    llm: workspaceLlm(ctx.llm, ctx.llmProgress),
    browser: deps.browser ?? (await recorderAdapter()),
    product,
    creative,
    publicMode: ctx.config.auth.mode === "public",
    browserOptions: { storageState: state },
    signal: ctx.signal,
    log: (message) => ctx.log(message),
    progress: (value, message) => ctx.progress(value, message),
    onAgent: agentEvents(ctx),
  };
}

/** Publish observed actions once; authenticated runs never publish live frames. */
export function agentEvents(
  ctx: Pick<StageContext, "emit" | "stage" | "config">,
) {
  const seen = new Map<string, { steps: number; status: string }>();
  return (
    id: string,
    title: string,
    status: "started" | "step" | "done" | "failed" | "cancelled",
    run?: ExplorationUpdate,
  ) => {
    const prev = seen.get(id) ?? { steps: 0, status: "" };
    const fresh = run?.steps.slice(prev.steps) ?? [];
    seen.set(id, { steps: prev.steps + fresh.length, status });
    if (!fresh.length && prev.status === status) return;
    const event = {
      type: "agent",
      stage: ctx.stage,
      agentId: id,
      title,
      status,
    } as const;
    if (!fresh.length) return ctx.emit(event);
    for (const step of fresh)
      ctx.emit({
        ...event,
        step: step.action.slice(0, 200),
        ...(ctx.config.auth.mode === "public" && step.screenshot
          ? { screenshot: step.screenshot }
          : {}),
      });
  };
}
export function makeDiscover(
  deps: { agent?: ExplorationAgent; browser?: BrowserAdapter } = {},
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
