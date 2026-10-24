"use client";
/* eslint-disable @next/next/no-img-element */

import { useLayoutEffect, useRef, useState } from "react";
import { FlowsFile, jobPaths, type Flow, type GateDecision, type JobEvent } from "@agentcast/shared";
import { fileUrl, gateAction } from "@/lib/api";
import { useArtifact } from "@/lib/useArtifact";
import { EASE, Flip, MOTION_OK, STAGGER, gsap, useGSAP, settle } from "@/lib/motion";

// Gate 1 (PRD §5.1, FR-30): choose, order and rename the flows to film. Each flow shows why it was
// picked and the frame after every step of its local rehearsal. A step can be corrected (it's
// rehearsed again), and another flow can be described (an agent explores it, then it's rehearsed).

type Row = { flow: Flow; selected: boolean; title: string };
/** The latest gate action's event (edit-step or add-flow), if any. */
type ActionEvent = Extract<JobEvent, { type: "action" }>;

/** Steps whose element (and value) can be corrected here. Secret inputs can't (use sign-in-once). */
const editable = (step: Flow["steps"][number]) =>
  ["click", "type", "select", "hover"].includes(step.action) && !step.secret && Boolean(step.target);

/** Keeps the person's choices (selection, order, titles) when the flows are rewritten; new flows go last. */
function merge(rows: Row[] | undefined, flows: Flow[]): Row[] {
  const fresh = new Map(flows.map((f) => [f.id, f]));
  const kept = (rows ?? []).flatMap((r) => {
    const flow = fresh.get(r.flow.id);
    // A flow whose edit didn't replay is deselected by the worker; follow it.
    return flow
      ? [
          {
            ...r,
            flow,
            selected: r.selected && flow.selected !== false && flow.rehearsal?.ok !== false,
          },
        ]
      : [];
  });
  const known = new Set(kept.map((r) => r.flow.id));
  const added = [...flows]
    .sort((a, b) => a.rank - b.rank)
    .filter((f) => !known.has(f.id))
    .map((flow) => ({ flow, selected: flow.selected && flow.rehearsal?.ok !== false, title: flow.title }));
  return [...kept, ...added];
}

const ROLE = {
  setup: "Setup",
  core: "Core",
  payoff: "Payoff",
  share: "Share",
} as const;

