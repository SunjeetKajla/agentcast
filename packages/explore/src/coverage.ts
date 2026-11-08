import {
  BrowserTrace,
  CoverageReport,
  ExplorationBudget,
  ExplorationTask,
} from "@agentcast/shared";
import type { Flow } from "@agentcast/shared";
import { productEntry, diagnosticUrl, accessProblem } from "./access";
import type { PageFacts } from "./tour";
import type { ArtifactIO } from "./runtime";

export { CoverageReport, ExplorationBudget };
export const COVERAGE_PATH = "explore/coverage.json";
export type ExploreBudget = Partial<ExplorationBudget>;
export const explorationBudget = (budget: ExploreBudget = {}) =>
  ExplorationBudget.parse(budget);

const UNSAFE =
  /(?:^|[^a-z0-9])(accounts?|auth|oauth|log[ -]?(?:in|out)|sign[ -]?(?:in|up|out)|register|password|session|checkout|cart|bag|basket|wishlist|buy|purchase|payment|billing|subscribe|unsubscribe|delete|remove|reset|invite|send|submit|upload|download|legal|privacy|terms|cookies?|careers|jobs)(?:$|[^a-z0-9])/i;
const LOCALE =
  /^(?:[a-z]{2}-[a-z]{2}|us|uk|ca|au|in|de|fr|es|it|jp|cn|kr|br|mx|nl|se|no|dk|fi|pl|tr|ae|sa|sg|hk|tw|th|id|vn|ph|my|ch|at|be|ie|nz|za|pt|ru|cz|hu|ro|sk|il|ar|cl|co|pe|en|ja|zh|ko)$/i;

/** Evidence may include a login redirect; recording it does not authorize another navigation. */
function evidenceUrl(value: string, authorizedUrl: string): string | undefined {
  try {
    const url = new URL(productEntry(value, authorizedUrl));
    url.search = "";
    url.hash = "";
    url.pathname =
      url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return;
  }
}

/** Only discovered, safe same-site routes become navigation targets. */
export function coverageUrl(
  value: string,
  authorizedUrl: string,
  label = "",
): string | undefined {
  const canonical = evidenceUrl(value, authorizedUrl);
  if (!canonical) return;
  try {
    const url = new URL(canonical);
    const decoded = decodeURIComponent(url.pathname);
    if (
      UNSAFE.test(`${url.hostname} ${decoded} ${label}`) ||
      /\.(?:pdf|zip|dmg|exe|mp[34]|png|jpe?g|svg|webp)$/i.test(decoded)
    )
      return;
    return canonical;
  } catch {
    return;
  }
}

/** Locale/store prefixes are not product families; iPhone model pages share the iPhone family. */
export function coverageArea(value: string): string {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] && LOCALE.test(parts[0])) parts.shift();
  if (
    ["shop", "store", "products", "product", "features"].includes(
      parts[0] ?? "",
    ) &&
    parts.length > 1
  )
    parts.shift();
  const family = (parts[0] ?? "").replace(
    /^(iphone|ipad|macbook|mac|airpods|watch)(?:-.*)?$/i,
    "$1",
  );
  return `${url.hostname.replace(/^www\./, "")}/${family}`;
}

const count = (paths: CoverageReport["paths"]): CoverageReport["counts"] => ({
  discovered: paths.filter((p) => p.discovered).length,
  observed: paths.filter((p) => p.observed).length,
  attempted: paths.filter((p) => p.attempted).length,
  replayed: paths.filter((p) => p.replayed).length,
  blocked: paths.filter((p) => p.blocked).length,
  unvisited: paths.filter((p) => p.unvisited).length,
});

