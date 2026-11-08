import type { PrimitiveSegment, Rect } from "@agentcast/shared";
import type { Size } from "../camera.ts";
import { sceneFile, type Vars } from "../hyperframes/scenes.ts";
import { PATH_MOVE, buildStep, hopTimes, liftAt, pullBackAt, swapTimes } from "./cues.ts";
import { CURSOR_CSS, CURSOR_HTML, cursorScript, pressesIn } from "./cursor.ts";
import { mockup, orbit, output, pill, wall } from "./brand.ts";

export { cardCues, openerSlot, phrasesOf, primitiveCues, primitiveMoments } from "./cues.ts";

// The motion primitives (PRD §9.7.6): designed moves from the launch-film teardown, each drawing from a
// real recording. Everything happens on the music's beat. `vars` are worked out here, in pixels of the
// canvas; the scenes only animate them, so a frame is a function of time alone.

export type SceneContext = {
  id: string;
  size: Size;
  canvas: Size & { u: number };
  common: Vars;
  dur: number;
  beat: number;
  lang: string;
  viewport: { w: number; h: number; dpr: number };
  dark: boolean;
  /** The recording's clicks with their target boxes (source seconds, CSS pixels), for the hand cursor. */
  clicks?: { t: number; box: [number, number, number, number] }[];
  /** Art direction's cursor: "hand" draws one to each recorded click a move shows. */
  cursor?: "hand" | "none";
  /** The brand's logo as placed in the composition, for moves that show it (the orbit). */
  logo?: { src: string; aspect: number };
  /** Whether the brand's accent is a colour: a grey brand's light is a soft ring of its ink instead. */
  colourful?: boolean;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const textIn = (text: Record<string, string> | undefined, lang: string) => (text ? (text[lang] ?? text.en ?? Object.values(text)[0] ?? "") : "");

/** The asset a build's page moment is saved as. */
export const stillFile = (id: string) => `still-${id}.png`;

/** How far footage may be enlarged before it reads soft: 1.25× its own pixels. */
const maxScale = (c: SceneContext) => c.viewport.dpr * 1.25 * (c.canvas.h >= c.canvas.w ? c.canvas.w / 1080 : c.canvas.h / 1080);

/** Dark brands' captures are dim: their page's own colours fade toward the bottom and edges. */
const liftFilter = (c: SceneContext, amount: number) => (c.dark ? `filter: brightness(${amount}) contrast(1.06);` : "");

const scene = (c: SceneContext, vars: Vars, css: string, body: string, script: string) => ({ vars, file: sceneFile(c.id, c.size, vars, css, body, script) });

/**
 * A region widened about its centre until its window can fill the canvas without the footage going soft:
 * on a low-density recording a small region would otherwise make a small window.
 */
function widened(frame: Rect, c: SceneContext): Rect {
  const tall = c.canvas.h > c.canvas.w;
  const want = Math.min(c.viewport.w, (c.canvas.w * (tall ? 0.94 : 0.78)) / maxScale(c));
  if (frame[2] >= want) return frame;
  const h = Math.min(c.viewport.h, Math.max(frame[3], want * 0.62));
  const x = Math.max(0, Math.min(c.viewport.w - want, frame[0] + frame[2] / 2 - want / 2));
  const y = Math.max(0, Math.min(c.viewport.h - h, frame[1] + frame[3] / 2 - h / 2));
  return [x, y, want, h];
}

/** A window for `frame` of the page: as big as the canvas allows, and never softer than `maxScale`. */
function windowFor(frame: Rect, c: SceneContext) {
  const tall = c.canvas.h > c.canvas.w;
  const wide = c.canvas.w * (tall ? 0.94 : 0.78);
  const high = c.canvas.h * (tall ? 0.7 : 0.92);
  const scale = Math.min(wide / frame[2], maxScale(c));
  const w = frame[2] * scale;
  const h = Math.min(frame[3] * scale, high);
  return { scale, w, h, x: (c.canvas.w - w) / 2, y: (c.canvas.h - h) / 2 };
}

const TILTS = {
  none: { from: [10, -4, 0.6, 0.94], mid: [0, 0, 0, 1], to: [0, 0, 0, 1.04] },
  soft: { from: [24, -14, 3, 0.86], mid: [7, -5, 0.6, 1], to: [1, 2, 0, 1.05] },
  strong: { from: [26, -26, 5, 0.82], mid: [13, -15, 2.5, 1], to: [7, -8, 1, 1.08] },
};

function label(c: SceneContext, p: Extract<PrimitiveSegment["primitive"], { type: "label" }>) {
  const vars: Vars = { ...c.common, text: textIn(p.text, c.lang), accent: textIn(p.accent, c.lang), ground: p.ground, open: p.open };
  return scene(
    c,
    vars,
    `#S-ground { position: absolute; inset: 0; }
.invert { background: var(--ac-fg); }
.invert .ac-line { color: var(--ac-bg); }
.invert .ac-accent { color: var(--ac-bg); }
#S-mask { position: absolute; inset: 0; }`,
    `    <div id="S-ground"></div>
    <div id="S-mask"><div id="S-text" class="ac-fill ac-center"></div></div>`,
    `  var g = S.el("ground"), m = S.el("mask");
  if (v.ground === "invert") g.className = "invert";
  if (v.ground === "invert") m.className = "invert";
  if (v.ground === "field") g.className = "ac-ground-field";
  if (v.ground === "field") m.classList.add("ac-on-field");
  if (v.open === "slit") tl.fromTo(m, { clipPath: "inset(50% 0% 50% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.4, ease: "expo.out" }, 0);
  if (v.open === "iris") tl.fromTo(S.el("in"), { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)", duration: 0.34, ease: "expo.out" }, 0);
  AC.words(tl, S.el("text"), v.text, v.accent, v.open === "rise" ? 0 : 0.04, S.dur, "build", 190);`,
  );
}

function swap(c: SceneContext, p: Extract<PrimitiveSegment["primitive"], { type: "swap" }>) {
  const words = p.words.map((w) => textIn(w, c.lang));
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  const lead = textIn(p.lead, c.lang);
  const vars: Vars = { ...c.common, lead, words: JSON.stringify(words), times: JSON.stringify(swapTimes(words.length, c.dur, c.beat).map(r3)), style: p.style, longest };
  return scene(
    c,
    vars,
    `#S-noun { display: inline-block; position: relative; }
#S-noun span { position: absolute; left: 0; top: 0; opacity: 0; }
#S-noun i { font-style: normal; visibility: hidden; }`,
    `    <div id="S-wrap" class="ac-fill ac-center"><div id="S-line" class="ac-line"><span id="S-lead"></span> <span id="S-noun"><i id="S-size"></i></span></div></div>`,
    `  var line = S.el("line"), noun = S.el("noun"), words = AC.json(v.words, []), times = AC.json(v.times, []);
  S.el("lead").textContent = v.lead;
  S.el("size").textContent = v.longest;
  line.style.fontSize = AC.fit((v.lead + " " + v.longest).length, 180, 0.86) + "px";
  AC.grow(tl, S.el("wrap"), 0, S.dur);
  words.forEach(function (w, i) {
    var s = document.createElement("span");
    s.textContent = w;
    noun.appendChild(s);
    var y = (v.style === "rolodex" ? 0.8 : 0.45) * parseFloat(line.style.fontSize);
    tl.fromTo(s, { opacity: 0, y: y, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.26, ease: "expo.out" }, Math.max(0, times[i] - 0.04));
    if (i < words.length - 1) tl.to(s, { opacity: v.style === "rolodex" ? 0.2 : 0, y: -y, filter: "blur(10px)", duration: 0.14, ease: "power2.in" }, times[i + 1] - 0.14);
  });`,
  );
}

function ticker(c: SceneContext, p: Extract<PrimitiveSegment["primitive"], { type: "ticker" }>) {
  const vars: Vars = { ...c.common, terms: JSON.stringify(p.terms.map((t) => textIn(t, c.lang))) };
  return scene(
    c,
    vars,
    `#S-rule { position: absolute; left: 0; right: 0; top: calc(50% + 60 * var(--ac-u)); height: 1px; background: var(--ac-fg); opacity: 0.45; transform-origin: 50% 50%; }
#S-track { position: absolute; left: 0; top: calc(50% - 70 * var(--ac-u)); white-space: nowrap; display: flex; }
.ac-term { flex: none; position: relative; font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; color: var(--ac-fg); font-size: calc(92 * var(--ac-u)); padding-right: calc(120 * var(--ac-u)); }
.ac-term::after { content: ""; position: absolute; left: 0; top: calc(130 * var(--ac-u)); width: 1px; height: calc(34 * var(--ac-u)); background: var(--ac-fg); }`,
    `    <div id="S-rule"></div><div id="S-track"></div>`,
    `  var t = S.el("track"), s = AC.size();
  AC.json(v.terms, []).forEach(function (w) { var d = document.createElement("div"); d.className = "ac-term"; d.textContent = w; t.appendChild(d); });
  tl.fromTo(S.el("rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "expo.out" }, 0);
  tl.fromTo(t, { x: s.w * 0.7 }, { x: -Math.max(0, t.scrollWidth - s.w * 0.35), duration: S.dur, ease: "none" }, 0);`,
  );
}

function proof(c: SceneContext, given: Extract<PrimitiveSegment["primitive"], { type: "proof" }>) {
  const p = { ...given, frame: widened(given.frame, c) };
  const win = windowFor(p.frame, c);
  const speed = Math.max(0.6, Math.min(3, (p.out - p.in) / c.dur));
  const tilt = TILTS[p.tilt];
  const hops = (p.hops ?? []).map(([x, y, w, h]) => [r1(x * win.scale), r1(y * win.scale), r1(w * win.scale), r1(h * win.scale)]);
  const vars: Vars = {
    ...c.common,
    plane: JSON.stringify([r1(-p.frame[0] * win.scale), r1(-p.frame[1] * win.scale), r3(win.scale)]),
    tilt: JSON.stringify(tilt),
    hops: JSON.stringify(hops),
    times: JSON.stringify(hopTimes(hops.length, c.dur, c.beat).map(r3)),
    field: p.ground === "field" ? 1 : 0,
    headline: typeof p.headline === "string" ? p.headline : textIn(p.headline, c.lang),
  };
  // A headline over the window, when there is one: above it if there's room, else on it.
  const headSize = Math.min(c.canvas.h * 0.07, win.w / Math.max(8, [...String(vars.headline)].length * 0.52));
  const above = win.y >= headSize * 1.9;
  // A camera path: each stop's region filling the window, as far as the footage stays sharp, and never past the page's edges.
  vars.path = JSON.stringify(
    (p.path ?? []).map(({ at, frame }) => {
      const s = Math.min(win.w / frame[2], maxScale(c));
      const x = Math.min(0, Math.max(win.w - c.viewport.w * s, -frame[0] * s));
      const y = Math.min(0, Math.max(win.h - c.viewport.h * s, -frame[1] * s));
      return [r3(at), r1(x), r1(y), r3(s)];
    }),
  );
  vars.move = PATH_MOVE;
  // The hand, to each recorded click this proof shows (not on a camera path: the page moves under it).
  const presses = c.cursor === "hand" && !p.path?.length ? pressesIn({ clicks: c.clicks ?? [], from: p.in, to: p.out, speed, dur: c.dur, frame: p.frame, scale: win.scale }) : [];
  const rate = speed !== 1 ? ` data-playback-rate="${r3(speed)}"` : "";
  return scene(
    c,
    vars,
    `#S-ground { position: absolute; inset: 0; }
#S-win { left: ${r1(win.x)}px; top: ${r1(win.y)}px; width: ${r1(win.w)}px; height: ${r1(win.h)}px; opacity: 0; ${liftFilter(c, 1.22)} }
#S-plane { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; transform-origin: 0 0; }
#S-plane video { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; }
#S-hop { position: absolute; left: 0; top: 0; border-radius: calc(12 * var(--ac-u)); background: color-mix(in srgb, var(--ac-fg) 10%, transparent); box-shadow: inset 0 0 0 calc(2 * var(--ac-u)) color-mix(in srgb, var(--ac-fg) 30%, transparent); opacity: 0; }
#S-head { position: absolute; left: ${r1(win.x + (above ? 0 : headSize * 0.6))}px; top: ${r1(above ? win.y - headSize * 1.55 : win.y + win.h - headSize * 2.2)}px; font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.02em; font-size: ${r1(headSize)}px; color: var(--ac-fg); white-space: nowrap; z-index: 3; opacity: 0;${above ? "" : ` background: var(--ac-surface, var(--ac-bg)); border-radius: 999px; padding: ${r1(headSize * 0.2)}px ${r1(headSize * 0.6)}px; box-shadow: 0 calc(16 * var(--ac-u)) calc(40 * var(--ac-u)) var(--ac-shade);`} }
${presses.length ? CURSOR_CSS : ""}`,
    `    <div id="S-ground"></div>
    ${vars.headline ? `<div id="S-head"></div>` : ""}
    <div id="S-win" class="ac-window"><div id="S-plane"><video id="S-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="${r3(c.dur)}" data-media-start="${r3(p.in)}"${rate}></video></div><div id="S-hop"></div>${presses.length ? CURSOR_HTML : ""}</div>`,
    `  if (Number(v.field)) S.el("ground").className = "ac-ground-field";
  var win = S.el("win"), pl = AC.json(v.plane, [0, 0, 1]), tp = AC.json(v.tilt, {}), hop = S.el("hop");
  gsap.set(win, { transformPerspective: 2400 * AC.u() });
  gsap.set(S.el("plane"), { x: pl[0], y: pl[1], scale: pl[2] });
  var pose = function (a) { return { rotationX: a[0], rotationY: a[1], rotationZ: a[2], scale: a[3] }; };
  tl.fromTo(win, Object.assign({ opacity: 0, y: 170 * AC.u() }, pose(tp.from)), Object.assign({ opacity: 1, y: 0, duration: 0.7, ease: "expo.out" }, pose(tp.mid)), 0);
  tl.to(win, Object.assign({ duration: Math.max(0.1, S.dur - 0.7), ease: "none" }, pose(tp.to)), 0.7);
  var times = AC.json(v.times, []);
  AC.json(v.hops, []).forEach(function (h, i) {
    tl.set(hop, { x: h[0] + pl[0], y: h[1] + pl[1], width: h[2], height: h[3], opacity: 1 }, times[i]);
    tl.fromTo(hop, { scale: 0.985 }, { scale: 1, duration: 0.2, ease: "back.out(3)" }, times[i]);
  });
  if (v.headline) {
    S.el("head").textContent = v.headline;
    tl.fromTo(S.el("head"), { opacity: 0, y: 26 * AC.u(), filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, 0.35);
  }
  AC.json(v.path, []).forEach(function (stop) {
    tl.to(S.el("plane"), { x: stop[1], y: stop[2], scale: stop[3], duration: Number(v.move), ease: "expo.inOut" }, stop[0]);
  });
  ${cursorScript(presses, c.dur)}`,
  );
}

/**
 * The page at one moment arriving piece by piece, then one piece lifted to the middle. On a tall canvas a
 * wide board would be too small to read whole: two columns fill the width and the camera pans across the rest.
 */
function build(c: SceneContext, p: Extract<PrimitiveSegment["primitive"], { type: "build" }>) {
  const items = p.items;
  const tall = c.canvas.h > c.canvas.w;
  const sorted = [...items].sort((a, b) => a[0] - b[0]);
  const x0 = Math.min(...items.map((i) => i[0]));
  const y0 = Math.min(...items.map((i) => i[1]));
  const x1 = Math.max(...items.map((i) => i[0] + i[2]));
  const y1 = Math.max(...items.map((i) => i[1] + i[3]));
  const panning = tall && items.length > 2 && items.every((r) => r[3] > r[2]);
  const shown = panning ? sorted[1]![0] + sorted[1]![2] - sorted[0]![0] : x1 - x0;
  const scale = Math.min((c.canvas.w * 0.92) / shown, (c.canvas.h * 0.84) / (y1 - y0), maxScale(c));
  const left = (c.canvas.w - shown * scale) / 2;
  const top = (c.canvas.h - (y1 - y0) * scale) / 2;
  const pan = panning ? ((x1 - x0) - shown) * scale : 0;
  const image = `url(assets/${stillFile(c.id)})`;
  const size = `${r1(c.viewport.w * scale)}px ${r1(c.viewport.h * scale)}px`;
  const place = (r: Rect) => `left: ${r1(left + (r[0] - x0) * scale)}px; top: ${r1(top + (r[1] - y0) * scale)}px; width: ${r1(r[2] * scale)}px; height: ${r1(r[3] * scale)}px; background-image: ${image}; background-size: ${size}; background-position: ${r1(-r[0] * scale)}px ${r1(-r[1] * scale)}px;`;
  // The lifted piece has to be among what's shown.
  const lift = p.lift && items.some((r) => p.lift![0] >= r[0] - 1 && p.lift![0] + p.lift![2] <= r[0] + r[2] + 1) ? p.lift : undefined;
  const when = lift ? liftAt(items.length, c.dur, c.beat) : undefined;
  const liftTo = lift ? Math.min(2.3, (c.canvas.w * 0.55) / (lift[2] * scale)) : 1;
  const middle: [number, number] = lift
    ? [c.canvas.w / 2 - (left + (lift[0] - x0 + lift[2] / 2) * scale), c.canvas.h / 2 - (top + (lift[1] - y0 + lift[3] / 2) * scale)]
    : [0, 0];
  // Where the pan has taken the board when the piece lifts (power1.inOut, as the pan's tween).
  const k = when === undefined ? 0 : when / c.dur;
  const panned = -pan * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
  const vars: Vars = {
    ...c.common,
    step: r3(buildStep(items.length, c.beat, c.dur)),
    count: items.length,
    reveal: p.reveal,
    when: when === undefined ? -1 : r3(when),
    liftTo: r3(liftTo),
    middle: JSON.stringify(middle.map(r1)),
    pan: r1(pan),
    panned: r1(panned),
  };
  // Pieces land left to right: on a pan, in the order the camera reaches them.
  const order = items.map((r) => sorted.indexOf(r));
  return scene(
    c,
    vars,
    `#S-board { position: absolute; inset: 0; transform-origin: 50% 50%; ${liftFilter(c, 1.45)} }
.ac-item { position: absolute; border-radius: calc(10 * var(--ac-u)); opacity: 0; }
.ac-wire { position: absolute; border-radius: calc(10 * var(--ac-u)); border: 1px solid var(--ac-accent); opacity: 0; }
#S-lift { position: absolute; border-radius: calc(12 * var(--ac-u)); box-shadow: 0 0 0 1px var(--ac-rim), 0 calc(50 * var(--ac-u)) calc(120 * var(--ac-u)) var(--ac-shade); opacity: 0; ${liftFilter(c, 1.7)} }`,
    `    <div id="S-board">${items.map((r, i) => `<div id="S-w${i}" class="ac-wire" data-order="${order[i]}" style="${place(r).split("background-image")[0]}"></div><div id="S-i${i}" class="ac-item" data-order="${order[i]}" style="${place(r)}"></div>`).join("")}</div>
    ${lift ? `<div id="S-lift" style="${place(lift)}"></div>` : ""}`,
    `  var n = Number(v.count), step = Number(v.step), wire = v.reveal === "wireframe";
  for (var i = 0; i < n; i++) {
    var item = S.el("i" + i), at = Number(item.getAttribute("data-order")) * step;
    if (wire) {
      tl.fromTo(S.el("w" + i), { opacity: 0, scale: 0.97 }, { opacity: 0.55, scale: 1, duration: 0.25, ease: "power3.out" }, at);
      tl.fromTo(item, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power1.out" }, n * step + 0.1 + at * 0.4);
      tl.to(S.el("w" + i), { opacity: 0, duration: 0.2 }, n * step + 0.3 + at * 0.4);
    } else tl.fromTo(item, { opacity: 0, y: 220 * AC.u(), filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, Math.max(0, at - 0.04));
  }
  tl.fromTo(S.el("board"), { scale: 1, x: 0 }, { scale: 1.05, x: -Number(v.pan), duration: S.dur, ease: Number(v.pan) ? "power1.inOut" : "none" }, 0);
  var when = Number(v.when), m = AC.json(v.middle, [0, 0]);
  if (when >= 0) {
    tl.to(S.el("board"), { opacity: 0.28, filter: "blur(5px)", duration: 0.3, ease: "power2.out" }, when - 0.04);
    tl.fromTo(S.el("lift"), { opacity: 0, scale: 1, x: Number(v.panned), y: 0 }, { opacity: 1, scale: Number(v.liftTo), x: m[0], y: m[1], duration: 0.5, ease: "back.out(1.4)" }, when - 0.04);
    tl.to(S.el("lift"), { scale: Number(v.liftTo) * 1.05, duration: Math.max(0.1, S.dur - when - 0.5), ease: "none" }, when + 0.46);
  }`,
  );
}

function prompt(c: SceneContext, given: Extract<PrimitiveSegment["primitive"], { type: "prompt" }>) {
  const p = { ...given, frame: widened(given.frame, c) };
  const win = windowFor(p.frame, c);
  const speed = Math.max(0.6, Math.min(3, (p.out - p.in) / c.dur));
  // Close enough that the field fills most of the window, as far as the footage stays sharp, and always
  // closer than the pull-back it opens into: a close-up softer than 1.6× the footage's limit isn't worth it.
  const near = Math.max(win.scale * 1.5, Math.min((win.w * 0.86) / p.input[2], maxScale(c) * 1.6, win.scale * 3));
  const atNear: [number, number] = [win.w / 2 - (p.input[0] + p.input[2] / 2) * near, win.h / 2 - (p.input[1] + p.input[3] / 2) * near];
  const vars: Vars = {
    ...c.common,
    near: JSON.stringify([r1(atNear[0]), r1(atNear[1]), r3(near)]),
    far: JSON.stringify([r1(-p.frame[0] * win.scale), r1(-p.frame[1] * win.scale), r3(win.scale)]),
    pull: r3(pullBackAt(c.dur, c.beat)),
  };
  const rate = speed !== 1 ? ` data-playback-rate="${r3(speed)}"` : "";
  return scene(
    c,
    vars,
    `#S-win { left: ${r1(win.x)}px; top: ${r1(win.y)}px; width: ${r1(win.w)}px; height: ${r1(win.h)}px; ${liftFilter(c, 1.2)} }
#S-plane { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; transform-origin: 0 0; }
#S-plane video { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; }`,
    `    <div id="S-win" class="ac-window"><div id="S-plane"><video id="S-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="${r3(c.dur)}" data-media-start="${r3(p.in)}"${rate}></video></div></div>`,
    `  var pl = S.el("plane"), n = AC.json(v.near, [0, 0, 1]), f = AC.json(v.far, [0, 0, 1]), pull = Number(v.pull);
  tl.fromTo(S.el("win"), { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.3, ease: "expo.out" }, 0);
  tl.fromTo(pl, { x: n[0], y: n[1], scale: n[2] }, { x: n[0], y: n[1], scale: n[2] * 1.04, duration: pull, ease: "none" }, 0);
  tl.to(pl, { x: f[0], y: f[1], scale: f[2], duration: 0.34, ease: "expo.out" }, pull);`,
  );
}

/** A primitive segment's scene and its variables. */
export function primitiveScene(segment: PrimitiveSegment, c: SceneContext): { vars: Vars; file: string } {
  const p = segment.primitive;
  switch (p.type) {
    case "label":
      return label(c, p);
    case "swap":
      return swap(c, p);
    case "ticker":
      return ticker(c, p);
    case "proof":
      return proof(c, p);
    case "build":
      return build(c, p);
    case "prompt":
      return prompt(c, p);
    case "wall":
      return wall(c, p);
    case "pill":
      return pill(c, p);
    case "mockup":
      return mockup(c, p);
    case "output":
      return output(c, p);
    case "orbit":
      return orbit(c, p, c.logo ? { logo: c.logo.src, logoAspect: c.logo.aspect } : {});
  }
}

/** The opening: the line a phrase at a time, then a line opening across the frame for what follows. */
export function openerScene(id: string, size: Size, vars: Vars, o: { logo?: { parts?: LogoParts; motion: string; src: string } } = {}) {
  // Opening on the logo: it reveals over the first half, then lifts away and the line takes the rest (from v.from).
  if (o.logo) logoVars(vars, o.logo.parts, o.logo.motion);
  return sceneFile(
    id,
    size,
    vars,
    `#S-rule { position: absolute; left: 0; right: 0; top: calc(50% - 1px); height: calc(2 * var(--ac-u)); background: var(--ac-fg); transform: scaleX(0); }
#S-logobox { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
${o.logo ? LOGO_CSS : ""}`,
    `    ${o.logo ? `<div id="S-logobox">${logoPieces(o.logo.parts, o.logo.motion, o.logo.src)}</div>` : ""}<div id="S-stage" class="ac-fill"></div><div id="S-rule"></div>`,
    `${o.logo ? logoReveal("Math.min(220 * AC.u(), AC.size().w * 0.5 * Number(v.logoHeight) / Math.max(1, Number(v.logoWidth)))", "0.05") : ""}
  ${o.logo ? `AC.grow(tl, S.el("logobox"), 0, Number(v.from));
  tl.to(S.el("logobox"), { opacity: 0, scale: 0.92, filter: "blur(14px)", duration: 0.3, ease: "power2.in" }, Number(v.from) - 0.3);` : ""}
  var phrases = AC.json(v.phrases, []), beat = Number(v.beat), slot = Number(v.slot), from = Number(v.from || 0);
  phrases.forEach(function (p, i) {
    var wrap = document.createElement("div"), line = document.createElement("div");
    wrap.className = "ac-fill ac-center";
    line.className = "ac-line";
    line.style.fontSize = AC.fit(p.length, 340, 0.78) + "px";
    line.textContent = p;
    wrap.appendChild(line);
    S.el("stage").appendChild(wrap);
    var at = from + i * slot, end = i < phrases.length - 1 ? at + slot : S.dur - beat;
    AC.land(tl, line, at);
    AC.grow(tl, wrap, at, end - at);
    AC.leave(tl, line, end);
  });
  tl.fromTo(S.el("rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "expo.out" }, S.dur - beat - 0.04);`,
  );
}

type LogoParts = { kind: "mark+wordmark" | "wordmark" | "mark"; mark?: [number, number]; letters: [number, number][] };

/**
 * The logo as pieces cut from its capture, for revealing it piece by piece: each piece is a window onto the
 * whole logo image, so it works for any logo, vector or not. `S-logo` is sized by the script.
 */
function logoPieces(parts: LogoParts | undefined, motion: string, src: string) {
  if (!parts || motion === "fade" || (motion === "lockup" && !parts.mark) || (motion === "letters" && !parts.letters.length)) return `<img id="S-logo" src="${src}" alt="">`;
  const piece = (id: string, [a, b]: [number, number]) =>
    `<div id="S-${id}" class="piece" style="left: ${(a * 100).toFixed(3)}%; width: ${((b - a) * 100).toFixed(3)}%;"><img src="${src}" alt="" style="left: ${(-(a / (b - a)) * 100).toFixed(3)}%; width: ${((1 / (b - a)) * 100).toFixed(3)}%;"></div>`;
  // The pieces tile the whole logo, each gap split between its neighbours, so no seam shows between them.
  const spans = [...(parts.mark ? [parts.mark] : []), ...parts.letters];
  const tiled = spans.map(([a, b], i) => [i ? (spans[i - 1]![1] + a) / 2 : 0, i < spans.length - 1 ? (b + spans[i + 1]![0]) / 2 : 1] as [number, number]);
  const offset = parts.mark ? 1 : 0;
  const letters = parts.letters.map((_, i) => piece(`l${i}`, tiled[i + offset]!)).join("");
  return `<div id="S-logo" class="pieces">${parts.mark ? piece("mark", tiled[0]!) : ""}<div id="S-row">${letters}</div></div>`;
}

/** The close: the logo landing on the music's hit (whole, as a lockup or letter by letter), the line, and the address drawn out of a thin line. */
/** The logo's CSS, for any scene that reveals it in pieces. */
const LOGO_CSS = `#S-logo { max-width: 56%; opacity: 0; }
#S-logo.pieces { position: relative; max-width: none; opacity: 1; }
#S-logo .piece { position: absolute; top: 0; height: 100%; overflow: hidden; }
#S-logo .piece img { position: absolute; top: 0; height: 100%; max-width: none; }
#S-row { position: absolute; inset: 0; }`;

/** Sets the variables the logo reveal reads. */
function logoVars(vars: Vars, parts: LogoParts | undefined, motion: string) {
  vars.logoMotion = motion;
  // Where the mark's piece ends, so the name slides out from behind it.
  vars.markEnd = parts?.mark ? (parts.letters[0] ? (parts.mark[1] + parts.letters[0][0]) / 2 : parts.mark[1]) : 0;
  vars.letterCount = parts?.letters.length ?? 0;
}

/**
 * The logo's reveal, as scene script: whole (blurring in), as a lockup (the mark lands alone, then moves to its
 * place as the name slides out from behind it) or letter by letter, starting at `at` with the logo `h` px tall.
 */
const logoReveal = (h: string, at: string) => `  var logo = S.el("logo"), u = AC.u(), beat = Number(v.beat), at = ${at};
  if (logo) {
    var h = ${h};
    logo.style.height = h + "px";
    var w = h * Number(v.logoWidth) / Math.max(1, Number(v.logoHeight));
    if (logo.className === "pieces") logo.style.width = w + "px";
    var n = Number(v.letterCount), mark = S.el("mark");
    if (logo.className !== "pieces") {
      tl.fromTo(logo, { opacity: 0, scale: 1.14, filter: "blur(26px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "expo.out" }, at);
    } else if (v.logoMotion === "lockup" && mark) {
      var end = Number(v.markEnd) * w, alone = (w - end) / 2;
      tl.fromTo(mark, { x: alone, opacity: 0, scale: 0.8, filter: "blur(18px)" }, { x: alone, opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, at);
      tl.to(mark, { x: 0, duration: 0.5, ease: "expo.inOut" }, at + beat * 1.5);
      var row = S.el("row");
      row.style.clipPath = "inset(0 0 0 " + (end + 4 * u) + "px)";
      tl.fromTo(row, { x: -(w - end) }, { x: 0, duration: 0.7, ease: "expo.out" }, at + beat * 1.7);
      for (var i = 0; i < n; i++) tl.fromTo(S.el("l" + i), { y: 0.3 * h, opacity: 0, filter: "blur(8px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.45, ease: "expo.out" }, at + beat * 1.75 + i * 0.06);
    } else {
      if (mark) tl.fromTo(mark, { opacity: 0, scale: 0.8, filter: "blur(16px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, at);
      for (var j = 0; j < n; j++) tl.fromTo(S.el("l" + j).firstChild, { y: 1.1 * h, filter: "blur(8px)" }, { y: 0, filter: "blur(0px)", duration: 0.55, ease: "expo.out" }, at + (mark ? beat : 0) + j * 0.08);
    }
  }`;

/** The close: the logo landing on the music's hit (whole, as a lockup or letter by letter), the line, and the address drawn out of a thin line. */
export function endCardScene(id: string, size: Size, vars: Vars, o: { logo: boolean; parts?: LogoParts; motion?: string; src?: string }) {
  const motion = o.motion ?? "fade";
  logoVars(vars, o.parts, motion);
  return sceneFile(
    id,
    size,
    vars,
    `#S-stack { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(38 * var(--ac-u)); }
${LOGO_CSS}
#S-site { position: relative; font-family: var(--ac-text); font-size: calc(34 * var(--ac-u)); color: var(--ac-bg); background: var(--ac-fg); border-radius: 999px; padding: calc(14 * var(--ac-u)) calc(38 * var(--ac-u)); transform: scaleX(0); }
#S-site span { opacity: 0; display: block; }`,
    `    <div id="S-stack">${o.logo ? logoPieces(o.parts, motion, o.src ?? "assets/logo.png") : ""}<div id="S-line"></div><div id="S-site"><span id="S-url"></span></div></div>`,
    `${logoReveal("Math.min(120 * AC.u(), Number(v.logoHeight) * 5.5 * AC.u())", "0")}
  AC.grow(tl, S.el("stack"), 0, S.dur);
  AC.words(tl, S.el("line"), v.line, "", beat, S.dur, "build", 120, 0.8);
  S.el("url").textContent = v.site;
  tl.fromTo(S.el("site"), { scaleX: 0, scaleY: 0.08 }, { scaleX: 1, scaleY: 0.08, duration: 0.2, ease: "power2.out" }, beat * 2.5);
  tl.to(S.el("site"), { scaleY: 1, duration: 0.18, ease: "back.out(1.6)" }, beat * 2.5 + 0.2);
  tl.fromTo(S.el("url"), { opacity: 0 }, { opacity: 1, duration: 0.2 }, beat * 2.5 + 0.3);`,
  );
}
