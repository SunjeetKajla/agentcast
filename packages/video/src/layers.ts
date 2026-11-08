import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BrandKit, Inventory, LayerList, Rect, Timeline } from "@agentcast/shared";
import type { ShotContent } from "./template.ts";

// Layers (docs/BRAND_MOTION_PLAN.md §3): pieces of the recording cut out as their own images, from the element
// map, so a film can move them on their own (cards rising, a panel sliding in). And the inventory: what a job has
// to build a film from, which art direction chooses against.

type Layer = LayerList["layers"][number];
type Planned = Omit<Layer, "file" | "density">;

const MAX = 24;
const area = (r: Rect) => r[2] * r[3];
const near = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]!) <= 6);

/** The pieces worth cutting out, from each settled page: its panel, its component, its cards, columns and first rows. */
export function planLayers(timeline: Timeline): Planned[] {
  const view = timeline.viewport;
  const screen = view.w * view.h;
  const found: Planned[] = [];
  const add = (kind: Layer["kind"], flowId: string, t: number, box: Rect) => {
    if (box[2] < 24 || box[3] < 16 || area(box) > screen * 0.7) return;
    const same = found.findIndex((l) => l.kind === kind && near(l.box, box));
    // The latest settle of the same piece wins: by then it has its content.
    if (same >= 0) found.splice(same, 1);
    found.push({ id: "", kind, flowId, t, box: box.map((v) => Math.round(v)) as Rect });
  };
  for (const e of timeline.events) {
    const l = e.layout;
    if (e.kind !== "settled" || !l) continue;
    if (l.panel) add("panel", e.flowId, e.t, l.panel);
    if (l.component && !(l.component[1] < view.h * 0.1 && l.component[3] < 140)) add("component", e.flowId, e.t, l.component);
    for (const g of l.groups) {
      const kind = g.kind === "cards" ? "card" : g.kind === "columns" ? "column" : "row";
      const items = g.kind === "rows" ? g.items.slice(0, 6) : g.items.slice(0, 8);
      for (const item of items) add(kind, e.flowId, e.t, item);
    }
  }
  const counts = new Map<string, number>();
  return found.slice(-MAX).map((l) => {
    const n = (counts.get(l.kind) ?? 0) + 1;
    counts.set(l.kind, n);
    return { ...l, id: `${l.kind}-${n}` };
  });
}

function run(args: string[], signal?: AbortSignal) {
  return new Promise<void>((done, fail) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], ...(signal ? { signal } : {}) });
    let errors = "";
    child.stderr.on("data", (c) => (errors += c));
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg: ${errors.trim().slice(-200)}`))));
  });
}

/** Cuts each planned layer out of the recording at its moment: `<dir>/<id>.png`, at the recording's own resolution. */
export async function extractLayers(o: { recording: string; timeline: Timeline; width: number; dir: string; rel: string; signal?: AbortSignal }): Promise<LayerList> {
  await mkdir(o.dir, { recursive: true });
  const density = o.width / o.timeline.viewport.w;
  const layers: Layer[] = [];
  for (const l of planLayers(o.timeline)) {
    const [x, y, w, h] = l.box.map((v) => Math.round(v * density)) as Rect;
    const file = `${o.rel}/${l.id}.png`;
    await run(["-v", "error", "-y", "-ss", String(l.t), "-i", o.recording, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y}`, join(o.dir, `${l.id}.png`)], o.signal);
    layers.push({ ...l, file, density: Math.round(density * 1000) / 1000 });
  }
  return { schemaVersion: 1, layers };
}

/** What a job has to build a film from: the recording's structure, its layers, and the brand kit. */
export function inventoryOf(o: { timeline: Timeline; layers?: LayerList; kit?: BrandKit; theme: "light" | "dark"; colourful: boolean; hero: boolean; density: number; content?: Record<string, ShotContent>; outputs?: number; thirdPartyLogos?: boolean }): Inventory {
  const events = o.timeline.events;
  const groups = events.flatMap((e) => e.layout?.groups ?? []);
  const layers: Record<string, number> = {};
  for (const l of o.layers?.layers ?? []) layers[l.kind] = (layers[l.kind] ?? 0) + 1;
  return {
    typing: events.some((e) => e.kind === "type" && typeof e.value === "string" && e.value.length >= 4),
    board: groups.some((g) => g.kind === "columns") || Object.values(o.content ?? {}).some((c) => c.board),
    list: groups.some((g) => g.kind === "rows" && g.items.length >= 5),
    panel: events.some((e) => e.layout?.panel),
    cards: groups.some((g) => g.kind === "cards" && g.items.length >= 3),
    clicks: events.filter((e) => e.kind === "click" && e.bbox).length,
    captures: o.kit?.captures.length ?? 0,
    logo: o.kit?.logo ? (o.kit.logo.svg ? "vector" : "raster") : "none",
    ...(o.kit?.logo ? { logoKind: o.kit.logo.kind } : {}),
    hero: o.hero,
    theme: o.theme,
    // A brand with colour only in its imagery still has colour.
    colourful: o.colourful || (o.kit?.colours.length ?? 0) >= 2,
    density: Math.round(o.density * 1000) / 1000,
    layers,
    outputs: o.outputs ?? 0,
    cloud: o.thirdPartyLogos ? (o.kit?.cloud.length ?? 0) : 0,
    imagery: o.kit?.imagery.length ?? 0,
  };
}
