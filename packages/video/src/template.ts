import { Edl, MOTION_PRESETS, type Brand, type BrandMotion, type ShotCall, type FilmSkeleton, type Personality, type Primitive, type ProductShape, type Rect, type ReferenceLibrary, type Script, type Segment, type Storyboard, type Timeline, type TimelineEvent } from "@agentcast/shared";
import { brandStyle } from "./baseline.ts";
import { planParts } from "./plan.ts";

// The music-led edit without an LLM (PRD §9.7.6): an opener, then one module per storyboard shot, then the
// end card, every part a whole number of the track's beats. A skeleton from the reference library
// (PRD §9.7.7) sets the film's structure and rhythm; each shot's move is chosen from what the page was doing
// when it was recorded.

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
  /** The film's structure. Without one, label-then-proof modules. */
  skeleton?: FilmSkeleton;
  /** Picks where the skeleton's look cycles start (the job or the site), so brands differ. */
  seed?: string;
  /** Art direction's moves (PRD §9.7.8): tried first, in this order, and never used unless nothing else fits. */
  prefer?: Primitive["type"][];
  avoid?: Primitive["type"][];
  /** Art direction's brand moves: the logo's motion, the cursor, the ground. */
  motion?: BrandMotion;
  /** The job's brand material for brand moves (job-relative files). */
  assets?: {
    /** The site's own pages, for a wall. */
    captures?: string[];
    /** Other companies' logos, already consented to, for an orbit. */
    cloud?: string[];
    /** The product's outputs: where each arrived in the recording, its length and its waveform. */
    outputs?: { file: string; flowId: string; t: number; seconds: number; peaks: number[] }[];
    /** The brand's own objects (brand kit imagery), round whole ones first, for the imagery ground and discs. */
    imagery?: { file: string; colour: string; round: boolean }[];
    /** The brand's colours read from its imagery. */
    colours?: string[];
  };
  /** What each recorded step acted on, by `flowId/stepId` (flows.json): the button's own words, a choice's label. */
  steps?: Record<string, StepLabel>;
  /** Art direction's calls on single shots, by beat id: crop and headline. */
  shots?: Record<string, ShotCall>;
};

/** A step's target as the flow recorded it. */
export type StepLabel = { action: string; text?: string; value?: string };

/**
 * A recorded choice as a chip: a language code in its own script and in English ("ta-IN" → "தமிழ் · Tamil"),
 * anything else the option's own text.
 */
export function chipFor(step: StepLabel): string | undefined {
  const code = step.value?.trim() ?? "";
  if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code)) {
    const base = code.split("-")[0]!;
    try {
      const english = new Intl.DisplayNames(["en"], { type: "language" }).of(base);
      const native = new Intl.DisplayNames([base], { type: "language" }).of(base);
      if (english && english !== base) return native && native.toLowerCase() !== english.toLowerCase() ? `${native} · ${english}` : english;
    } catch {
      // Not a language after all.
    }
  }
  const text = step.text?.trim();
  return text && text.length <= 32 ? text : undefined;
}

/** A film's edit, with the skeleton it was built on and the shots it left out. */
export type LedPlan = { edl: Edl; skeleton: FilmSkeleton; dropped: { beatId: string; title?: string; reason: string }[] };

/** The structure when no library is given. Must match the library's "modules" entry. */
export const DEFAULT_SKELETON: FilmSkeleton = {
  id: "modules",
  name: "Label, then proof",
  feel: "A short line, then the product proving it, once per feature. Steady and clear.",
  learnedFrom: [
    { film: "linear-for-agents", took: "a dark lifted UI after each short line" },
    { film: "raycast-pro", took: "the label card before each proof" },
  ],
  suits: [],
  openerBeats: 8,
  module: { labelBeats: 2, proofBeats: 6, proofsPerShot: 1, maxModules: 5, camera: "hold" },
  look: { labelOpen: ["rise"], grounds: ["base"], tilts: ["soft", "strong"], flipMiddle: true },
  ticker: true,
  endBeats: 8,
  target: { changesPer10s: [2, 4], stillPct: 10 },
};