export default function FlowReview({
  jobId,
  version,
  action,
  onApprove,
}: {
  jobId: string;
  version: number | undefined;
  /** The latest gate action event, to show what's being tried and how it went. */
  action?: ActionEvent;
  onApprove: (decision: GateDecision<"gate-flows">) => Promise<unknown>;
}) {
  const { data, error } = useArtifact(jobId, jobPaths.flows, FlowsFile, version);
  const [rows, setRows] = useState<Row[]>();
  const [merged, setMerged] = useState<typeof data>();
  const [open, setOpen] = useState<string>();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [editing, setEditing] = useState<{
    flowId: string;
    stepId: string;
    text: string;
    value: string;
  }>();
  const [describe, setDescribe] = useState("");
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const flipState = useRef<Flip.FlipState | undefined>(undefined);
  const working = asking || action?.status === "started";

  // First load, and every rewrite of flows.json after an edit or a new flow.
  if (data && data !== merged) {
    setMerged(data);
    setRows(merge(rows, data.flows));
    if (!rows) setOpen([...data.flows].sort((a, b) => a.rank - b.rank).find((f) => f.selected)?.id);
  }

  const run = async (name: "edit-step" | "add-flow", body: unknown) => {
    setAsking(true);
    setProblem(undefined);
    try {
      await gateAction(jobId, "gate-flows", name, body);
      return true;
    } catch (err) {
      setProblem((err as Error).message);
      return false;
    } finally {
      setAsking(false);
    }
  };

  // Rows arrive in order once the flows have loaded.
  useGSAP(
    () => {
      if (!rows) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          "[data-flow-row]",
          ...settle({
            autoAlpha: 0,
            y: 20,
            duration: 0.7,
            ease: EASE.expo,
            stagger: STAGGER.item,
          }),
        );
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [rows === undefined] },
  );

  // Reordering: the rows glide to their new places (FLIP), instead of jumping.
  useLayoutEffect(() => {
    if (!flipState.current) return;
    if (window.matchMedia(MOTION_OK).matches) {
      Flip.from(flipState.current, {
        duration: 0.45,
        ease: EASE.out,
        targets: "[data-flow-row]",
      });
    }
    flipState.current = undefined;
  }, [rows]);

  if (error) return <p className="text-sm text-red-400">Couldn&apos;t load the flows: {error}</p>;
  if (!rows) return <p className="text-sm text-white/50">Loading the flows the agents found…</p>;

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    flipState.current = Flip.getState(root.current!.querySelectorAll("[data-flow-row]"));
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRows(next);
  };
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.selected).length;

  const approve = async () => {
    setSending(true);
    setProblem(undefined);
    try {
      await onApprove({
        action: "approve",
        flows: rows.map((r) => ({
          id: r.flow.id,
          selected: r.selected,
          title: r.title.trim() || r.flow.title,
        })),
      });
    } catch (err) {
      setProblem((err as Error).message);
      setSending(false);
    }
  };

  return (
    <section ref={root} className="space-y-6" aria-labelledby="flows-title">
      <div className="space-y-1">
        <h2 id="flows-title" className="font-serif text-3xl text-white">
          Which flows should we film?
        </h2>
        <p className="text-sm text-white/60">
          The agents tried these on your product and rehearsed each one in a fresh browser. Pick and order the ones for
          the video; rename any to change its chapter title.
        </p>
      </div>

      <ol className="space-y-3">
        {rows.map((row, i) => {
          const { flow } = row;
          const expanded = open === flow.id;
          const replayed = flow.rehearsal?.ok !== false;
          return (
            <li
              key={flow.id}
              data-flip-id={flow.id}
              data-flow-row
              className={`overflow-hidden rounded-2xl border bg-[#121215]/80 transition-colors ${
                row.selected ? "border-accent/40" : "border-white/10 opacity-70"
              }`}
            >
              <div className="flex items-start gap-3 p-4">
                <input
                  type="checkbox"
                  checked={row.selected}
                  disabled={!replayed || sending || working}
                  onChange={(e) => update(i, { selected: e.target.checked })}
                  aria-label={`Film "${row.title}"`}
                  className="mt-1.5 h-4 w-4 cursor-pointer accent-[#8B5CF6]"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    value={row.title}
                    onChange={(e) => update(i, { title: e.target.value })}
                    aria-label="Flow title"
                    className="w-full rounded-lg bg-transparent px-1 -mx-1 text-base font-medium text-white outline-none focus:bg-white/[0.04] focus:ring-1 focus:ring-accent/40"
                  />
                  <p className="text-sm text-white/60">{flow.whyItMatters}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {flow.scoring && (
                      <>
                        <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent">
                          {ROLE[flow.scoring.storyRole]}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-white/70">
                          score {flow.scoring.score.toFixed(2)}
                        </span>
                      </>
                    )}
                    <span className="text-white/50">
                      {flow.steps.length} steps
                      {flow.rehearsal?.seconds ? ` · ~${Math.round(flow.rehearsal.seconds)} s` : ""}
                    </span>
                    {flow.source === "tour" && <span className="text-white/50">· Guided tour</span>}
                    {!replayed && (
                      <span className="text-amber-400">
                        · didn&apos;t replay: {flow.rehearsal?.reason ?? "unknown"}
                      </span>
                    )}
                  </div>
                  {flow.scoring?.rationale && <p className="text-xs italic text-white/45">{flow.scoring.rationale}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="rounded-md px-2 py-0.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-20"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1}
                    aria-label="Move down"
                    className="rounded-md px-2 py-0.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-20"
                  >
                    ▼
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(expanded ? undefined : flow.id)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between border-t border-white/[0.05] px-4 py-2 text-xs text-white/50 transition-colors hover:bg-white/[0.03] hover:text-white"
              >
                <span>{expanded ? "Hide steps" : "Show steps"}</span>
                <span className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>▾</span>
              </button>
              {expanded && (
                <ol className="grid gap-3 border-t border-white/[0.05] p-4 sm:grid-cols-2">
                  {flow.steps.map((step, n) => {
                    const frame = step.frame ? fileUrl(jobId, step.frame) : step.screenshotUrl;
                    const target =
                      step.target?.text ?? step.target?.label ?? step.target?.placeholder ?? step.target?.role;
                    return (
                      <li key={step.id} className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/30">
                        {frame && (
                          <img
                            src={frame}
                            alt={`After step ${n + 1}`}
                            className="aspect-video w-full object-cover"
                            loading="lazy"
                          />
                        )}
                        <p className="p-3 text-xs text-white/70">
                          <span className="capitalize text-white">{step.action}</span>
                          {target && <> “{target}”</>}
                          {step.value && <span className="text-white/45"> = {step.secret ? "••••" : step.value}</span>}
                          {step.expected && <span className="block pt-1 text-white/40">{step.expected}</span>}
                        </p>
                        {editing?.flowId === flow.id && editing.stepId === step.id ? (
                          <form
                            className="space-y-2 border-t border-white/[0.06] p-3"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const body = {
                                flowId: flow.id,
                                stepId: step.id,
                                ...(editing.text.trim() && editing.text.trim() !== target
                                  ? { text: editing.text.trim() }
                                  : {}),
                                ...(step.action === "type" || step.action === "select" ? { value: editing.value } : {}),
                              };
                              if (await run("edit-step", body)) setEditing(undefined);
                            }}
                          >
                            <label className="block text-[11px] text-white/50">
                              The element&apos;s text
                              <input
                                value={editing.text}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    text: e.target.value,
                                  })
                                }
                                className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-accent/50"
                              />
                            </label>
                            {(step.action === "type" || step.action === "select") && (
                              <label className="block text-[11px] text-white/50">
                                {step.action === "type" ? "Text to type" : "Option to choose"}
                                <input
                                  value={editing.value}
                                  onChange={(e) =>
                                    setEditing({
                                      ...editing,
                                      value: e.target.value,
                                    })
                                  }
                                  className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-accent/50"
                                />
                              </label>
                            )}
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={working}
                                className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black disabled:opacity-30"
                              >
                                Try it again
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditing(undefined)}
                                className="text-[11px] text-white/50 hover:text-white"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          editable(step) && (
                            <button
                              type="button"
                              disabled={working}
                              onClick={() =>
                                setEditing({
                                  flowId: flow.id,
                                  stepId: step.id,
                                  text: target ?? "",
                                  value: step.value ?? "",
                                })
                              }
                              className="w-full border-t border-white/[0.06] px-3 py-1.5 text-left text-[11px] text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-30"
                            >
                              Edit this step
                            </button>
                          )
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ol>

      <form
        className="space-y-2 rounded-2xl border border-dashed border-white/10 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (describe.trim().length >= 3 && (await run("add-flow", { description: describe.trim() }))) setDescribe("");
        }}
      >
        <label htmlFor="describe-flow" className="text-sm text-white/80">
          Describe another flow to film
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="describe-flow"
            value={describe}
            onChange={(e) => setDescribe(e.target.value)}
            placeholder="e.g. Create a project from a template and invite a teammate"
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-accent/50"
          />
          <button
            type="submit"
            disabled={working || describe.trim().length < 3}
            className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm text-white transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            Explore it
          </button>
        </div>
        <p className="text-xs text-white/40">
          An agent tries it on your product, then it&apos;s rehearsed in a fresh browser like the others.
        </p>
      </form>

      {action && (
        <p
          role="status"
          className={`text-sm ${action.status === "failed" ? "text-red-400" : action.status === "done" ? "text-green-400" : "text-white/60"}`}
        >
          {action.status === "started"
            ? action.name === "add-flow"
              ? "Exploring the flow you described, then rehearsing it…"
              : "Rehearsing the flow with your edit…"
            : action.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={approve}
          disabled={sending || working || chosen === 0}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-30"
        >
          {sending ? "Approving…" : `Approve & record ${chosen} flow${chosen === 1 ? "" : "s"}`}
        </button>
        {problem && <p className="text-sm text-red-400">{problem}</p>}
      </div>
    </section>
  );
}
