import { Edl, MOTION_PRESETS, type Brand, type Personality, type Primitive, type Rect, type Script, type Segment, type Storyboard, type Timeline, type TimelineEvent } from "@agentcast/shared";
import { brandStyle } from "./baseline.ts";
import { planParts } from "./plan.ts";

// The music-led edit without an LLM (PRD §9.7.6): a short opener, then one "label, then proof" module
// per storyboard shot, then the end card, every part a whole number of the track's beats. Each shot's
// move is chosen from what the page was doing when it was recorded.

export type LedInput = {
  timeline: Timeline;
  storyboard: Storyboard;
  scripts: Record<string, Script>;
  personality: Personality;
  targetSeconds: number;
  brand?: Brand;
  /** The picked track's style and grid. Without one the film still keeps time, at 120 BPM, in silence. */
  music?: Edl["style"]["music"];
  grid?: { beat: number; bar: number };
  /** The product's own terms, for a ticker when there's room. */
  terms?: string[];
  /** What each shot's page actually shows, by beat id: where to look when the page's structure doesn't say. */
  content?: Record<string, ShotContent>;
};

/** The region of a shot's page with something on it, the moment it was seen, and how much of the screen it fills. */
export type ShotContent = {
  t: number;
  box: Rect;
  fill: number;
  /** Columns read from the pixels, for a board that isn't in the DOM. */
  board?: { t: number; columns: Rect[]; cards: Rect[] };
};

/** Too little on screen to be worth a shot. */
const MIN_FILL = 0.14;

const r2 = (n: number) => Math.round(n * 100) / 100;
const area = (r: Rect) => r[2] * r[3];

/** A number of whole beats near `seconds`, in units of `multiple` beats. */
const onBeats = (seconds: number, beat: number, multiple = 1) => Math.max(multiple, Math.round(seconds / beat / multiple) * multiple) * beat;

/** The region around `box` worth showing: wide enough to read as a piece of the product. */
function frameAround(box: Rect, view: { w: number; h: number }): Rect {
  const w = Math.min(view.w, Math.max(box[2] * 1.5, view.w * 0.5));
  const h = Math.min(view.h, Math.max(box[3] * 1.8, w * 0.62));
  const x = Math.max(0, Math.min(view.w - w, box[0] + box[2] / 2 - w / 2));
  const y = Math.max(0, Math.min(view.h - h, box[1] + box[3] / 2 - h / 2));
  return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
}

const inside = (r: Rect, box: Rect) => r[0] >= box[0] - 2 && r[1] >= box[1] - 2 && r[0] + r[2] <= box[0] + box[2] + 2 && r[1] + r[3] <= box[1] + box[3] + 2;

/** The piece nearest the middle of the screen, avoiding the edges the page may fade out. */
function nearestMiddle(items: Rect[], view: { w: number; h: number }) {
  const distance = (r: Rect) => Math.hypot(r[0] + r[2] / 2 - view.w / 2, r[1] + r[3] / 2 - view.h / 2);
  return [...items].sort((a, b) => distance(a) - distance(b))[0];
}

type Shot = { flowId: string; in: number; out: number; events: TimelineEvent[] };
type Option = { kind: Primitive["type"]; make: (seconds: number) => Primitive };