/** The region of a shot's page with something on it, the moment it was seen, and how much of the screen it fills. */
export type ShotContent = {
  t: number;
  box: Rect;
  fill: number;
  /** The busiest half-screen region: where to look when content covers most of the page. */
  focus?: Rect;
  /** Columns read from the pixels, for a board that isn't in the DOM. */
  board?: { t: number; columns: Rect[]; cards: Rect[] };
};

/** Too little on screen to be worth a shot. */
const MIN_FILL = 0.14;

const r2 = (n: number) => Math.round(n * 100) / 100;
const area = (r: Rect) => r[2] * r[3];

/** The region around `box` worth showing: wide enough to read as a piece of the product. */
function frameAround(box: Rect, view: { w: number; h: number }): Rect {
  // Some room around it, but never so much that a wide box turns into the whole page.
  const w = Math.min(view.w, Math.max(box[2] + Math.min(box[2] * 0.5, view.w * 0.1), view.w * 0.5));
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

/** A piece's top, as a card: what a tall column offers to lift. */
function topOf(r: Rect | undefined): Rect | undefined {
  return r ? [r[0], r[1], r[2], Math.round(Math.min(r[3], r[2] * 0.7))] : undefined;
}

/** A component worth framing: not a nav bar across the top, not most of the screen. */
const worthFraming = (r: Rect, view: { w: number; h: number }) =>
  area(r) <= view.w * view.h * 0.5 && r[3] >= 80 && !(r[1] < view.h * 0.1 && r[3] < 140);
type Option = { kind: Primitive["type"]; make: (seconds: number) => Primitive };

/** What this shot could be, best first. */
function optionsFor(shot: Shot, timeline: Timeline, tilt: "soft" | "strong", beat: number, content?: ShotContent, cursor = false, prefer: Primitive["type"][] = [], extra: { steps?: Record<string, StepLabel>; call?: ShotCall } = {}): Option[] {
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
  // The typing rebuilt as a glow pill, when art direction wants it: the hand presses send if the recording
  // clicked soon after typing.
  if (typed && prefer.includes("pill")) {
    const send = timeline.events.find((e) => e.flowId === shot.flowId && e.kind === "click" && e.t > typed.t && e.t - typed.t <= 3 + String(typed.value).length / 14);
    const sent = Boolean(send);
    // A long value types its first sentences up to 48 characters (at least one): read at a glance, typed in time.
    const value = String(typed.value);
    const sentences = value.split(/(?<=[.!?।])\s/);
    let text = sentences[0] ?? value;
    for (const next of sentences.slice(1)) if ((text + " " + next).length <= 48) text += " " + next; else break;
    text = value.length > 48 ? text.slice(0, 64) : value;
    // The pill wears the recording's own words: the button that was pressed, the choices made before typing.
    const label = send ? extra.steps?.[`${shot.flowId}/${send.stepId}`]?.text?.trim() : undefined;
    const button = label && label.length <= 40 ? label : undefined;
    const chips = timeline.events
      .filter((e) => e.flowId === shot.flowId && e.kind === "select" && e.t < typed.t)
      .map((e) => extra.steps?.[`${shot.flowId}/${e.stepId}`] ?? { action: "select", ...(typeof e.value === "string" ? { value: e.value } : {}) })
      .map(chipFor)
      .filter((c): c is string => Boolean(c))
      .slice(0, 2);
    options.push({ kind: "pill", make: () => ({ type: "pill", flowId: shot.flowId, text, at: r2(typed.t), press: sent, ...(button ? { button } : {}), ...(chips.length ? { chips } : {}) }) });
  }
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
    // A tall piece (a column) lifts its top, as a card; with nothing to lift, the middle column's, so the build never just holds.
    const pick = nearestMiddle(liftable, view) ?? nearestMiddle(grid.items, view);
    const lift = pick && pick[3] > pick[2] * 1.2 ? topOf(pick) : pick;
    options.push({
      kind: "build",
      make: () => ({ type: "build", flowId: shot.flowId, at: r2(moments(event)), items: grid.items.slice(0, 12), reveal: "rise", ...(lift ? { lift } : {}) }),
    });
    break;
  }

  if (!options.length && content?.board) {
    const { t, columns, cards } = content.board;
    const lift = nearestMiddle(cards.filter((r) => area(r) >= screen * 0.012), view) ?? topOf(nearestMiddle(columns, view));
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
    // With a hand cursor, from just before the click that opened it: the hand clicks, then the panel opens.
    const cause = cursor ? shot.events.find((e) => e.kind === "click" && e.bbox && e.t <= opened && opened - e.t <= 1.5) : undefined;
    options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...(cause ? span(cause.t, seconds, 0.8) : span(opened, seconds, 0.4)), frame: cause ? frameAround([Math.min(panel[0], cause.bbox![0]), panel[1], Math.max(panel[0] + panel[2], cause.bbox![0] + cause.bbox![2]) - Math.min(panel[0], cause.bbox![0]), panel[3]], view) : panel, tilt }) });
    break;
  }

  // No structure to go on: what's actually on the screen, around what was acted on.
  const acted = shot.events.find((e) => e.layout?.component && worthFraming(e.layout.component, view)) ?? shot.events.find((e) => e.bbox);
  const component = acted?.layout?.component && worthFraming(acted.layout.component, view) ? acted.layout.component : undefined;
  if (component) options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(acted!.t, seconds, seconds * 0.5), frame: frameAround(component, view), tilt }) });
  if (content && content.fill >= MIN_FILL) {
    // Content over most of the page reads as a page, too small to read: its busiest part instead.
    const box = content.box[2] > view.w * 0.6 && content.focus ? content.focus : content.box;
    options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(content.t, seconds, seconds * 0.5), frame: frameAround(box, view), tilt }) });
  }
  else if (!content) {
    // Never measured: around what was acted on, or the middle of the page.
    const box = acted?.bbox ?? ([view.w * 0.2, view.h * 0.2, view.w * 0.6, view.h * 0.6] as Rect);
    options.push({ kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(acted?.t ?? shot.in, seconds, seconds * 0.5), frame: frameAround(box, view), tilt }) });
  }
  // Art direction's crop for this shot comes first (its preferred moves still rank ahead of it).
  const at = 0;
  const actions = shot.events.filter((e) => e.bbox && (e.kind === "click" || e.kind === "type" || e.kind === "select"));
  if (extra.call?.crop === "acted" && actions.length) {
    // Just where things were done: the union of what was clicked, typed and chosen.
    const x0 = Math.min(...actions.map((e) => e.bbox![0])), y0 = Math.min(...actions.map((e) => e.bbox![1]));
    const x1 = Math.max(...actions.map((e) => e.bbox![0] + e.bbox![2])), y1 = Math.max(...actions.map((e) => e.bbox![1] + e.bbox![3]));
    const box: Rect = [x0, y0, x1 - x0, y1 - y0];
    const from = actions[0]!.t;
    options.splice(at, 0, { kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(from, seconds, Math.min(0.8, seconds * 0.3)), frame: frameAround(box, view), tilt }) });
  } else if (extra.call?.crop === "page") {
    options.splice(at, 0, { kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(content?.t ?? shot.in, seconds, seconds * 0.4), frame: [0, 0, view.w, view.h] as Rect, tilt }) });
  } else if (extra.call?.crop === "focus" && content?.focus) {
    const focus = content.focus;
    options.splice(at, 0, { kind: "proof", make: (seconds) => ({ type: "proof", flowId: shot.flowId, ...span(content.t, seconds, seconds * 0.5), frame: frameAround(focus, view), tilt }) });
  }
  // The shot on a laptop, when art direction wants a mockup: its whole page, from where the content settles.
  if (prefer.includes("mockup")) {
    const from = content?.t ?? shot.in;
    options.push({ kind: "mockup", make: (seconds) => ({ type: "mockup", flowId: shot.flowId, ...span(from, seconds, seconds * 0.4), frame: [0, 0, view.w, view.h] as Rect, device: "laptop" }) });
  }
  return options;
}

