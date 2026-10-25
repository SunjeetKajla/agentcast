import {
  Flow,
  type Target as SemanticTarget,
  type Step,
  type StepAction,
} from "@agentcast/shared";
import type { AgentStep, Candidate, FlowRunResult } from "./agent";
import { productEntry } from "./access";

const ACTIONS: Record<string, StepAction> = {
  navigate: "navigate",
  goto: "navigate",
  open: "navigate",
  click: "click",
  tap: "click",
  "double click": "click",
  check: "click",
  uncheck: "click",
  type: "type",
  fill: "type",
  input: "type",
  enter: "type",
  "enter text": "type",
  select: "select",
  choose: "select",
  press: "press",
  key: "press",
  keypress: "press",
  scroll: "scroll",
  hover: "hover",
  wait: "wait",
};

const SECRET =
  /pass(word|code|phrase)?\b|\bpin\b|\botp\b|one[- ]time|secret|token|api[ _-]?key|card number|\bcvv\b|\bcvc\b/i;

export function hasSecretTarget(
  step: Pick<Step, "action" | "secret" | "target">,
): boolean {
  if ([step.target?.text, step.target?.label, step.target?.placeholder].some(
      (value) => value !== undefined && SECRET.test(value),
    )) return true;
  // Reports sometimes mark every authenticated action secret, even a menu click with no input.
  // Only clear that broad flag for ordinary navigation controls; credential fields remain blocked.
  const navigation = ["click", "hover"].includes(step.action) &&
    ["button", "link", "tab", "menuitem", "checkbox", "radio", "switch", "option"].includes(step.target?.role ?? "");
  return step.secret === true && !navigation;
}
/** Labels that make a step destructive or outward-facing; such flows need explicit approval (PRD §9.2.1). */
export const DESTRUCTIVE =
  /\b(delete|remove|destroy|pay|purchase|buy now|checkout|place order|send|invite|publish|unsubscribe|cancel (my )?(plan|subscription)|deactivate)\b/i;

export type Normalized = {
  flow: Flow;
  /** Hard-gate failures (PRD §9.2.1). A flow with any is shown but not selected. */
  issues: string[];
};

/**
 * Turns one flow run's reported steps into a shared `Flow`:
 * - a leading `navigate` becomes the start URL; later ones are flagged (the recorder can't replay them yet)
 * - targets are cleaned (a typed value reported as the target text is dropped) and password-like fields marked secret
 * - reported results stay descriptions, never checks. Spike S2: agents report a flow's eventual URL on
 *   every step, drop hash routes and paraphrase text, and a wrong check fails a good take. The local
 *   rehearsal learns each step's real outcome instead (PRD §9.3.1).
 */
/** Path segments that are generated ids: UUIDs, long hex, long numbers. */
const SESSION_ID =
  /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|[0-9a-f]{16,}(\/|$)|\d{6,}(\/|$))/i;

