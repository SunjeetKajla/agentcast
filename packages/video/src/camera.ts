import type { CameraKey, MotionTokens } from "@agentcast/shared";
import { moveSeconds, settled } from "./motion.ts";

// The virtual camera: which part of the recording is on screen at each moment.

/** A view of the recording, in recording CSS pixels. */
export type Crop = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The view for one camera key: as large as the output's shape allows inside the recording, divided by
 * the zoom, centred on the target and kept inside the recording. A target too wide for the view keeps
 * its left edge in sight (where text starts); a 9:16 output at zoom 1 is a full-height column.
 */
export function cropFor(target: CameraKey["target"], zoom: number, src: Size, aspect: number): Crop {
  let h = src.h;
  let w = h * aspect;
  if (w > src.w) {
    w = src.w;
    h = w / aspect;
  }
  w /= zoom;
  h /= zoom;
  const [cx, cy] =
    target === "full"
      ? [src.w / 2, src.h / 2]
      : [target[2] > w * 0.9 ? target[0] + w * 0.45 : target[0] + target[2] / 2, target[1] + target[3] / 2];
  return { x: clamp(cx - w / 2, 0, src.w - w), y: clamp(cy - h / 2, 0, src.h - h), w, h };
}

const mix = (a: Crop, b: Crop, k: number): Crop => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  w: a.w + (b.w - a.w) * k,
  h: a.h + (b.h - a.h) * k,
});

/**
 * The view at source second `t`. The camera shows the whole frame until the first key; each key
 * starts a move from wherever the camera is at that moment, so keys closer together than a move
 * chain smoothly instead of jumping. `cut` keys arrive at once.
 */
export function cameraAt(keys: CameraKey[], t: number, src: Size, aspect: number, motion: MotionTokens): Crop {
  const full = cropFor("full", 1, src, aspect);
  let move = { from: full, to: full, at: 0, seconds: 0 };
  const along = (m: typeof move, time: number) =>
    m.seconds ? mix(m.from, m.to, settled(motion, (time - m.at) / m.seconds)) : m.to;
  for (const key of [...keys].sort((a, b) => a.t - b.t)) {
    if (key.t > t) break;
    move = {
      from: along(move, key.t),
      to: cropFor(key.target, key.zoom, src, aspect),
      at: key.t,
      seconds: key.ease === "cut" ? 0 : moveSeconds(motion),
    };
  }
  return along(move, t);
}

/** How far the view is zoomed in at this crop (1 = the whole frame). */
export const zoomOf = (crop: Crop, src: Size, aspect: number) => cropFor("full", 1, src, aspect).w / crop.w;

/** A recording point in output pixels, through a crop shown at `out` size. */
export function project([x, y]: [number, number], crop: Crop, out: Size): [number, number] {
  return [((x - crop.x) / crop.w) * out.w, ((y - crop.y) / crop.h) * out.h];
}

/** Whether the centre of a box (recording pixels) is in the view at source second `t`, as a 16:9 output frames it. */
export function inView(
  keys: CameraKey[],
  t: number,
  box: [number, number, number, number],
  src: Size,
  motion: MotionTokens,
): boolean {
  const crop = cameraAt(keys, t, src, 16 / 9, motion);
  const [x, y] = [box[0] + box[2] / 2, box[1] + box[3] / 2];
  return x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h;
}

/** A box cut to the recording's edges; undefined if nothing of it is on the page. */
export function onPage(box: [number, number, number, number], src: Size): [number, number, number, number] | undefined {
  const x0 = Math.max(0, box[0]);
  const y0 = Math.max(0, box[1]);
  const x1 = Math.min(src.w, box[0] + box[2]);
  const y1 = Math.min(src.h, box[1] + box[3]);
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? [x0, y0, x1 - x0, y1 - y0] : undefined;
}