/**
 * One take over a shot: its footage plays through while the camera eases from region to region of the
 * page, each move on a beat. The regions are the ones the page showed as it settled, in the order it did.
 */
function glideFor(shot: Shot, timeline: Timeline, tilt: "soft" | "strong", beat: number, seconds: number, content?: ShotContent): Primitive | undefined {
  const view = timeline.viewport;
  const flow = timeline.flows.find((f) => f.flowId === shot.flowId);
  const from = Math.max(flow?.in ?? shot.in, shot.in);
  const to = Math.min(flow?.out ?? shot.out, shot.out, from + seconds * 3);
  if (to - from < 1) return undefined;
  const speed = Math.max(0.6, Math.min(3, (to - from) / seconds));
  const regions: { t: number; frame: Rect }[] = [];
  for (const e of shot.events) {
    const l = e.layout;
    if (!l) continue;
    const group = l.groups.find((g) => area(g.box) >= view.w * view.h * 0.08 && area(g.box) <= view.w * view.h * 0.7);
    const region = l.panel ?? (l.component && worthFraming(l.component, view) ? l.component : undefined) ?? group?.box;
    if (region) regions.push({ t: l.at ?? e.t, frame: frameAround(region, view) });
  }
  if (content?.focus) regions.push({ t: content.t, frame: frameAround(content.focus, view) });
  regions.sort((a, b) => a.t - b.t);
  // The first region was measured once the page settled; if that's well after the take starts, the page is still
  // animating in there (Sarvam's orbs slide in), so the window opens on the whole page and glides in.
  const settledLate = regions[0] && regions[0].t - from > 0.5;
  const start = settledLate ? ([0, 0, view.w, view.h] as Rect) : (regions[0]?.frame ?? frameAround(content?.box ?? [view.w * 0.2, view.h * 0.2, view.w * 0.6, view.h * 0.6], view));
  const path: { at: number; frame: Rect }[] = [];
  let last = start;
  for (const r of regions) {
    const same = Math.abs(r.frame[0] - last[0]) < view.w * 0.08 && Math.abs(r.frame[1] - last[1]) < view.h * 0.08 && Math.abs(r.frame[2] - last[2]) < view.w * 0.08;
    // On the beat, after the window has arrived, with two beats before the next move and the end.
    const at = Math.max(beat * 2, Math.round((r.t - from) / speed / beat) * beat);
    if (same || at > seconds - beat * 2 || (path.length && at - path.at(-1)!.at < beat * 2)) continue;
    path.push({ at: r2(at), frame: r.frame });
    last = r.frame;
    if (path.length === 4) break;
  }
  if (!path.length) return undefined;
  return { type: "proof", flowId: shot.flowId, in: r2(from), out: r2(to), frame: start, tilt, path };
}

