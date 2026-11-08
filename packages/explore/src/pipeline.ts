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
import type { ExplorationAgent, ExplorationRequest } from "@agentcast/browser";
import type { ExplorationUpdate } from "./task";
import {
  Candidate,
  FlowRunResult,
  ScoutResult,
  scoutSchema,
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
import { PageAccessError, safeId } from "./local";
import {
  COVERAGE_PATH,
  CoverageReport,
  explorationBudget,
  navigationInventory,
  collectTaskCoverage,
  coverageUrl,
  coverageArea,
  noteInspection,
  noteReplay,
  summarizeCoverage,
  type ExploreBudget,
} from "./coverage";

export type ExploreOptions = {
  url: string;
  dir: string;
  io: ArtifactIO;
  agent: ExplorationAgent;
  llm: Llm;
  browser: BrowserAdapter;
  product: ProductBrief;
  creative: CreativeBrief;
  signal?: AbortSignal;
  browserOptions?: Omit<BrowserOptions, "signal" | "authorizedUrl" | "dir">;
  publicMode: boolean;
  log?: (message: string) => void;
  onAgent?: (
    id: string,
    title: string,
    status: "started" | "step" | "done" | "failed" | "cancelled",
    run?: ExplorationUpdate,
  ) => void;
  progress?: (value: number, message: string) => void;
  deadlines?: { scoutMs?: number; flowMs?: number; intervalMs?: number };
  budget?: ExploreBudget;
};
const budgetOf = (o: ExploreOptions) =>
  explorationBudget({
    ...o.budget,
    ...(o.deadlines?.scoutMs ? { scoutTimeoutMs: o.deadlines.scoutMs } : {}),
    ...(o.deadlines?.flowMs ? { flowTimeoutMs: o.deadlines.flowMs } : {}),
  });
async function readCoverage(o: ExploreOptions) {
  try {
    return await o.io.read(COVERAGE_PATH, CoverageReport);
  } catch (error) {
    if (!missing(error)) throw error;
    return undefined;
  }
}
const coverageWrites = new WeakMap<CoverageReport, Promise<unknown>>();
const saveCoverage = (o: ExploreOptions, report: CoverageReport) => {
  const next = (coverageWrites.get(report) ?? Promise.resolve()).then(() =>
    o.io.write(COVERAGE_PATH, CoverageReport, summarizeCoverage(report)),
  );
  coverageWrites.set(report, next);
  return next;
};
const browserOptions = (o: ExploreOptions): BrowserOptions => ({
  ...o.browserOptions,
  dir: o.dir,
  authorizedUrl: o.url,
  signal: o.signal,
  captureAssets: false,
});

/** Check a reported route locally with the same session before paying for a focused run. */
export async function verifyFlowEntry(
  o: ExploreOptions,
  requested: string,
): Promise<string> {
  const url = productEntry(requested, o.url);
  try {
    const page = await o.browser.inspect(url, browserOptions(o));
    productEntry(page.facts.url, o.url);
    // Keep a stable entrance such as /login; a redirect may name a session-only workspace.
    return url;
  } catch (error) {
    o.signal?.throwIfAborted();
    if (
      !o.publicMode &&
      (error as { kind?: string }).kind === "sign-in-required"
    )
      throw new PageAccessError(
        "sign-in-required",
        "The saved session was rejected or has expired at the app entrance. Sign in again before exploring authenticated flows.",
      );
    throw error;
  }
}
const missing = (error: unknown) =>
  (error as { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT" ||
  (error as NodeJS.ErrnoException).code === "ENOENT";

async function agent<S extends typeof ScoutResult | typeof FlowRunResult>(
  o: ExploreOptions,
  id: string,
  title: string,
  request: ExplorationRequest,
  schema: S,
  scout = false,
  coverage?: CoverageReport,
) {
  const budget = budgetOf(o);
  const maxMs = scout ? budget.scoutTimeoutMs : budget.flowTimeoutMs;
  const maxSteps = scout ? budget.scoutMaxActions : budget.flowMaxActions;
  let status: "done" | "failed" | "interrupted" = "failed";
  if (coverage) {
    await collectTaskCoverage(coverage, o.io, {
      id,
      source: scout ? "scout" : "flow",
      requestedUrl: request.url,
      status: "running",
      maxActions: maxSteps,
      timeoutMs: maxMs,
      actions: 0,
      traceAvailable: false,
    });
    await saveCoverage(o, coverage);
  }
  o.onAgent?.(id, title, "started");
  try {
    const result = await runTask({
      id,
      request,
      schema,
      io: o.io,
      agent: o.agent,
      storageState: o.browserOptions?.storageState,
      signal: o.signal,
      maxMs,
      maxSteps,
      onUpdate: (run) =>
        o.onAgent?.(
          id,
          title,
          run.status === "COMPLETED" ? "done" : "step",
          run,
        ),
    });
    status = "done";
    o.onAgent?.(id, title, "done");
    return result;
  } catch (error) {
    if (o.signal?.aborted) status = "interrupted";
    o.onAgent?.(id, title, o.signal?.aborted ? "cancelled" : "failed");
    throw error;
  } finally {
    if (coverage) {
      await collectTaskCoverage(coverage, o.io, {
        id,
        source: scout ? "scout" : "flow",
        requestedUrl: request.url,
        status,
        maxActions: maxSteps,
        timeoutMs: maxMs,
        actions: 0,
        traceAvailable: false,
      });
      await saveCoverage(o, coverage);
    }
  }
}

/** The local page is checked independently before an agent's access classification is accepted. */
export async function discoverProduct(
  o: ExploreOptions,
): Promise<ExplorationPlan> {
  const local = await o.browser.inspect(o.url, browserOptions(o));
  const coverage = navigationInventory(o.url, local.facts, budgetOf(o));
  await saveCoverage(o, coverage);
  const budget = coverage.budget;
  let entryUrl = o.url;
  const candidates: Candidate[] = [];
  const seenCandidates = new Set<string>();
  const blocked: string[] = [];
  let firstScout: ScoutResult | undefined;
  const targetIds = new Set<string>();
  const sections = coverage.areas.map((a) => ({
    label: a.label,
    url: a.entryUrl,
  }));
  const pendingSections = () =>
    coverage.areas.filter(
      (area) =>
        !targetIds.has(area.id) &&
        coverageUrl(area.entryUrl, o.url) &&
        !coverage.paths.some(
          (p) =>
            p.areaId === area.id &&
            p.evidence.some(
              (e) => e.source === "scout" && (e.observed || e.attempted),
            ),
        ),
    );
  for (let index = 0; index < budget.maxScouts; index++) {
    o.signal?.throwIfAborted();
    // Reserve candidate slots for actual visits to additional major sections.
    const target = index === 0 ? undefined : pendingSections()[0];
    if (index && !target) break;
    const requested = target?.entryUrl ?? o.url;
    targetIds.add(coverageArea(requested));
    const remaining = budget.maxFlows - candidates.length;
    if (remaining <= 0) break;
    const futureScouts = Math.min(
      budget.maxScouts - index,
      1 + pendingSections().length,
    );
    const candidateLimit = Math.max(1, Math.ceil(remaining / futureScouts));
    let scout: ScoutResult;
    try {
      const result = await agent(
        o,
        index ? `scout-section-${index}` : "scout",
        target
          ? `Explore ${target.label}`
          : "Find product sections and entrance",
        {
          url: requested,
          goal: scoutGoal({
            url: requested,
            domain: new URL(o.url).hostname,
            product: o.product.name,
            focus: o.creative.mustShow.join("; "),
            signedIn: !o.publicMode,
            maxCandidates: candidateLimit,
            sections,
            ...(target
              ? { targetSection: { label: target.label, url: requested } }
              : {}),
          }),
          output_schema: scoutSchema(candidateLimit),
        },
        ScoutResult,
        true,
        coverage,
      );
      scout = ScoutResult.parse(result.result);
      if (!firstScout) firstScout = scout;
      blocked.push(...(scout.blockers ?? []));
    } catch (error) {
      o.signal?.throwIfAborted();
      const reason =
        error instanceof Error
          ? error.message.split("\n")[0]
          : "Unknown provider failure";
      o.log?.(
        `Browser scout ${index + 1} stopped (${reason?.slice(0, 200)}). Its checkpoint is retained without retry; other inventory sections remain eligible.`,
      );
      // A different section is new work, never a retry of interrupted browser actions.
      continue;
    }
    let scoutEntry = requested;
    try {
      scoutEntry = await verifyFlowEntry(
        o,
        productEntry(scout.entry_url, requested),
      );
      noteInspection(coverage, scoutEntry);
      if (index === 0) entryUrl = scoutEntry;
    } catch (error) {
      o.signal?.throwIfAborted();
      if (
        !o.publicMode &&
        (error as { kind?: string }).kind === "sign-in-required"
      )
        throw new Error(
          "The saved session no longer opens the authenticated product. Sign in again before exploring authenticated flows.",
        );
    }
    const safe: Candidate[] = [];
    for (const candidate of scout.candidates) {
      if (
        offSite(candidate, o.url) ||
        (o.publicMode && candidate.needs_sign_in) ||
        DESTRUCTIVE.test([candidate.title, ...candidate.outline].join(" "))
      )
        continue;
      const start = coverageUrl(candidate.start_url || scoutEntry, scoutEntry);
      if (!start || !coverageUrl(start, o.url)) continue;
      const normalized = Candidate.parse({
        ...candidate,
        start_url: start,
        needs_sign_in: !o.publicMode && Boolean(candidate.needs_sign_in),
        performed: false,
        steps: [],
      });
      const key = `${start}|${candidate.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()}`;
      if (seenCandidates.has(key)) continue;
      seenCandidates.add(key);
      safe.push(normalized);
    }
    // Round-robin areas, so a long list from one family cannot crowd out other sections.
    const groups = new Map<string, Candidate[]>();
    for (const candidate of safe) {
      const key = coverageArea(candidate.start_url);
      const group = groups.get(key) ?? [];
      group.push(candidate);
      groups.set(key, group);
    }
    for (
      let row = 0;
      candidates.length < budget.maxFlows && row < safe.length;
      row++
    ) {
      for (const group of groups.values()) {
        if (
          candidates.length >= budget.maxFlows ||
          candidates.length >= budget.maxFlows - remaining + candidateLimit
        )
          break;
        if (group[row]) candidates.push(group[row]!);
      }
      if (candidates.length >= budget.maxFlows - remaining + candidateLimit)
        break;
    }
    coverage.limits.candidateFlows = candidates.length;
    await saveCoverage(o, coverage);
    // Access barriers stop this section only. Other authorized sections can still be public.
  }
  coverage.limits.candidateFlows = candidates.length;
  await saveCoverage(o, coverage);
  const plan = ExplorationPlan.parse({
    schemaVersion: 2,
    entryUrl,
    access: o.publicMode
      ? "public"
      : firstScout?.access === "authenticated"
        ? "authenticated"
        : "public",
    reason: candidates.length
      ? "The entrance opens independently in local Chrome; candidates still require focused execution and rehearsal."
      : "Local Chrome confirmed a usable public surface; independently rehearsed guided tours will supplement agent discovery.",
    blockers: [...new Set(blocked)],
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
    schemaVersion: 2,
    flowHash: hash,
    ...result,
  });
  return result;
}

/** Focused runs execute independently; each successful rehearsal is durable before another completes. */
export async function executeFlows(o: ExploreOptions): Promise<Flow[]> {
  const plan = await o.io.read("explore/plan.json", ExplorationPlan);
  const coverage = await readCoverage(o);
  // This also catches an authenticated session expiring between discovery and rehearsal.
  o.progress?.(
    0.02,
    "Checking the product page locally before rehearsing flows",
  );
  const page = await o.browser.inspect(plan.entryUrl, browserOptions(o));
  if (coverage) noteInspection(coverage, page.facts.url);
  const candidates = plan.candidates.slice(0, budgetOf(o).maxFlows);
  const entries = new Map<string, Promise<string>>([
    [plan.entryUrl, Promise.resolve(productEntry(plan.entryUrl, o.url))],
  ]);
  o.log?.(
    "Local page inspection finished; preparing the candidate rehearsals.",
  );
  const results = new Map<string, Flow>();
  const replay = ReplayPlan.parse({
    schemaVersion: 1,
    byFormFactor: { desktop: {} },
  });
  let writes: Promise<unknown> = Promise.resolve();
  const save = () => {
    writes = writes.then(async () => {
      await o.io.write(jobPaths.flows, FlowsFile, {
        schemaVersion: 2,
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
    if (coverage) {
      noteReplay(coverage, result.flow);
      await saveCoverage(o, coverage);
    }
  };
  let next = 0;
  let completed = 0;
  const perform = async () => {
    while (next < candidates.length) {
      o.signal?.throwIfAborted();
      const index = next++;
      const candidate = candidates[index]!;
      const id = `f${index + 1}`;
      let startUrl: string;
      try {
        const requested = productEntry(
          candidate.start_url || plan.entryUrl,
          plan.entryUrl,
        );
        if (!entries.has(requested))
          entries.set(requested, verifyFlowEntry(o, requested));
        startUrl = await entries.get(requested)!;
      } catch (error) {
        o.signal?.throwIfAborted();
        const normalized = toFlow(
          FlowRunResult.parse({
            flow_title: candidate.title,
            completed: false,
            steps: [],
          }),
          {
            id,
            candidate,
            productUrl: o.url,
            runId: "",
            startedAt: plan.entryUrl,
          },
        );
        await remember({
          flow: {
            ...normalized.flow,
            rehearsal: {
              ok: false,
              reason: `Candidate entrance could not be verified: ${(error as Error).message.split("\n")[0]}`,
            },
          },
        });
        o.progress?.(
          ++completed / Math.max(1, candidates.length),
          `Checked ${completed} candidate flows`,
        );
        continue;
      }
      let previous: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const run = await agent(
            o,
            attempt ? `${id}-repair` : id,
            candidate.title,
            {
              url: startUrl,
              goal: flowGoal(
                { ...candidate, start_url: startUrl },
                new URL(startUrl).hostname,
                previous,
                !o.publicMode,
              ),
              output_schema: FLOW_RUN_SCHEMA,
            },
            FlowRunResult,
            false,
            coverage,
          );
          const normalized = toFlow(FlowRunResult.parse(run.result), {
            id,
            candidate,
            runId: run.runId,
            productUrl: o.url,
            startedAt: startUrl,
          });
          if (normalized.issues.length) {
            previous = [...new Set(normalized.issues)].join("; ");
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
          // Interrupted actions have durable evidence. Never replay them as an automatic repair.
          o.log?.(
            `Flow ${index + 1} stopped; other completed rehearsals are preserved.`,
          );
          break;
        }
      }
      o.progress?.(
        ++completed / Math.max(1, candidates.length),
        `Rehearsed ${completed} candidate flows`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(2, candidates.length) }, perform),
  );
  if ([...results.values()].filter((flow) => flow.rehearsal?.ok).length < 2) {
    const tours = tourFlows(page.facts, o.product.name).slice(0, 4);
    for (const source of tours) {
      const tour = {
        ...source,
        source: "tour" as const,
        requiresAuth: !o.publicMode,
      };
      o.progress?.(
        0.1 + results.size * 0.15,
        `Rehearsing local tour: ${tour.title}`,
      );
      o.log?.(`Rehearsing local tour: ${tour.title}`);
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
    schemaVersion: 2,
    flows: selected,
  });
  if (coverage) {
    coverage.limits.selectedFlows = selected.filter(
      (flow) => flow.selected,
    ).length;
    await saveCoverage(o, coverage);
  }
  return selected;
}
