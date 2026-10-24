import type { Timeline, TimelineEvent } from "@agentcast/shared";

/** A stretch of one flow's recording the storyboard can use as a beat's footage. */
export type CandidateSpan = {
  id: string;
  flowId: string;
  flowTitle: string;
  /** Source seconds. */
  in: number;
  out: number;
  seconds: number;
  /** What happens in it, in order ("click New project", "type 'Launch plan'"). */
  actions: string[];
  stepIds: string[];
  /** Source second for a representative frame (just after the last action settles). */
  frameAt: number;
};

const LEAD = 0.4;
const TAIL = 1.0;
const PAUSE = 1.5;
const MIN_SECONDS = 2.5;
const MAX_PER_FLOW = 3;

const describe = (e: TimelineEvent) => {
  const v = typeof e.value === "string" ? e.value : e.value ? "••••" : "";
  return e.kind === "type"
    ? `type "${v}"${e.label ? ` into ${e.label}` : ""}`
    : e.kind === "select"
      ? `choose "${v}"`
      : e.kind === "press"
        ? `press ${e.label}`
        : `${e.kind} ${e.label}`.trim();
};
const route = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + (x.hash.startsWith("#/") ? x.hash : "");
  } catch {
    return u;
  }
};

/**
 * Splits each recorded flow into 1–3 candidate spans (plan Phase 4 task 1): a new span starts at a
 * page change or after a pause of more than 1.5 s, spans shorter than 2.5 s merge into the one before,
 * and a flow keeps at most three (the shortest neighbours merge first). Pure, so it's unit-tested.
 */
export function candidateSpans(
  flows: Array<{ flowId: string; title: string; timeline: Timeline }>,
): CandidateSpan[] {
  const out: CandidateSpan[] = [];
  for (const { flowId, title, timeline } of flows) {
    const recorded = timeline.flows.find((flow) => flow.flowId === flowId);
    const acts = timeline.events.filter(
      (e) => e.kind !== "settled" && e.flowId === flowId,
    );
    if (!acts.length) continue;
    const start = (e: TimelineEvent) => e.cursor?.t0 ?? e.t;
    const settledAfter = (e: TimelineEvent) =>
      timeline.events.find(
        (x) =>
          x.kind === "settled" &&
          x.flowId === flowId &&
          x.stepId === e.stepId &&
          x.t >= e.t,
      )?.t ?? e.t;

    let groups: TimelineEvent[][] = [];
    for (const e of acts) {
      const cur = groups.at(-1);
      const prev = cur?.at(-1);
      if (
        cur &&
        prev &&
        route(e.url) === route(prev.url) &&
        start(e) - settledAfter(prev) <= PAUSE
      )
        cur.push(e);
      else groups.push([e]);
    }
    const bounds = (g: TimelineEvent[]) => {
      const a = Math.max(recorded?.in ?? 0, start(g[0]!) - LEAD);
      const b = Math.min(
        recorded?.out ?? timeline.duration,
        settledAfter(g.at(-1)!) + TAIL,
      );
      return { a, b, len: b - a };
    };
    // A short group is usually the result of the action before it: merge it backwards (the first
    // group merges forwards), then cap the count the same way, shortest first.
    const mergeAt = (i: number) => {
      const [lo, hi] = i === 0 ? [0, 1] : [i - 1, i];
      groups.splice(lo, 2, [...groups[lo]!, ...groups[hi]!]);
    };
    for (
      let i = groups.findIndex((g) => bounds(g).len < MIN_SECONDS);
      groups.length > 1 && i >= 0;
      i = groups.findIndex((g) => bounds(g).len < MIN_SECONDS)
    )
      mergeAt(i);
    while (groups.length > MAX_PER_FLOW) {
      let shortest = 0;
      groups.forEach((g, i) => {
        if (bounds(g).len < bounds(groups[shortest]!).len) shortest = i;
      });
      mergeAt(shortest);
    }
    groups = groups.filter((g) => g.length);

    // Padding can make neighbours overlap, which would play the same footage twice: cut halfway
    // between one span's last settle and the next one's first move.
    const cuts = groups.map((g) => ({ ...bounds(g) }));
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i - 1]!.b <= cuts[i]!.a) continue;
      const mid =
        (settledAfter(groups[i - 1]!.at(-1)!) + start(groups[i]![0]!)) / 2;
      cuts[i - 1]!.b = Math.max(
        cuts[i - 1]!.a + 0.5,
        Math.min(cuts[i - 1]!.b, mid),
      );
      cuts[i]!.a = cuts[i - 1]!.b;
    }

    groups.forEach((g, i) => {
      const { a, b } = cuts[i]!;
      const last = g.at(-1)!;
      out.push({
        id: `${flowId}.${String.fromCharCode(97 + i)}`,
        flowId,
        flowTitle: title,
        in: round(a),
        out: round(b),
        seconds: round(b - a),
        actions: g.map(describe),
        stepIds: [...new Set(g.map((e) => e.stepId))],
        frameAt: round(Math.min(b - 0.1, settledAfter(last) + 0.5)),
      });
    });
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
