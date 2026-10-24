import {
  FlowsFile,
  ReplayPlan,
  jobPaths,
  type Flow,
  type ProductBrief,
  type CreativeBrief,
} from "@agentcast/shared";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  type AgentRequest,
  type Run,
  type TinyFish,
} from "@agentcast/tinyfish";
import {
  Candidate,
  FlowRunResult,
  ScoutResult,
  SCOUT_SCHEMA,
  FLOW_RUN_SCHEMA,
  flowGoal,
  scoutGoal,
} from "./agent";
import { ExplorationPlan, RehearsalFile } from "./artifacts";
import { offSite, productEntry } from "./access";
import { toFlow, DESTRUCTIVE } from "./normalize";
import { judgeFlows, selectFlows, type JudgeScores } from "./score";
import { tourFlows } from "./tour";
import { requestHash, runTask } from "./task";
import type {
  ArtifactIO,
  BrowserAdapter,
  BrowserOptions,
  RehearsalResult,
} from "./runtime";
import type { Llm } from "./llm";
import { safeId } from "./local";

export type ExploreOptions = {
  url: string;
  dir: string;
  io: ArtifactIO;
  tf: TinyFish;
  llm: Llm;
  browser: BrowserAdapter;
  product: ProductBrief;
  creative: CreativeBrief;
  signal?: AbortSignal;
  browserOptions?: Omit<BrowserOptions, "signal" | "authorizedUrl" | "dir">;
  auth?: Pick<
    AgentRequest,
    "use_profile" | "profile_id" | "use_vault" | "credential_item_ids"
  >;
  publicMode: boolean;
  log?: (message: string) => void;
  onAgent?: (
    id: string,
    title: string,
    status: "started" | "step" | "done" | "failed" | "cancelled",
    run?: Run,
  ) => void;
  progress?: (value: number, message: string) => void;
  deadlines?: { scoutMs?: number; flowMs?: number; intervalMs?: number };
};
const browserOptions = (o: ExploreOptions): BrowserOptions => ({
  ...o.browserOptions,
  dir: o.dir,
  authorizedUrl: o.url,
  signal: o.signal,
});
const missing = (error: unknown) =>
  (error as { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT" ||
  (error as NodeJS.ErrnoException).code === "ENOENT";

async function agent<S extends typeof ScoutResult | typeof FlowRunResult>(
  o: ExploreOptions,
  id: string,
  title: string,
  request: AgentRequest,
  schema: S,
  scout = false,
) {
  o.onAgent?.(id, title, "started");
  try {
    const result = await runTask({
      id,
      request: { ...request, browser_profile: "stealth", ...o.auth },
      schema,
      io: o.io,
      tf: o.tf,
      signal: o.signal,
      maxMs: scout
        ? (o.deadlines?.scoutMs ?? 180_000)
        : (o.deadlines?.flowMs ?? 300_000),
      maxSteps: scout ? 18 : 32,
      intervalMs: o.deadlines?.intervalMs,
      onUpdate: (run) =>
        o.onAgent?.(
          id,
          title,
          run.status === "COMPLETED" ? "done" : "step",
          run,
        ),
    });
    o.onAgent?.(id, title, "done");
    return result;
  } catch (error) {
    o.onAgent?.(id, title, o.signal?.aborted ? "cancelled" : "failed");
    throw error;
  }
}

/** The local page is checked independently before an agent's access classification is accepted. */
export async function discoverProduct(
  o: ExploreOptions,
): Promise<ExplorationPlan> {
  const local = await o.browser.inspect(o.url, browserOptions(o));
  let scout: ReturnType<typeof ScoutResult.parse> | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await agent(
        o,
        attempt ? "scout-retry" : "scout",
        "Find the product entrance",
        {
          url: o.url,
          goal: scoutGoal({
            url: o.url,
            domain: new URL(o.url).hostname,
            product: o.product.name,
            focus: o.creative.mustShow.join("; "),
            signedIn: !o.publicMode,
            ...(attempt
              ? {
                  retry: "no-flows" as const,
                  entrances: local.facts.links
                    .slice(0, 8)
                    .map((link) => link.href),
                }
              : {}),
          }),
          output_schema: SCOUT_SCHEMA,
          agent_config: { max_duration_seconds: 60 },
        },
        ScoutResult,
        true,
      );
      scout = ScoutResult.parse(result.result);
      if (
        scout.candidates.length ||
        scout.access === "blocked" ||
        scout.access === "sign-in-required"
      )
        break;
    } catch (error) {
      o.signal?.throwIfAborted();
      // A second POST after an ambiguous creation could charge twice; retain the first task instead.
      o.log?.(
        "The remote scout did not produce usable candidates. Its checkpoint is retained; local tour candidates will be rehearsed.",
      );
      break;
    }
  }
  let entryUrl = o.url;
  if (scout?.entry_url) {
    try {
      entryUrl = productEntry(scout.entry_url, o.url);
      await o.browser.inspect(entryUrl, browserOptions(o));
    } catch (error) {
      o.signal?.throwIfAborted();
      if (
        !o.publicMode &&
        (error as { kind?: string }).kind === "sign-in-required"
      )
        throw new Error(
          "The saved session no longer opens the authenticated product. Sign in again before exploring authenticated flows.",
        );
      entryUrl = o.url;
    }
  }
  const candidates = (scout?.candidates ?? [])
    .filter(
      (candidate) =>
        !offSite(candidate, o.url) &&
        !(o.publicMode && candidate.needs_sign_in) &&
        !DESTRUCTIVE.test([candidate.title, ...candidate.outline].join(" ")),
    )
    .slice(0, 3)
    .map((candidate) =>
      Candidate.parse({
        ...candidate,
        start_url: productEntry(candidate.start_url || entryUrl, o.url),
        needs_sign_in: !o.publicMode && Boolean(candidate.needs_sign_in),
        performed: false,
        steps: [],
      }),
    );
  const plan = ExplorationPlan.parse({
    schemaVersion: 1,
    entryUrl,
    access: o.publicMode
      ? "public"
      : scout?.access === "authenticated"
        ? "authenticated"
        : "public",
    reason: candidates.length
      ? "The entrance opens independently in local Chrome; candidates still require focused execution and rehearsal."
      : "Local Chrome confirmed a usable public surface; independently rehearsed guided tours will supplement remote discovery.",
    blockers: [],
    candidates,
  });
  await o.io.write("explore/plan.json", ExplorationPlan, plan);
  return plan;
}

