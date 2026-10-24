"use client";

import { useEffect, useState } from "react";
import type { z } from "zod";
import { readArtifact } from "./api";

/**
 * A job's JSON artifact, validated against its schema. `version` is the seq of the artifact event that
 * last wrote it (JobView.artifacts); nothing is fetched until it exists, and a rewrite refetches it.
 */
export function useArtifact<S extends z.ZodType>(jobId: string, rel: string, schema: S, version: number | undefined) {
  const [state, setState] = useState<{ data?: z.output<S>; error?: string; version?: number }>({});

  useEffect(() => {
    if (version === undefined) return;
    let stale = false;
    readArtifact(jobId, rel, schema, version)
      .then((data) => !stale && setState({ data, version }))
      .catch((err: Error) => !stale && setState((s) => ({ ...s, error: err.message })));
    return () => {
      stale = true;
    };
  }, [jobId, rel, schema, version]);

  return { data: state.data, error: state.error, loading: version !== undefined && state.version !== version };
}
