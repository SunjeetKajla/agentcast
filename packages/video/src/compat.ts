// Adapt reference implementation names to the current shared contracts without changing artifacts.
export * from "@agentcast/shared";
import type {
  EdlStyle,
  Segment,
  ShotSegment,
  MotionTokens,
} from "@agentcast/shared";
export type SfxKind = "whoosh" | "click" | "pop" | "riser" | "hit";
export type Motion = MotionTokens;
export type CameraKeyframe = ShotSegment["camera"][number];
export type EdlSegment = Segment;
export type EdlShot = ShotSegment;
export type EdlStatement = Extract<Segment, { kind: "statement" }>;
export type EdlMontage = Extract<Segment, { kind: "montage" }>;
export type EdlStat = Extract<Segment, { kind: "stat" }>;
export type Ramp = NonNullable<ShotSegment["ramps"]>[number];
export type Bbox = [number, number, number, number];
export type VoiceWord = import("@agentcast/shared").Word;
export type Look = EdlStyle["look"];
export const MAX_ZOOM = 2.5;
export const EDL_SCHEMA_VERSION = 5 as const;
export const SCHEMA_VERSION = 1 as const;
export const DEFAULT_LOOK: Look = {
  theme: "dark",
  title: "center",
  statement: "center",
  backdrop: "glow",
  chrome: "browser",
  radius: 16,
};
export const isShot = (segment: Segment): segment is ShotSegment =>
  segment.kind === "shot";
export function bezier([x1, y1, x2, y2]: Motion["easing"], t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const err = x(s) - t;
    if (Math.abs(err) < 1e-6) break;
    const d = dx(s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
  }
  if (s < 0 || s > 1 || Math.abs(x(s) - t) > 1e-4) {
    let lo = 0,
      hi = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      if (x(s) < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
  }
  return ((ay * s + by) * s + cy) * s;
}