export function toFlow(
  r: FlowRunResult,
  ctx: {
    id: string;
    candidate: Pick<
      Candidate,
      "title" | "why_it_matters" | "start_url" | "needs_sign_in"
    >;
    runId: string;
    productUrl: string;
    startedAt?: string;
  },
): Normalized {
  const issues: string[] = [];
  const abs = (u: string | undefined, base = ctx.productUrl) => {
    if (!u) return undefined;
    try {
      return new URL(u, base).toString();
    } catch {
      return undefined;
    }
  };
  // A dedicated flow run starts where we sent it (`startedAt`), so its steps begin there, whatever
  // start_url it reports (often where the flow's main part happens). A first `navigate` still wins.
  let startUrl =
    abs(ctx.startedAt) ??
    abs(r.start_url, abs(ctx.candidate.start_url) ?? ctx.productUrl) ??
    abs(ctx.candidate.start_url) ??
    ctx.productUrl;

  const steps: Step[] = [];
  for (const [i, reported] of r.steps.entries()) {
    const raw = clean(reported);
    const action = ACTIONS[raw.action.trim().toLowerCase()];
    if (!action) {
      issues.push(
        `step ${i + 1} has an action we can't replay ("${raw.action}")`,
      );
      continue;
    }
    // A "navigate" on a named button or link was a click (DemoBoard: navigate "Open workspace", a
    // button): replay it as one. Descriptions ("Navigate to CLI documentation") and URLs aren't.
    const clicked =
      action === "navigate" &&
      ["button", "link", "tab", "menuitem"].includes(raw.target_role ?? "") &&
      raw.target_text &&
      raw.target_text.length <= 40 &&
      !/https?:|^\/|^(navigate|go to|visit|browse)\b/i.test(raw.target_text);
    if (action === "navigate" && !clicked) {
      // Only text that looks like a URL counts; agents also put link text ("TodoMVC") in these fields.
      const urlish = (u?: string) =>
        u && /^(https?:\/\/|\/)/.test(u) ? u : undefined;
      const to = abs(urlish(raw.value) ?? urlish(raw.result_url_path), startUrl);
      if (steps.length === 0) {
        if (to) startUrl = to;
      } else
        issues.push(`step ${i + 1} jumps to a URL instead of clicking there`);
      continue;
    }
    if (action === "wait" && !raw.value) continue;

    const act: StepAction = clicked ? "click" : action;
    const target = targetOf(raw, act);
    const secret = hasSecretTarget({ action: act, target, secret: raw.secret });
    const step: Step = { id: `s${steps.length + 1}`, action: act };
    if (target) step.target = target;
    if (act === "press" && !secret) step.value = raw.value ?? "Enter";
    else if (raw.value && !secret && !raw.secret) step.value = raw.value;
    if (secret) step.secret = true;
    if (secret)
      issues.push(
        "Secret inputs cannot be replayed from an agent report. Omit credential-entry steps and use a saved signed-in session.",
      );
    if (raw.result_visible_text) step.expected = raw.result_visible_text;
    if (raw.narration_hint) step.narrationHint = raw.narration_hint;

    if (["click", "type", "select", "hover"].includes(act) && !target)
      issues.push(`step ${i + 1} (${act}) doesn't say which element`);
    steps.push(step);
  }

  if (!r.completed) issues.push("the agent did not finish the flow");
  for (const b of r.blockers ?? [])
    if (b.trim()) issues.push(`blocked: ${b.trim()}`);
  if (steps.length < 2) issues.push("fewer than 2 steps");
  try {
    productEntry(startUrl, ctx.productUrl);
  } catch {
    issues.push(
      `starts off the product's site (${new URL(startUrl).hostname})`,
    );
  }
  // A start page with a generated id (/projects/eb09b8b3-…) was made in the agent's own browser and won't exist in a fresh one.
  if (!ctx.startedAt && SESSION_ID.test(new URL(startUrl).pathname))
    issues.push(
      `starts on ${new URL(startUrl).pathname}, a page made earlier in the agent's own session; start from a page every visitor has and get there by clicking`,
    );

  const needsApproval = steps.some((s) =>
    DESTRUCTIVE.test(
      [s.target?.text, s.target?.label, s.narrationHint]
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (needsApproval)
    issues.push(
      "The flow contains an outward-facing or destructive action and cannot be rehearsed automatically.",
    );
  const flow = Flow.parse({
    id: ctx.id,
    title: r.flow_title.trim() || ctx.candidate.title,
    whyItMatters: r.value_shown ?? ctx.candidate.why_it_matters,
    startUrl,
    requiresAuth: Boolean(ctx.candidate.needs_sign_in),
    rank: 0,
    selected: false,
    // A flow needs at least one step to be valid; an empty one is kept as a placeholder and gated out.
    steps: steps.length ? steps : [{ id: "s1", action: "wait", value: "1" }],
    ...(ctx.runId ? { tinyfishRunId: ctx.runId } : {}),
    source: "agent",
  });
  return { flow, issues: [...new Set(issues)] };
}

/** Placeholders agents put in fields they have nothing for ("—", "n/a"): not page text. */
const JUNK = /^\s*([—–\-_.·]+|n\/?a|none|null|undefined|unknown)\s*$/i;
const real = (v?: string | null) => (v && !JUNK.test(v) ? v : undefined);
const clean = (raw: AgentStep): AgentStep => ({
  ...raw,
  value: real(raw.value),
  target_text: real(raw.target_text),
  target_label: real(raw.target_label),
  target_placeholder: real(raw.target_placeholder),
  near_text: real(raw.near_text),
});

function targetOf(
  raw: AgentStep,
  action: StepAction,
): SemanticTarget | undefined {
  const t: SemanticTarget = {};
  // Agents often report what they typed as the target's text; that text isn't on the page yet.
  if (
    raw.target_text &&
    !(action === "type" && raw.value && raw.target_text === raw.value)
  )
    t.text = raw.target_text;
  if (raw.target_role && raw.target_role !== "other") t.role = raw.target_role;
  if (raw.target_label) t.label = raw.target_label;
  if (raw.target_placeholder) t.placeholder = raw.target_placeholder;
  if (raw.near_text && raw.near_text !== t.text) t.near = raw.near_text;
  return Object.keys(t).length ? t : undefined;
}

/** Share of replayable steps that name an element (spike S2's pass bar is 80%). */
export function targetCoverage(flows: Flow[]): {
  steps: number;
  targeted: number;
  ratio: number;
} {
  const all = flows
    .flatMap((f) => f.steps)
    .filter((s) => ["click", "type", "select", "hover"].includes(s.action));
  const targeted = all.filter(
    (s) =>
      s.target &&
      (s.target.text ||
        s.target.label ||
        s.target.placeholder ||
        s.target.role),
  ).length;
  return {
    steps: all.length,
    targeted,
    ratio: all.length ? targeted / all.length : 0,
  };
}