/** What this shot could be, best first. */
function optionsFor(shot: Shot, timeline: Timeline, tilt: "soft" | "strong", beat: number, content?: ShotContent): Option[] {
  const view = timeline.viewport;
  const flow = timeline.flows.find((f) => f.flowId === shot.flowId);
  const options: Option[] = [];
  const span = (from: number, seconds: number, firstNeeded = 0) => {
    // Starts so the footage has reached `from` by `firstNeeded` seconds in, stays in the flow.
    const limit = flow?.out ?? shot.out;
    const start = Math.max(flow?.in ?? shot.in, Math.min(from - firstNeeded, limit - seconds));
    return { in: r2(start), out: r2(Math.min(limit, start + seconds)) };
  };

  const typed = shot.events.find((e) => e.kind === "type" && e.bbox && typeof e.value === "string" && e.value.length >= 4);
  if (typed) {
    const settled = shot.events.find((e) => e.kind === "settled" && e.stepId === typed.stepId);
    const frame = settled?.layout?.panel ?? settled?.layout?.component ?? frameAround(typed.bbox!, view);
    options.push({
      kind: "prompt",
      make: (seconds) => ({ type: "prompt", flowId: shot.flowId, ...span(typed.t - 0.2, Math.max(seconds, Math.min(seconds * 2.5, String(typed.value).length / 14 + 1))), input: typed.bbox!, frame }),
    });
  }

  const screen = view.w * view.h;
  const mapped = [...shot.events.filter((e) => e.layout)].reverse();
  const moments = (e: TimelineEvent) => e.layout!.at ?? e.t;
  const nextAction = (t: number) => {
    const next = timeline.events.find((e) => e.flowId === shot.flowId && e.kind !== "settled" && (e.cursor?.t0 ?? e.t) > t);
    return next ? (next.cursor?.t0 ?? next.t) : (flow?.out ?? shot.out);
  };

  // The page building up: the most movement a page can give.
  for (const event of mapped) {
    const layout = event.layout!;
    const grid = layout.groups.find((g) => (g.kind === "columns" || g.kind === "cards") && area(g.box) >= screen * 0.2);
    if (!grid) continue;
    const pieces = layout.groups.filter((g) => g !== grid && g.items.every((r) => inside(r, grid.box))).flatMap((g) => g.items);
    const liftable = (pieces.length ? pieces : grid.items).filter((r) => area(r) <= screen * 0.25 && area(r) >= screen * 0.012);
    const lift = nearestMiddle(liftable, view);
    options.push({
      kind: "build",
      make: () => ({ type: "build", flowId: shot.flowId, at: r2(moments(event)), items: grid.items.slice(0, 12), reveal: "rise", ...(lift ? { lift } : {}) }),
    });
    break;
  }

  if (!options.length && content?.board) {
    const { t, columns, cards } = content.board;
    const lift = nearestMiddle(cards.filter((r) => area(r) >= screen * 0.012), view);
    options.push({ kind: "build", make: () => ({ type: "build", flowId: shot.flowId, at: r2(t), items: columns, reveal: "rise", ...(lift ? { lift } : {}) }) });
  }

  // A list, with a highlight hopping down it, once the page has stopped moving.
  for (const event of mapped) {
    const layout = event.layout!;
    const rows = layout.groups.find((g) => g.kind === "rows" && g.items.length >= 5 && g.items.every((r) => r[3] <= 90) && area(g.box) >= screen * 0.08);
    if (!rows) continue;
    const at = moments(event);
    const frame = layout.panel ?? frameAround(rows.box, view);
    const hops = rows.items.filter((r) => inside(r, frame)).slice(1, 4);
    options.push({
      kind: "proof",
      make: (seconds) => {
        const quiet = nextAction(at) - at;
        const count = Math.min(hops.length, Math.floor(quiet / beat));
        const first = seconds - count * beat;
        return { type: "proof", flowId: shot.flowId, ...span(at, seconds, first), frame, tilt, ...(count ? { hops: hops.slice(0, count) } : {}) };
      },
    });
    break;
  }

  // A panel that opened: from the moment it has nearly arrived.
  for (const event of mapped) {
    const panel = event.layout!.panel;
    if (!panel || event.kind !== "settled") continue;
    const opened = moments(event);
    // Opened in the flow's last moments: there's nothing to see of it.
    if ((flow?.out ?? shot.out) - opened < 1) continue;
    options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(opened, seconds, 0.4), frame: panel, tilt }) });
    break;
  }

  // No structure to go on: what's actually on the screen, around what was acted on.
  const acted = shot.events.find((e) => e.layout?.component) ?? shot.events.find((e) => e.bbox);
  const component = acted?.layout?.component;
  if (component) options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(acted!.t, seconds, seconds * 0.5), frame: frameAround(component, view), tilt }) });
  if (content && content.fill >= MIN_FILL) options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(content.t, seconds, seconds * 0.5), frame: frameAround(content.box, view), tilt }) });
  else if (!content) {
    // Never measured: around what was acted on, or the middle of the page.
    const box = acted?.bbox ?? ([view.w * 0.2, view.h * 0.2, view.w * 0.6, view.h * 0.6] as Rect);
    options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(acted?.t ?? shot.in, seconds, seconds * 0.5), frame: frameAround(box, view), tilt }) });
  }
  return options;
}

