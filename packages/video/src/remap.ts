import type { Bbox, Edl, Storyboard, Timeline, TimelineEvent } from "./compat";

/** The same flow recorded twice: the run the edit was made on, and the new one. */
export type Retake = { before: Timeline; after: Timeline };

const round = (n: number) => Math.round(n * 100) / 100;

/** Events of one flow keyed by step, kind and occurrence, so the two recordings line up step by step. */
function byStep(tl: Timeline, flowId: string) {
  const out = new Map<string, TimelineEvent>();
  const seen = new Map<string, number>();
  for (const e of tl.events) {
    if (e.flowId !== flowId) continue;
    const k = `${e.stepId}/${e.kind}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    out.set(`${k}#${n}`, e);
  }
  return out;
}

/**
 * Source seconds in the old recording → source seconds in the new one (FR-90: "in/out points
 * remapped by step ids"). Each step's pointer start, action and settle in both recordings are
 * anchors; between them time stretches linearly, so a page that now loads slower still cuts on
 * the same moment. Past the last anchor, time runs at the same speed up to the new end.
 */
export function timeMap(
  { before, after }: Retake,
  flowId: string,
): (t: number) => number {
  const a = byStep(before, flowId);
  const b = byStep(after, flowId);
  const pts: Array<[number, number]> = [[0, 0]];
  for (const [k, e] of a) {
    const f = b.get(k);
    if (!f) continue;
    pts.push([e.t, f.t]);
    if (e.cursor && f.cursor)
      pts.push([e.cursor.t0, f.cursor.t0], [e.cursor.t1, f.cursor.t1]);
  }
  pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  // Keep the map increasing in both recordings (a reordered step can't run time backwards).
  const mono: Array<[number, number]> = [];
  for (const p of pts) {
    const last = mono.at(-1);
    if (!last || (p[0] > last[0] && p[1] > last[1])) mono.push(p);
  }
  const end: [number, number] = [before.duration, after.duration];
  if (end[0] > mono.at(-1)![0] && end[1] > mono.at(-1)![1]) mono.push(end);
  return (t) => {
    const i = mono.findIndex(([x]) => x >= t);
    if (i === 0) return 0;
    if (i < 0) {
      const [x, y] = mono.at(-1)!;
      return round(Math.min(after.duration, y + (t - x)));
    }
    const [x0, y0] = mono[i - 1]!;
    const [x1, y1] = mono[i]!;
    return round(y0 + ((t - x0) / (x1 - x0)) * (y1 - y0));
  };
}