/** Options in art direction's order: preferred kinds first, avoided kinds dropped unless nothing else is left. */
function ranked(options: Option[], prefer: Primitive["type"][] = [], avoid: Primitive["type"][] = []): Option[] {
  const kept = options.filter((c) => !avoid.includes(c.kind));
  const pool = kept.length ? kept : options;
  const rank = (c: Option) => (prefer.includes(c.kind) ? prefer.indexOf(c.kind) : prefer.length);
  return pool.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({ c }) => c);
}

/** What a recorded shot mostly shows, from its element map: decides the skeletons that suit it. */
export function productShape(storyboard: Storyboard, timeline: Timeline, content?: Record<string, ShotContent>): ProductShape {
  const shots = storyboard.beats.filter((b) => b.flowId !== undefined && b.in !== undefined && b.out !== undefined);
  const events = timeline.events.filter((e) => shots.some((b) => e.flowId === b.flowId && e.t >= b.in! && e.t <= b.out!));
  if (events.some((e) => e.kind === "type" && typeof e.value === "string" && e.value.length >= 4)) return "prompt";
  if (events.some((e) => e.layout?.groups.some((g) => g.kind === "columns")) || Object.values(content ?? {}).some((c) => c.board)) return "board";
  if (events.some((e) => e.layout?.groups.some((g) => g.kind === "rows" && g.items.length >= 5))) return "list";
  if (events.some((e) => e.layout?.panel)) return "panel";
  return "page";
}

