"use client";

import { JobEvent, type GateDecision, type GateName, type Job } from "@agentcast/shared";
import { useCallback, useEffect, useReducer, useState } from "react";
import { ApiError, cancelJob, decide as decideGate, getJob } from "./api";
import { initialView, reduceJob, type JobAction, type JobView } from "./job-state";

type State = { view?: JobView };

function reducer(state: State, action: JobAction): State {
  if (!state.view) return action.type === "snapshot" ? { view: initialView(action.job) } : state;
  return { view: reduceJob(state.view, action) };
}

/**
 * A job, kept live: one fetch of its state, then the worker's event stream (replayed from the start,
 * then followed). EventSource reconnects by itself and resumes after the last event it saw.
 */
export function useJob(id: string) {
  const [state, dispatch] = useReducer(reducer, {});
  const [error, setError] = useState<ApiError>();
  const [live, setLive] = useState(false);

  useEffect(() => {
    let closed = false;
    let source: EventSource | undefined;
    getJob(id)
      .then((job) => {
        if (closed) return;
        dispatch({ type: "snapshot", job });
        source = new EventSource(`/api/jobs/${id}/events`);
        source.onopen = () => setLive(true);
        source.onerror = () => setLive(false);
        source.onmessage = (msg) => {
          const parsed = JobEvent.safeParse(JSON.parse(msg.data));
          if (parsed.success) dispatch({ type: "event", event: parsed.data });
        };
      })
      .catch((err: ApiError) => !closed && setError(err));
    return () => {
      closed = true;
      source?.close();
    };
  }, [id]);

  const decide = useCallback(
    async <G extends GateName>(gate: G, decision: GateDecision<G>) => {
      const job = await decideGate(id, gate, decision);
      dispatch({ type: "snapshot", job });
      return job;
    },
    [id],
  );

  const cancel = useCallback(async () => {
    const job: Job = await cancelJob(id);
    dispatch({ type: "snapshot", job });
  }, [id]);

  return { view: state.view, error, live, decide, cancel };
}