export async function rehearseCandidate(
  o: ExploreOptions,
  flow: Flow,
): Promise<RehearsalResult> {
  safeId(flow.id);
  const hash = requestHash([
    flow,
    requestHash(o.browserOptions?.storageState ?? "public"),
  ]);
  const file = `explore/rehearsals/${flow.id}.json`;
  try {
    const saved = await o.io.read(file, RehearsalFile);
    if (saved.flowHash === hash && saved.flow.rehearsal?.ok)
      return { flow: saved.flow, replay: saved.replay };
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const result = await o.browser.rehearse(flow, browserOptions(o));
  await o.io.write(file, RehearsalFile, {
    schemaVersion: 1,
    flowHash: hash,
    ...result,
  });
  return result;
}

/** Focused runs execute independently; each successful rehearsal is durable before another completes. */
export async function executeFlows(o: ExploreOptions): Promise<Flow[]> {
  const plan = await o.io.read("explore/plan.json", ExplorationPlan);
  // This also catches an authenticated session expiring between discovery and rehearsal.
  const page = await o.browser.inspect(plan.entryUrl, browserOptions(o));
  const results = new Map<string, Flow>();
  const replay = ReplayPlan.parse({
    schemaVersion: 1,
    byFormFactor: { desktop: {} },
  });
  let writes: Promise<unknown> = Promise.resolve();
  const save = () => {
    writes = writes.then(async () => {
      await o.io.write(jobPaths.flows, FlowsFile, {
        schemaVersion: 1,
        flows: [...results.values()],
      });
      await o.io.write(jobPaths.replayPlan, ReplayPlan, replay);
    });
    return writes;
  };
  const remember = async (result: RehearsalResult) => {
    results.set(result.flow.id, result.flow);
    Object.assign(
      replay.byFormFactor.desktop!,
      result.replay?.byFormFactor.desktop ?? {},
    );
    await save();
  };
  let next = 0;
  let completed = 0;
  const perform = async () => {
    while (next < plan.candidates.length) {
      o.signal?.throwIfAborted();
      const index = next++;
      const candidate = plan.candidates[index]!;
      const id = `f${index + 1}`;
      let previous: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const startUrl = productEntry(
            candidate.start_url || plan.entryUrl,
            o.url,
          );
          const run = await agent(
            o,
            attempt ? `${id}-repair` : id,
            candidate.title,
            {
              url: startUrl,
              goal: flowGoal(candidate, new URL(o.url).hostname, previous),
              output_schema: FLOW_RUN_SCHEMA,
              agent_config: { max_duration_seconds: 120 },
            },
            FlowRunResult,
          );
          const normalized = toFlow(FlowRunResult.parse(run.result), {
            id,
            candidate,
            runId: run.runId,
            productUrl: o.url,
            startedAt: startUrl,
          });
          if (normalized.issues.length) {
            previous = normalized.issues.join("; ");
            await remember({
              flow: {
                ...normalized.flow,
                rehearsal: { ok: false, reason: previous },
              },
            });
          } else {
            const rehearsed = await rehearseCandidate(o, normalized.flow);
            await remember(rehearsed);
            if (rehearsed.flow.rehearsal?.ok) break;
            previous =
              rehearsed.flow.rehearsal?.reason ?? "The local rehearsal failed.";
          }
        } catch (error) {
          o.signal?.throwIfAborted();
          // Transport failure already has a durable provider ID. Never turn that into a new paid repair.
          o.log?.(
            `Flow ${index + 1} stopped; other completed rehearsals are preserved.`,
          );
          break;
        }
      }
      o.progress?.(
        ++completed / Math.max(1, plan.candidates.length),
        `Rehearsed ${completed} candidate flows`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(2, plan.candidates.length) }, perform),
  );
  if ([...results.values()].filter((flow) => flow.rehearsal?.ok).length < 2) {
    const tours = tourFlows(page.facts, o.product.name).slice(0, 4);
    for (const source of tours) {
      const tour = {
        ...source,
        source: "tour" as const,
        requiresAuth: !o.publicMode,
      };
      await remember(await rehearseCandidate(o, tour));
      if (
        [...results.values()].filter((flow) => flow.rehearsal?.ok).length >= 3
      )
        break;
    }
  }
  const flows = [...results.values()];
  const eligible = flows.filter((flow) => flow.rehearsal?.ok);
  if (!eligible.length)
    throw new Error(
      "No reported flow or guided tour replayed successfully in a fresh local browser. Saved diagnostics retain the failed candidates.",
    );
  const screenshots: Record<string, { first?: Buffer; last?: Buffer }> = {};
  if (o.publicMode) {
    const root = await realpath(o.dir);
    for (const flow of eligible) {
      const frames = flow.steps
        .map((step) => step.frame)
        .filter((file): file is string => Boolean(file));
      const shots: { first?: Buffer; last?: Buffer } = {};
      for (const [which, file] of [
        ["first", frames[0]],
        ["last", frames.at(-1)],
      ] as const) {
        if (
          !file ||
          !/^explore\/frames\/[a-z0-9_.-]+\/[a-z0-9_.-]+\.jpg$/i.test(file)
        )
          continue;
        try {
          const path = await realpath(join(root, file));
          if (
            !path.startsWith(root + sep) ||
            (await stat(path)).size > 2_000_000
          )
            continue;
          shots[which] = await readFile(path);
        } catch {
          o.signal?.throwIfAborted();
        }
      }
      if (shots.first || shots.last) screenshots[flow.id] = shots;
    }
  }
  const judged = await judgeFlows(
    o.llm,
    {
      product: o.product.name,
      valueProps: o.product.valueProps,
      focus: o.creative.mustShow.join("; ") || undefined,
      flows: eligible,
      screenshots,
    },
    o.signal,
  );
  // The judge is advisory: a clean independent rehearsal remains a hard eligibility gate.
  for (const flow of eligible)
    if (!judged.has(flow.id))
      throw new Error(
        "The flow judge omitted a rehearsed flow. Retry judging using the saved rehearsals.",
      );
  const selected = selectFlows(
    flows.map((flow) => ({
      flow,
      eligible: Boolean(flow.rehearsal?.ok),
      seconds: flow.rehearsal?.seconds,
    })),
    judged as Map<string, JudgeScores>,
    {
      hasFocus: o.creative.mustShow.length > 0,
      targetSeconds: o.creative.targetSeconds,
      max: 4,
    },
  ).map((result) => result.flow);
  await o.io.write(jobPaths.flows, FlowsFile, {
    schemaVersion: 1,
    flows: selected,
  });
  return selected;
}