const iou = (p: Bbox, q: Bbox) => {
  const w = Math.min(p[0] + p[2], q[0] + q[2]) - Math.max(p[0], q[0]);
  const h = Math.min(p[1] + p[3], q[1] + q[3]) - Math.max(p[1], q[1]);
  const inter = Math.max(0, w) * Math.max(0, h);
  const union = p[2] * p[3] + q[2] * q[3] - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * A box in the old recording → the same element's box in the new one, so zooms and callouts
 * follow an element that moved or resized. The box is matched to the old event whose element it
 * overlaps most (ties go to the one nearest in time), and carried by the same affine move as that
 * element, which keeps any padding the director added. A box that matches nothing stays put.
 */
export function boxMap(
  { before, after }: Retake,
  flowId: string,
): (box: Bbox, t?: number) => Bbox {
  const a = byStep(before, flowId);
  const b = byStep(after, flowId);
  const pairs = [...a].flatMap(([k, e]) => {
    const f = b.get(k);
    return e.bbox && f?.bbox ? [{ t: e.t, from: e.bbox, to: f.bbox }] : [];
  });
  return (box, t) => {
    let best: (typeof pairs)[number] | undefined;
    let score = 0.3; // below this overlap the box isn't about any recorded element
    for (const p of pairs) {
      const s =
        iou(box, p.from) - (t === undefined ? 0 : Math.abs(t - p.t) * 0.01);
      if (s > score) ((best = p), (score = s));
    }
    if (!best) return box;
    const sx = best.from[2] ? best.to[2] / best.from[2] : 1;
    const sy = best.from[3] ? best.to[3] / best.from[3] : 1;
    return [
      round(best.to[0] + (box[0] - best.from[0]) * sx),
      round(best.to[1] + (box[1] - best.from[1]) * sy),
      round(box[2] * sx),
      round(box[3] * sy),
    ];
  };
}

/** A span moved to the new recording, kept inside it and at least half a second long. */
function span(
  map: (t: number) => number,
  a: number,
  b: number,
  duration: number,
) {
  const out = Math.min(duration, Math.max(map(b), map(a) + 0.5));
  return {
    in: round(Math.max(0, Math.min(map(a), out - 0.5))),
    out: round(out),
  };
}

/**
 * The edit moved onto new recordings of the same flows: every source time (shot in/out, ramps,
 * camera keyframes, callouts, lower thirds, sound cues, montage clips) through its flow's time map
 * and every box through its box map. Shots of flows in `drop` (not recorded again) are left out, and
 * a montage left with fewer than two clips goes too. Scenes, durations, text and style are untouched.
 */
export function remapEdl(
  edl: Edl,
  retakes: Record<string, Retake>,
  drop: ReadonlySet<string> = new Set(),
): Edl {
  const kept = (flowId: string) => !drop.has(flowId) && retakes[flowId];
  const segments = edl.segments.flatMap((seg): Edl["segments"] => {
    if (seg.kind === "statement" || seg.kind === "stat") return [seg];
    if (seg.kind === "montage") {
      const clips = seg.clips
        .filter((c) => kept(c.flowId))
        .map((c) => ({
          ...c,
          ...span(
            timeMap(retakes[c.flowId]!, c.flowId),
            c.in,
            c.out,
            retakes[c.flowId]!.after.duration,
          ),
        }));
      return clips.length >= 2 ? [{ ...seg, clips }] : [];
    }
    if (!kept(seg.flowId)) return [];
    const r = retakes[seg.flowId]!;
    const t = timeMap(r, seg.flowId);
    const box = boxMap(r, seg.flowId);
    const moved = { ...seg, ...span(t, seg.in, seg.out, r.after.duration) };
    return [
      {
        ...moved,
        camera: seg.camera.map((k) => ({
          ...k,
          t: t(k.t),
          target: k.target === "full" ? k.target : box(k.target, k.t),
        })),
        ...(seg.ramps
          ? {
              ramps: seg.ramps
                .map((x) => ({
                  ...x,
                  from: Math.max(moved.in, t(x.from)),
                  to: Math.min(moved.out, t(x.to)),
                }))
                .filter((x) => x.to - x.from >= 0.3),
            }
          : {}),
        ...(seg.callouts
          ? {
              callouts: seg.callouts.map((c) => ({
                ...c,
                t: t(c.t),
                anchor: box(c.anchor, c.t),
              })),
            }
          : {}),
        ...(seg.lowerThirds
          ? { lowerThirds: seg.lowerThirds.map((l) => ({ ...l, t: t(l.t) })) }
          : {}),
        ...(seg.sfx ? { sfx: seg.sfx.map((x) => ({ ...x, t: t(x.t) })) } : {}),
      },
    ];
  });
  return { ...edl, segments };
}

/** The storyboard moved onto the new recordings: footage beats' in/out remapped, beats of dropped flows left out. */
export function remapStoryboard(
  storyboard: Storyboard,
  retakes: Record<string, Retake>,
  drop: ReadonlySet<string> = new Set(),
): Storyboard {
  const beats = storyboard.beats
    .filter((b) => !b.flowId || (!drop.has(b.flowId) && retakes[b.flowId]))
    .map((b) => {
      if (!b.flowId || b.in === undefined || b.out === undefined) return b;
      const r = retakes[b.flowId]!;
      return {
        ...b,
        ...span(timeMap(r, b.flowId), b.in, b.out, r.after.duration),
      };
    });
  return { ...storyboard, beats };
}