export function summarizeCoverage(report: CoverageReport): CoverageReport {
  for (const path of report.paths) {
    const agent = path.evidence.filter(
      (e) => e.source === "scout" || e.source === "flow",
    );
    path.inspected = path.evidence.some((e) => e.source === "inspection");
    path.observed = agent.some((e) => e.observed);
    path.attempted = agent.some((e) => e.attempted);
    path.replayed = agent.some((e) => e.source === "flow" && e.replayed);
    path.blocked = agent.some((e) => e.blocked);
    path.unvisited = !path.observed;
  }
  for (const area of report.areas) {
    const paths = report.paths.filter((p) => p.areaId === area.id);
    area.paths = paths.map((p) => p.url);
    area.counts = count(paths);
  }
  report.counts = count(report.paths);
  report.limits.scoutTasks = report.tasks.filter(
    (t) => t.source === "scout",
  ).length;
  report.limits.flowTasks = report.tasks.filter(
    (t) => t.source === "flow",
  ).length;
  report.limits.actions = report.tasks.reduce((n, t) => n + t.actions, 0);
  report.limits.elapsedTaskMs = report.tasks.reduce(
    (n, t) => n + (t.elapsedMs ?? 0),
    0,
  );
  return CoverageReport.parse(report);
}

function addPath(report: CoverageReport, url: string, discovered: boolean) {
  let path = report.paths.find((p) => p.url === url);
  if (path) {
    path.discovered ||= discovered;
    return path;
  }
  const areaId = coverageArea(url);
  let area = report.areas.find((a) => a.id === areaId);
  if (!area && report.areas.length < report.budget.maxSections) {
    area = {
      id: areaId,
      label: new URL(url).pathname.split("/").filter(Boolean)[0] ?? "Home",
      entryUrl: url,
      paths: [],
      counts: count([]),
    };
    report.areas.push(area);
  }
  if (
    !area ||
    report.paths.length >= 480 ||
    report.paths.filter((p) => p.areaId === areaId).length >= 20
  ) {
    report.limits.inventoryTruncated = true;
    return;
  }
  path = {
    url,
    path: new URL(url).pathname,
    areaId,
    discovered,
    inspected: false,
    observed: false,
    attempted: false,
    replayed: false,
    blocked: false,
    unvisited: true,
    evidence: [],
  };
  report.paths.push(path);
  return path;
}

export function navigationInventory(
  url: string,
  facts: PageFacts,
  input: ExploreBudget = {},
): CoverageReport {
  const budget = explorationBudget(input);
  const report: CoverageReport = {
    schemaVersion: 1,
    url: diagnosticUrl(url),
    scope: "bounded-same-site",
    exhaustive: false,
    budget,
    areas: [],
    paths: [],
    counts: count([]),
    tasks: [],
    limits: {
      inventoryTruncated: false,
      excludedLinks: 0,
      candidateFlows: 0,
      selectedFlows: 0,
      scoutTasks: 0,
      flowTasks: 0,
      actions: 0,
      maxAgentActions:
        budget.maxScouts * (budget.scoutMaxActions + 1) +
        budget.maxFlows * 2 * (budget.flowMaxActions + 1),
      maxAgentTimeMs:
        budget.maxScouts * budget.scoutTimeoutMs +
        budget.maxFlows * 2 * budget.flowTimeoutMs,
      elapsedTaskMs: 0,
    },
    notes: [
      "Inventory comes from root-page links, not an exhaustive crawl. Query strings and fragments are omitted.",
      "Observed and attempted-path/action counts require browser traces. Requested task URLs, inspection, proposed candidates, guided tours and successful agent-flow rehearsals are separate evidence.",
      "Unvisited means no agent observation in a saved trace, even when deterministic inspection or a guided tour opened the page.",
      "Task time ceilings include one possible repair per focused flow; they are not a whole-job deadline. Action ceilings include each task's initial navigation. Film selection is limited to four flows.",
      "A task or rehearsal error is not an access block. Blocked paths require a barrier in observed page text.",
      "Elapsed task time is summed from durable task checkpoints, can overlap across concurrent tasks, and does not increase when cached results are reused.",
    ],
  };
  const root = coverageUrl(facts.url, url);
  if (root) {
    const path = addPath(report, root, true);
    path?.evidence.push({
      source: "inspection",
      taskId: "root",
      observed: false,
      attempted: false,
      replayed: false,
      blocked: false,
    });
  }
  // Breadth first: every family gets its main entry before secondary routes fill the path cap.
  const links = facts.links
    .map((l, index) => {
      const resolved = coverageUrl(l.href, facts.url, l.text);
      return {
        ...l,
        index,
        url: resolved ? coverageUrl(resolved, url, l.text) : undefined,
      };
    })
    .sort((a, b) => Number(b.inNav) - Number(a.inNav) || a.index - b.index);
  const unique = new Map<string, (typeof links)[number]>();
  for (const link of links) {
    if (!link.url) {
      report.limits.excludedLinks++;
      continue;
    }
    if (!unique.has(link.url)) unique.set(link.url, link);
  }
  const families = new Map<string, typeof links>();
  for (const link of unique.values()) {
    const family = coverageArea(link.url!);
    const group = families.get(family) ?? [];
    group.push(link);
    families.set(family, group);
  }
  for (const group of families.values()) addPath(report, group[0]!.url!, true);
  for (const group of families.values())
    for (const link of group.slice(1)) addPath(report, link.url!, true);
  return summarizeCoverage(report);
}

