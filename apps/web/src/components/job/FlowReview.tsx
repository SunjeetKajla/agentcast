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

  if (error) return <p className="field-err">Couldn’t load the flows: {error}</p>;
  if (!rows) return <p className="field-wait">Loading the flows the agents found…</p>;

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
    <section ref={root} className="rv-flows" aria-label="Flows to film">
      <ol className="rv">
        {rows.map((row, i) => {
          const { flow } = row;
          const expanded = open === flow.id;
          const replayed = flow.rehearsal?.ok !== false;
          const frames = flow.steps
            .map((st) => (st.frame ? fileUrl(jobId, st.frame) : st.screenshotUrl))
            .filter((f): f is string => Boolean(f));
          const pick = frames.length <= 4 ? frames : [0, 1, 2, 3].map((k) => frames[Math.round((k * (frames.length - 1)) / 3)]!);
          return (
            <li key={flow.id} data-flip-id={flow.id} data-flow-row className={`rv-item ${row.selected ? "" : "off"}`}>
              <div className="rv-main">
                <input
                  type="checkbox"
                  className="chk"
                  checked={row.selected}
                  disabled={!replayed || sending || working}
                  onChange={(e) => update(i, { selected: e.target.checked })}
                  aria-label={`Film “${row.title}”`}
                />
                <div className="rv-text">
                  <input className="rv-title" value={row.title} onChange={(e) => update(i, { title: e.target.value })} aria-label="Flow title" />
                  {flow.whyItMatters && <p className="rv-why">{flow.whyItMatters}</p>}
                  <p className="rv-meta">
                    {flow.scoring && <>{ROLE[flow.scoring.storyRole]} · judge score {Math.round(flow.scoring.score * 100)} · </>}
                    {flow.steps.length} steps
                    {flow.rehearsal?.seconds ? ` · about ${Math.round(flow.rehearsal.seconds)} s` : ""}
                    {flow.source === "tour" && " · guided tour"}
                    {!replayed && <span className="rv-bad"> · didn’t replay: {flow.rehearsal?.reason ?? "unknown"}</span>}
                  </p>
                </div>
                <div className="frames" data-ui>
                  {pick.length ? pick.map((src, k) => <img key={k} className="fr" src={src} alt={`${row.title}, frame ${k + 1}`} loading="lazy" />) : <span className="fr fr-empty">No frames</span>}
                </div>
                <div className="rv-order">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move “${row.title}” up`}>↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move “${row.title}” down`}>↓</button>
                </div>
              </div>
              <button type="button" className="rv-toggle" onClick={() => setOpen(expanded ? undefined : flow.id)} aria-expanded={expanded}>
                {expanded ? "Hide the steps" : `Show the ${flow.steps.length} steps`}
              </button>
              {expanded && (
                <ol className="steps">
                  {flow.steps.map((step, n) => {
                    const frame = step.frame ? fileUrl(jobId, step.frame) : step.screenshotUrl;
                    const target = step.target?.text ?? step.target?.label ?? step.target?.placeholder ?? step.target?.role;
                    const isEditing = editing?.flowId === flow.id && editing.stepId === step.id;
                    return (
                      <li key={step.id} className="step">
                        {frame ? <img src={frame} alt={`After step ${n + 1}`} loading="lazy" data-ui /> : <span className="step-noframe">No frame</span>}
                        <p>
                          <b>{n + 1}. {step.action}</b>
                          {target && <> “{target}”</>}
                          {step.value && <span className="step-val"> = {step.secret ? "••••" : step.value}</span>}
                          {step.expected && <span className="step-exp">{step.expected}</span>}
                        </p>
                        {isEditing ? (
                          <form
                            className="step-edit"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const body = {
                                flowId: flow.id,
                                stepId: step.id,
                                ...(editing.text.trim() && editing.text.trim() !== target ? { text: editing.text.trim() } : {}),
                                ...(step.action === "type" || step.action === "select" ? { value: editing.value } : {}),
                              };
                              if (await run("edit-step", body)) setEditing(undefined);
                            }}
                          >
                            <label>
                              The element’s text
                              <input value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                            </label>
                            {(step.action === "type" || step.action === "select") && (
                              <label>
                                {step.action === "type" ? "Text to type" : "Option to choose"}
                                <input value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                              </label>
                            )}
                            <div className="step-acts">
                              <button type="submit" className="ab ab-f" disabled={working}>Try it again</button>
                              <button type="button" className="ab ab-f2" onClick={() => setEditing(undefined)}>Cancel</button>
                            </div>
                          </form>
                        ) : (
                          editable(step) && (
                            <button
                              type="button"
                              className="step-btn"
                              disabled={working}
                              onClick={() => setEditing({ flowId: flow.id, stepId: step.id, text: target ?? "", value: step.value ?? "" })}
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
        className="rv-foot"
        onSubmit={async (e) => {
          e.preventDefault();
          if (describe.trim().length >= 3 && (await run("add-flow", { description: describe.trim() }))) setDescribe("");
        }}
      >
        <label htmlFor="describe-flow" className="sr">Describe another flow to film</label>
        <input
          id="describe-flow"
          value={describe}
          onChange={(e) => setDescribe(e.target.value)}
          placeholder="Describe another flow, like “create a project from a template”"
        />
        <button type="submit" className="ab ab-f2" disabled={working || describe.trim().length < 3}>Send to an agent</button>
        <span className="spacer" />
        <button type="button" className="ab ab-f" onClick={approve} disabled={sending || working || chosen === 0}>
          {sending ? "Approving…" : `Approve ${chosen} ${chosen === 1 ? "flow" : "flows"}`} <span className="arr" aria-hidden="true">→</span>
        </button>
      </form>
      {action && (
        <p role="status" className={`rv-status ${action.status}`}>
          {action.status === "started"
            ? action.name === "add-flow"
              ? "An agent is exploring the flow you described, then it’s rehearsed like the others…"
              : "Rehearsing the flow again with your edit…"
            : action.message}
        </p>
      )}
      {problem && <p className="field-err" role="alert">{problem}</p>}
    </section>
  );
}
