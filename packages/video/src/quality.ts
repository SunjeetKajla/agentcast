import {
  Edl,
  type EvidenceFile,
  type QualityIssue,
  type Rect,
  type Timeline,
} from "@agentcast/shared";

import { PATH_MOVE } from "./primitives/cues.ts";

const within = (r: Rect, view: Timeline["viewport"]) =>
  r[0] >= 0 &&
  r[1] >= 0 &&
  r[2] > 0 &&
  r[3] > 0 &&
  r[0] + r[2] <= view.w + 1 &&
  r[1] + r[3] <= view.h + 1;
const wide = (r: Rect, view: Timeline["viewport"]) =>
  r[2] >= view.w * 0.98 && r[3] >= view.h * 0.98;

/** Page-space crops cannot track document-space subjects while the page itself scrolls. */
export function temporalIssues(
  edl: Edl,
  timeline: Timeline,
  evidence?: EvidenceFile,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const s of edl.segments) {
    if (s.kind !== "primitive") continue;
    const p = s.primitive;
    if (!["proof", "prompt", "mockup"].includes(p.type)) continue;
    if (!(p.type === "proof" || p.type === "prompt" || p.type === "mockup"))
      continue;
    const issue = (code: string, message: string) =>
      issues.push({
        code,
        message,
        severity: "error",
        sceneId: s.id,
        flowId: p.flowId,
        repair: "reframe",
      });
    const flow = timeline.flows.find((f) => f.flowId === p.flowId);
    if (!flow || p.in < flow.in - 0.02 || p.out > flow.out + 0.02)
      issue(
        "source.flow",
        "The source interval must stay inside its own flow.",
      );
    if (!within(p.frame, timeline.viewport))
      issue("frame.bounds", "The source crop is outside the recording.");
    const moving = timeline.events.some((e) => {
      if (e.flowId !== p.flowId || !["scroll", "navigate"].includes(e.kind))
        return false;
      const settled =
        timeline.events.find(
          (x) =>
            x.flowId === e.flowId &&
            x.stepId === e.stepId &&
            x.kind === "settled" &&
            x.t >= e.t,
        )?.t ??
        flow?.out ??
        p.out;
      return e.t < p.out && settled > p.in;
    });
    if (
      moving &&
      (!wide(p.frame, timeline.viewport) ||
        (p.type === "proof" && (p.path?.length || p.tilt !== "none")))
    )
      issue(
        "frame.moving-page",
        "Use a steady full-page frame during scrolling/navigation; reframe once the subject settles.",
      );
    if (s.seconds > (p.out - p.in) / 0.6 + 0.05)
      issue(
        "source.freeze",
        "This scene outlasts its source even at the minimum supported playback speed.",
      );
    if (p.type === "proof") {
      for (const stop of p.path ?? [])
        if (
          !within(stop.frame, timeline.viewport) ||
          stop.at < 0 ||
          stop.at + PATH_MOVE > s.seconds
        )
          issue(
            "frame.path",
            "A camera stop is outside the recording or has no time to land.",
          );
      if (p.path?.length && p.hops?.length)
        issue(
          "frame.overlay",
          "Static highlights cannot follow an independently moving camera.",
        );
    }
  }
  if (evidence) {
    for (const s of edl.segments) {
      if (s.kind !== "primitive" || s.primitive.type !== "output") continue;
      const p = s.primitive;
      const source = evidence.outputs.find(
        (o) => o.file === p.file && o.audible,
      );
      if (!source || p.from + p.seconds > source.seconds + 0.1)
        issues.push({
          code: "audio.source",
          severity: "error",
          sceneId: s.id,
          message:
            "The output audio is missing, silent or shorter than its selected interval.",
          repair: "audio",
        });
    }
  }
  return issues;
}

/** Deterministic safe repair shared by benchmarks and production, also applied after the director. */
export function repairTemporalEdl(
  input: Edl,
  timeline: Timeline,
  evidence?: EvidenceFile,
): { edl: Edl; issues: QualityIssue[] } {
  const edl = Edl.parse(structuredClone(input));
  const issues = temporalIssues(edl, timeline, evidence);
  for (const s of edl.segments) {
    if (s.kind !== "primitive") continue;
    const p = s.primitive;
    const codes = issues.filter((i) => i.sceneId === s.id).map((i) => i.code);
    if (!(p.type === "proof" || p.type === "prompt" || p.type === "mockup"))
      continue;
    const flow = timeline.flows.find((f) => f.flowId === p.flowId);
    if (flow) {
      p.in = Math.max(flow.in, p.in);
      p.out = Math.min(flow.out, p.out);
    }
    if (codes.includes("frame.moving-page") || codes.includes("frame.bounds")) {
      p.frame = [0, 0, timeline.viewport.w, timeline.viewport.h];
      if (p.type === "proof") {
        delete p.path;
        delete p.hops;
        p.tilt = "none";
      }
    }
    if (p.type === "proof" && codes.includes("frame.path")) delete p.path;
    if (p.type === "proof" && codes.includes("frame.overlay")) delete p.hops;
    if (codes.includes("source.freeze")) {
      const beat = 60 / (edl.style.music.bpm ?? 120);
      s.seconds = Math.max(
        beat,
        Math.floor((p.out - p.in) / 0.6 / beat) * beat,
      );
    }
  }
  return { edl: Edl.parse(edl), issues };
}