export function noteInspection(report: CoverageReport, url: string) {
  const safe = coverageUrl(url, report.url);
  if (safe)
    addPath(report, safe, false)?.evidence.push({
      source: "inspection",
      taskId: "entry",
      observed: false,
      attempted: false,
      replayed: false,
      blocked: false,
    });
}

/** Re-read only validated trace evidence; never infer visits from the agent's prose/report. */
export async function collectTaskCoverage(
  report: CoverageReport,
  io: ArtifactIO,
  task: CoverageReport["tasks"][number],
) {
  task.requestedUrl = diagnosticUrl(task.requestedUrl);
  try {
    const checkpoint = await io.read(
      `explore/tasks/${task.id}.json`,
      ExplorationTask,
    );
    if (checkpoint.state === "interrupted" || checkpoint.state === "uncertain")
      task.status = "interrupted";
    else if (checkpoint.state === "done" || checkpoint.state === "failed")
      task.status = checkpoint.state;
    const elapsed =
      Date.parse(checkpoint.updatedAt) - Date.parse(checkpoint.startedAt);
    if (Number.isFinite(elapsed)) task.elapsedMs = Math.max(0, elapsed);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      (error as { cause?: NodeJS.ErrnoException }).cause?.code !== "ENOENT"
    )
      throw error;
  }
  report.tasks = report.tasks.filter((t) => t.id !== task.id);
  for (const path of report.paths)
    path.evidence = path.evidence.filter(
      (e) =>
        e.taskId !== task.id ||
        e.source === "inspection" ||
        e.source === "tour",
    );
  const requested = coverageUrl(task.requestedUrl, report.url);
  if (requested)
    addPath(report, requested, false)?.evidence.push({
      source: task.source,
      taskId: task.id,
      observed: false,
      attempted: false,
      replayed: false,
      blocked: false,
    });
  try {
    const trace = await io.read(`explore/traces/${task.id}.json`, BrowserTrace);
    task.traceAvailable = true;
    task.actions = trace.steps.filter(
      (s) => !["observe", "wait"].includes(s.action),
    ).length;
    for (const step of trace.steps) {
      const safe = evidenceUrl(
        step.result_url ?? step.result_url_path,
        task.requestedUrl,
      );
      if (!safe || !evidenceUrl(safe, report.url)) continue;
      addPath(report, safe, false)?.evidence.push({
        source: task.source,
        taskId: task.id,
        observed: true,
        attempted: !["observe", "wait"].includes(step.action),
        replayed: false,
        blocked: Boolean(accessProblem(step.result_visible_text ?? "")),
      });
    }
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      (error as { cause?: NodeJS.ErrnoException }).cause?.code !== "ENOENT"
    )
      throw error;
  }
  report.tasks.push(task);
  Object.assign(report, summarizeCoverage(report));
}

/** A rehearsal confirms a flow, not every URL the scout mentioned. Tours have separate evidence. */
export function noteReplay(report: CoverageReport, flow: Flow) {
  const url = coverageUrl(flow.startUrl, report.url);
  if (!url) return;
  const path = addPath(report, url, false);
  if (!path) return;
  const source = flow.source === "tour" ? "tour" : "flow";
  const taskId = `replay-${flow.id}`;
  path.evidence = path.evidence.filter((e) => e.taskId !== taskId);
  path.evidence.push({
    source,
    taskId,
    observed: false,
    attempted: false,
    replayed: Boolean(flow.rehearsal?.ok),
    blocked: false,
  });
}