/** A music-led edit from the storyboard and what was recorded. */
export function ledEdl(o: LedInput): Edl {
  const { storyboard, timeline } = o;
  const grid = o.grid ?? { beat: 0.5, bar: 2 };
  const { beat, bar } = grid;
  const langs = Object.keys(o.scripts);
  const byLang = (pick: (script: Script) => string | undefined, fallback: string) =>
    Object.fromEntries((langs.length ? langs : ["en"]).map((lang) => [lang, (o.scripts[lang] && pick(o.scripts[lang]!)) || fallback]));
  const onScreen = (beatId: string, index: number, fallback: string) => byLang((s) => s.segments.find((x) => x.beatId === beatId)?.onScreen[index], fallback);
  const titleOf = (b: Storyboard["beats"][number]) => {
    const i = b.onScreen.findIndex((x) => x.kind === "title");
    return i < 0 ? undefined : onScreen(b.id, i, b.onScreen[i]!.text);
  };

  const openerSeconds = onBeats(4, beat, 4);
  const endSeconds = onBeats(4, beat, 4);
  const moduleSeconds = onBeats(4, beat, 4);
  const labelSeconds = onBeats(1, beat);
  const room = Math.max(1, Math.floor((o.targetSeconds - openerSeconds - endSeconds) / moduleSeconds));

  const shots = storyboard.beats.filter((b) => b.flowId !== undefined && b.in !== undefined && b.out !== undefined);
  if (!shots.length) throw new Error("The storyboard has no footage to cut.");
  const segments: Segment[] = [];
  let last: Primitive["type"] | undefined;
  let used = 0;
  const count = Math.min(room, shots.length);
  shots.slice(0, count).forEach((shot, index) => {
    const position = storyboard.beats.indexOf(shot);
    const before = storyboard.beats[position - 1];
    const label = titleOf(shot) ?? (before && before.flowId === undefined && before.role !== "hook" ? titleOf(before) : undefined);
    const events = timeline.events.filter((e) => e.flowId === shot.flowId && e.t >= shot.in! && e.t <= shot.out! + 0.5);
    const tilt = index % 2 ? "strong" : "soft";
    const options = optionsFor({ flowId: shot.flowId!, in: shot.in!, out: shot.out!, events }, timeline, tilt, beat, o.content?.[shot.id]);
    // Nothing worth showing on this shot's page.
    if (!options.length) return;
    // Two of the same in a row reads as a template.
    const option = options.find((c) => c.kind !== last) ?? options[0]!;
    last = option.kind;
    const middle = index === Math.floor(count / 2) && count >= 3;
    const proofSeconds = moduleSeconds - (label ? labelSeconds : 0);
    if (label) {
      segments.push({
        kind: "primitive",
        id: `${shot.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-label`.replace(/^[^a-z]+/, "b"),
        beatId: shot.id,
        // A flip of the whole frame at the film's midpoint; the first opens out of the opener's line.
        primitive: { type: "label", text: label, ground: middle ? "invert" : "base", open: index === 0 ? "slit" : middle ? "iris" : "rise" },
        seconds: r2(labelSeconds),
        transitionIn: "cut",
      });
    }
    segments.push({
      kind: "primitive",
      id: `${shot.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-proof`.replace(/^[^a-z]+/, "b"),
      beatId: shot.id,
      primitive: option.make(proofSeconds),
      seconds: r2(proofSeconds),
      transitionIn: "cut",
    });
    used++;
  });
  // Every shot looked empty: a film still needs its one proof, and the page is all there is.
  if (!segments.length) {
    const shot = shots[0]!;
    segments.push({
      kind: "primitive",
      id: "proof",
      beatId: shot.id,
      primitive: { type: "proof", flowId: shot.flowId!, in: r2(shot.in!), out: r2(shot.out!), frame: [0, 0, timeline.viewport.w, timeline.viewport.h], tilt: "soft" },
      seconds: r2(moduleSeconds),
      transitionIn: "cut",
    });
  }
  // The product's real terms, if the film has the room for one more bar.
  const terms = (o.terms ?? []).filter((t) => t.length <= 24).slice(0, 6);
  if (terms.length >= 3 && used < room && used >= 2)
    segments.push({
      kind: "primitive",
      id: "terms",
      primitive: { type: "ticker", terms: terms.map((t) => ({ en: t })) },
      seconds: r2(Math.max(bar, onBeats(2, beat, 4))),
      transitionIn: "cut",
    });

  const motion = { ...MOTION_PRESETS[o.personality], zoom: Math.min(2.5, Math.max(MOTION_PRESETS[o.personality].zoom, 1.65)) };
  return Edl.parse({
    schemaVersion: 7,
    fps: 30,
    style: {
      ...brandStyle(o.brand, o.personality),
      pacing: "punchy",
      edit: "trailer",
      captionStyle: "minimal",
      music: o.music ?? { mood: "none", bpm: 120, duckDb: -6 },
      sfx: "auto",
      timing: "music",
      frame: "none",
      motion,
    },
    intro: { component: "Opener", props: { line: byLang((s) => s.titleCard || s.hook, o.brand?.url ?? "") }, seconds: r2(openerSeconds) },
    segments,
    outro: { component: "EndCard", props: { line: byLang((s) => s.cta, "") }, seconds: r2(endSeconds) },
  });
}

/** A film's length. */
export const filmSeconds = (edl: Edl) => planParts(edl, []).frames / edl.fps;

/** Rounds every part with a free length to whole beats. Footage shots keep theirs, so they can drift the grid. */
export function snapToGrid(edl: Edl): { edl: Edl; moved: number } {
  const beat = 60 / (edl.style.music.bpm ?? 120);
  let moved = 0;
  const snap = (seconds: number) => {
    const to = Math.max(1, Math.round(seconds / beat)) * beat;
    if (Math.abs(to - seconds) > beat / 2) moved++;
    return r2(to);
  };
  return {
    edl: {
      ...edl,
      intro: { ...edl.intro, seconds: snap(edl.intro.seconds) },
      outro: { ...edl.outro, seconds: snap(edl.outro.seconds) },
      segments: edl.segments.map((s) => (s.kind === "primitive" || s.kind === "scene" || s.kind === "statement" || s.kind === "stat" ? { ...s, seconds: snap(s.seconds) } : s)),
    },
    moved,
  };
}
