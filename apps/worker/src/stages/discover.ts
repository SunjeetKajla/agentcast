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
    onAgent: (id, title, status, run?: Run) =>
      ctx.emit({
        type: "agent",
        stage: ctx.stage,
        agentId: id,
        title,
        status,
        ...(ctx.config.auth.mode === "public" && run?.streaming_url
          ? { streamingUrl: run.streaming_url }
          : {}),
        ...(run?.steps.length ? { step: `Step ${run.steps.length}` } : {}),
      }),
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