/** A string's spread-out hash, for seeding the look. */
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** The library's skeleton for this film: one that suits the product's shape, picked by the seed. */
export function chooseSkeleton(library: ReferenceLibrary, shape: ProductShape, seed: string): FilmSkeleton {
  const fits = library.skeletons.filter((s) => !s.suits.length || s.suits.includes(shape));
  const pool = fits.length ? fits : library.skeletons;
  return pool[hash(seed) % pool.length]!;
}

/** A music-led edit from the storyboard and what was recorded. */
export function ledEdl(o: LedInput): Edl {
  return ledPlan(o).edl;
}

/** A music-led edit, with the skeleton it was built on and the shots it left out. */
export function ledPlan(o: LedInput): LedPlan {
  const { storyboard, timeline } = o;
  const skeleton = o.skeleton ?? DEFAULT_SKELETON;
  const { module, look } = skeleton;
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
  // Where each look cycle starts: the seed's, so two brands on one skeleton don't match.
  const offset = o.seed ? hash(o.seed) : 0;
  const cycle = <T,>(items: T[], i: number) => items[(i + offset) % items.length]!;

  const openerSeconds = skeleton.openerBeats * beat;
  const endSeconds = skeleton.endBeats * beat;
  const labelSeconds = module.labelBeats * beat;
  const proofSeconds = module.proofBeats * beat;
  const moduleSeconds = labelSeconds + proofSeconds * module.proofsPerShot;
  const room = Math.max(1, Math.min(module.maxModules, Math.floor((o.targetSeconds - openerSeconds - endSeconds) / moduleSeconds)));

  const shots = storyboard.beats.filter((b) => b.flowId !== undefined && b.in !== undefined && b.out !== undefined);
  if (!shots.length) throw new Error("The storyboard has no footage to cut.");
  const dropped: LedPlan["dropped"] = [];
  const segments: Segment[] = [];
  const once = new Set<string>();
  const wants = (k: Primitive["type"]) => (o.prefer ?? []).includes(k);
  // The site's own pages as a wall, after the opener, diving into its first page (the one the site opens on).
  const pages = o.assets?.captures ?? [];
  if (wants("wall") && pages.length >= 6)
    segments.push({ kind: "primitive", id: "wall", primitive: { type: "wall", pages: pages.slice(0, 16), focus: 0 }, seconds: r2(Math.max(8, skeleton.module.proofBeats) * beat), transitionIn: "cut" });
  const outputs = wants("output") ? [...(o.assets?.outputs ?? [])] : [];
  const disc = o.assets?.imagery?.find((i) => i.round)?.file;
  /** The language a flow chose, as a chip, when it chose one. */
  const languageOfFlow = (flowId: string) =>
    timeline.events
      .filter((e) => e.flowId === flowId && e.kind === "select")
      .map((e) => chipFor(o.steps?.[`${flowId}/${e.stepId}`] ?? { action: "select", ...(typeof e.value === "string" ? { value: e.value } : {}) }))
      .find((c) => c?.includes(" · "));
  /** An output plays for at most 4.5 s, a beat in: long enough to hear, short enough to keep the film moving. */
  const OUT = 4.5;
  const outputBeats = (seconds: number) => Math.min(12, Math.max(4, Math.ceil((Math.min(seconds, OUT) + beat + 0.3) / beat)));
  let last: Primitive["type"] | undefined;
  let used = 0;
  let labels = 0;
  const count = Math.min(room, shots.length);
  for (const shot of shots.slice(count)) dropped.push({ beatId: shot.id, ...(titleOf(shot) ? { title: Object.values(titleOf(shot)!)[0] } : {}), reason: "no room: the film is at its length" });
  const slug = (id: string, suffix: string) => `${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`.replace(/^[^a-z]+/, "b");
  shots.slice(0, count).forEach((shot, index) => {
    const position = storyboard.beats.indexOf(shot);
    const before = storyboard.beats[position - 1];
    const title = titleOf(shot) ?? (before && before.flowId === undefined && before.role !== "hook" ? titleOf(before) : undefined);
    const label = module.labelBeats ? title : undefined;
    const events = timeline.events.filter((e) => e.flowId === shot.flowId && e.t >= shot.in! && e.t <= shot.out! + 0.5);
    const tilt = cycle(look.tilts, index) === "strong" ? "strong" : "soft";
    const ofShot: Shot = { flowId: shot.flowId!, in: shot.in!, out: shot.out!, events };
    const seconds = proofSeconds + (label ? 0 : labelSeconds);
    // A pill and a mockup are each a one-off: once one has played, later shots use the other moves.
    const prefer = (o.prefer ?? []).filter((k) => !((k === "pill" || k === "mockup") && once.has(k)));
    const call = o.shots?.[shot.id];
    const options = ranked(optionsFor(ofShot, timeline, tilt, beat, o.content?.[shot.id], o.motion?.cursor === "hand", prefer, { ...(o.steps ? { steps: o.steps } : {}), ...(call ? { call } : {}) }), prefer, o.avoid);
    // A one-take skeleton glides over each shot, unless art direction featured a designed move this shot can make.
    const designed = options[0] && prefer.includes(options[0].kind) && ["pill", "mockup", "build", "prompt"].includes(options[0].kind);
    const glide = module.camera === "path" && !designed ? glideFor(ofShot, timeline, tilt, beat, seconds, o.content?.[shot.id]) : undefined;
    if (!options.length && !glide) {
      dropped.push({ beatId: shot.id, ...(title ? { title: Object.values(title)[0] } : {}), reason: "too little on screen to show" });
      return;
    }
    // Two of the same in a row reads as a template.
    const option = glide ? undefined : (options.find((c) => c.kind !== last) ?? options[0]!);
    const middle = look.flipMiddle && index === Math.floor(count / 2) && count >= 3;
    if (label) {
      segments.push({
        kind: "primitive",
        id: slug(shot.id, "label"),
        beatId: shot.id,
        // The film's first label opens out of the opener's line; one may flip the whole frame at the middle.
        primitive: {
          type: "label",
          text: label,
          ground: middle ? "invert" : cycle(look.grounds, labels),
          open: labels === 0 ? "slit" : middle ? "iris" : cycle(look.labelOpen, labels),
        },
        seconds: r2(labelSeconds),
        transitionIn: "cut",
      });
      labels++;
    }
    const made0 = glide ?? option!.make(seconds);
    // The director's headline rides the shot's first proof.
    const first: Primitive = made0.type === "proof" && call?.headline ? { ...made0, headline: call.headline } : made0;
    last = first.type;
    if (first.type === "pill" || first.type === "mockup") once.add(first.type);
    // A pill lasts as long as its typing, the press and a beat of the answer coming: no long spinner.
    const own = first.type === "pill" ? Math.min(seconds, Math.max(4 * beat, Math.ceil((0.6 + [...first.text].length / 16 + (first.press ? 1.9 : 1.2)) / beat) * beat)) : seconds;
    segments.push({ kind: "primitive", id: slug(shot.id, "proof"), beatId: shot.id, primitive: first, seconds: r2(own), transitionIn: "cut" });
    // A second angle on the same shot: another kind of move, or the same kind on another region.
    if (module.proofsPerShot > 1 && option) {
      const frameOf = (p: Primitive) => ("frame" in p ? p.frame : undefined);
      const second = options.find((c) => c !== option && (c.kind !== option.kind || JSON.stringify(frameOf(c.make(proofSeconds))) !== JSON.stringify(frameOf(first))));
      if (second) {
        const made = second.make(proofSeconds);
        segments.push({ kind: "primitive", id: slug(shot.id, "angle"), beatId: shot.id, primitive: "tilt" in made ? { ...made, tilt: cycle(look.tilts, index + 1) } : made, seconds: r2(proofSeconds), transitionIn: "cut" });
        last = made.type;
      }
    }
    // The product's own output, right after the shot that made it: played a beat in, for as long as it lasts.
    const made = outputs.findIndex((x) => x.flowId === shot.flowId && x.t >= shot.in! - 0.5 && x.t <= shot.out! + 3);
    if (made >= 0) {
      const out = outputs.splice(made, 1)[0]!;
      // Over it, the director's headline or the language it speaks; as its disc, one of the brand's own objects.
      const said = first.type === "pill" ? first.chips?.find((c) => c.includes(" · ")) : undefined;
      const title = call?.headline ?? said ?? languageOfFlow(shot.flowId!);
      segments.push({ kind: "primitive", id: slug(shot.id, "output"), beatId: shot.id, primitive: { type: "output", file: out.file, from: 0, seconds: r2(Math.min(out.seconds, OUT)), peaks: out.peaks, ...(title ? { title } : {}), ...(disc ? { disc } : {}) }, seconds: r2(outputBeats(out.seconds) * beat), transitionIn: "cut" });
    }
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
      seconds: r2(proofSeconds + labelSeconds),
      transitionIn: "cut",
    });
  }
  // An output whose shot isn't in the film still plays, before the end.
  for (const out of outputs.slice(0, 1))
    segments.push({ kind: "primitive", id: "output", primitive: { type: "output", file: out.file, from: 0, seconds: r2(Math.min(out.seconds, OUT)), peaks: out.peaks, ...(languageOfFlow(out.flowId) ? { title: languageOfFlow(out.flowId)! } : {}), ...(disc ? { disc } : {}) }, seconds: r2(outputBeats(out.seconds) * beat), transitionIn: "cut" });
  // Other companies' logos around the brand's, before the end card. The caller passes them only with consent.
  const cloud = o.assets?.cloud ?? [];
  if (wants("orbit") && cloud.length >= 4)
    segments.push({ kind: "primitive", id: "orbit", primitive: { type: "orbit", logos: cloud.slice(0, 12) }, seconds: r2(8 * beat), transitionIn: "cut" });
  // The product's real terms, if the film has the room for one more bar.
  const terms = (o.terms ?? []).filter((t) => t.length <= 24).slice(0, 6);
  if (skeleton.ticker && terms.length >= 3 && used < room && used >= 2)
    segments.push({
      kind: "primitive",
      id: "terms",
      primitive: { type: "ticker", terms: terms.map((t) => ({ en: t })) },
      seconds: r2(Math.max(bar, 4 * beat)),
      transitionIn: "cut",
    });

  const motion = { ...MOTION_PRESETS[o.personality], zoom: Math.min(2.5, Math.max(MOTION_PRESETS[o.personality].zoom, 1.65)) };
  const base = brandStyle(o.brand, o.personality);
  const colours = (o.assets?.colours ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4);
  const edl = Edl.parse({
    schemaVersion: o.motion || segments.some((x) => x.kind === "primitive" && ((x.primitive.type === "proof" && x.primitive.path) || ["wall", "pill", "mockup", "output", "orbit"].includes(x.primitive.type))) ? 8 : 7,
    fps: 30,
    style: {
      ...base,
      ...(colours.length >= 2 ? { palette: { ...base.palette, colours } } : {}),
      pacing: "punchy",
      edit: "trailer",
      captionStyle: "minimal",
      music: o.music ?? { mood: "none", bpm: 120, duckDb: -6 },
      sfx: "auto",
      timing: "music",
      frame: "none",
      motion,
      ...(o.motion ? { brand: o.motion } : {}),
      ...(o.assets?.imagery?.length ? { imagery: o.assets.imagery.slice(0, 6) } : {}),
    },
    intro: { component: "Opener", props: { line: byLang((s) => s.titleCard || s.hook, o.brand?.url ?? "") }, seconds: r2(openerSeconds) },
    segments,
    outro: { component: "EndCard", props: { line: byLang((s) => s.cta, "") }, seconds: r2(endSeconds) },
  });
  return { edl, skeleton, dropped };
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
