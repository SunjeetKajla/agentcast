import type { PrimitiveSegment, Rect } from "@agentcast/shared";
import type { Size } from "../camera.ts";
import { sceneFile, type Vars } from "../hyperframes/scenes.ts";
import { buildStep, hopTimes, liftAt, pullBackAt, swapTimes } from "./cues.ts";

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
.ac-term { position: relative; font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; color: var(--ac-fg); font-size: calc(92 * var(--ac-u)); padding-right: calc(120 * var(--ac-u)); }
.ac-term::after { content: ""; position: absolute; left: 0; top: calc(130 * var(--ac-u)); width: 1px; height: calc(34 * var(--ac-u)); background: var(--ac-fg); }`,
    `    <div id="S-rule"></div><div id="S-track"></div>`,
    `  var t = S.el("track"), s = AC.size();
  AC.json(v.terms, []).forEach(function (w) { var d = document.createElement("div"); d.className = "ac-term"; d.textContent = w; t.appendChild(d); });
  tl.fromTo(S.el("rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "expo.out" }, 0);
  tl.fromTo(t, { x: s.w * 0.7 }, { x: -Math.max(0, t.scrollWidth - s.w * 0.35), duration: S.dur, ease: "none" }, 0);`,
  );
}

function proof(c: SceneContext, p: Extract<PrimitiveSegment["primitive"], { type: "proof" }>) {
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
  };
  const rate = speed !== 1 ? ` data-playback-rate="${r3(speed)}"` : "";
  return scene(
    c,
    vars,
    `#S-ground { position: absolute; inset: 0; }
#S-win { left: ${r1(win.x)}px; top: ${r1(win.y)}px; width: ${r1(win.w)}px; height: ${r1(win.h)}px; opacity: 0; ${liftFilter(c, 1.22)} }
#S-plane { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; transform-origin: 0 0; }
#S-plane video { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; }
#S-hop { position: absolute; left: 0; top: 0; border-radius: calc(12 * var(--ac-u)); background: color-mix(in srgb, var(--ac-fg) 10%, transparent); box-shadow: inset 0 0 0 calc(2 * var(--ac-u)) color-mix(in srgb, var(--ac-fg) 30%, transparent); opacity: 0; }`,
    `    <div id="S-ground"></div>
    <div id="S-win" class="ac-window"><div id="S-plane"><video id="S-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="${r3(c.dur)}" data-media-start="${r3(p.in)}"${rate}></video></div><div id="S-hop"></div></div>`,
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
  });`,
  );
}

/** On a tall canvas a wide board is too small to read: its middle columns, bigger. */
function fitted(items: Rect[], tall: boolean) {
  const sideBySide = items.every((r) => r[3] > r[2]) && items.length > 2;
  if (!tall || !sideBySide) return items;
  const sorted = [...items].sort((a, b) => a[0] - b[0]);
  const from = Math.floor((sorted.length - 2) / 2);
  return sorted.slice(from, from + 2);
}

function build(c: SceneContext, p: Extract<PrimitiveSegment["primitive"], { type: "build" }>) {
  const items = fitted(p.items, c.canvas.h > c.canvas.w);
  const xs = items.map((i) => i[0]);
  const ys = items.map((i) => i[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...items.map((i) => i[0] + i[2]));
  const y1 = Math.max(...items.map((i) => i[1] + i[3]));
  const scale = Math.min((c.canvas.w * 0.92) / (x1 - x0), (c.canvas.h * 0.84) / (y1 - y0), maxScale(c));
  const left = (c.canvas.w - (x1 - x0) * scale) / 2;
  const top = (c.canvas.h - (y1 - y0) * scale) / 2;
  const image = `url(assets/${stillFile(c.id)})`;
  const size = `${r1(c.viewport.w * scale)}px ${r1(c.viewport.h * scale)}px`;
  const place = (r: Rect) => `left: ${r1(left + (r[0] - x0) * scale)}px; top: ${r1(top + (r[1] - y0) * scale)}px; width: ${r1(r[2] * scale)}px; height: ${r1(r[3] * scale)}px; background-image: ${image}; background-size: ${size}; background-position: ${r1(-r[0] * scale)}px ${r1(-r[1] * scale)}px;`;
  // The lifted piece has to be among what's shown.
  const lift = p.lift && items.some((r) => p.lift![0] >= r[0] - 1 && p.lift![0] + p.lift![2] <= r[0] + r[2] + 1) ? p.lift : undefined;
  const when = lift ? liftAt(p.items.length, c.dur, c.beat) : undefined;
  const liftTo = lift ? Math.min(2.3, (c.canvas.w * 0.55) / (lift[2] * scale)) : 1;
  const middle: [number, number] = lift
    ? [c.canvas.w / 2 - (left + (lift[0] - x0 + lift[2] / 2) * scale), c.canvas.h / 2 - (top + (lift[1] - y0 + lift[3] / 2) * scale)]
    : [0, 0];
  const vars: Vars = {
    ...c.common,
    step: r3(buildStep(p.items.length, c.beat)),
    count: items.length,
    reveal: p.reveal,
    when: when === undefined ? -1 : r3(when),
    liftTo: r3(liftTo),
    middle: JSON.stringify(middle.map(r1)),
  };
  return scene(
    c,
    vars,
    `#S-board { position: absolute; inset: 0; transform-origin: 50% 50%; ${liftFilter(c, 1.45)} }
.ac-item { position: absolute; border-radius: calc(10 * var(--ac-u)); opacity: 0; }
.ac-wire { position: absolute; border-radius: calc(10 * var(--ac-u)); border: 1px solid var(--ac-accent); opacity: 0; }
#S-lift { position: absolute; border-radius: calc(12 * var(--ac-u)); box-shadow: 0 0 0 1px var(--ac-rim), 0 calc(50 * var(--ac-u)) calc(120 * var(--ac-u)) var(--ac-shade); opacity: 0; ${liftFilter(c, 1.7)} }`,
    `    <div id="S-board">${items.map((r, i) => `<div id="S-w${i}" class="ac-wire" style="${place(r).split("background-image")[0]}"></div><div id="S-i${i}" class="ac-item" style="${place(r)}"></div>`).join("")}</div>
    ${lift ? `<div id="S-lift" style="${place(lift)}"></div>` : ""}`,
    `  var n = Number(v.count), step = Number(v.step), wire = v.reveal === "wireframe";
  for (var i = 0; i < n; i++) {
    var item = S.el("i" + i), at = i * step;
    if (wire) {
      tl.fromTo(S.el("w" + i), { opacity: 0, scale: 0.97 }, { opacity: 0.55, scale: 1, duration: 0.25, ease: "power3.out" }, at);
      tl.fromTo(item, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power1.out" }, n * step + 0.1 + at * 0.4);
      tl.to(S.el("w" + i), { opacity: 0, duration: 0.2 }, n * step + 0.3 + at * 0.4);
    } else tl.fromTo(item, { opacity: 0, y: 220 * AC.u(), filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, Math.max(0, at - 0.04));
  }
  tl.fromTo(S.el("board"), { scale: 1 }, { scale: 1.05, duration: S.dur, ease: "none" }, 0);
  var when = Number(v.when), m = AC.json(v.middle, [0, 0]);
  if (when >= 0) {
    tl.to(S.el("board"), { opacity: 0.28, filter: "blur(5px)", duration: 0.3, ease: "power2.out" }, when - 0.04);
    tl.fromTo(S.el("lift"), { opacity: 0, scale: 1, x: 0, y: 0 }, { opacity: 1, scale: Number(v.liftTo), x: m[0], y: m[1], duration: 0.5, ease: "back.out(1.4)" }, when - 0.04);
    tl.to(S.el("lift"), { scale: Number(v.liftTo) * 1.05, duration: Math.max(0.1, S.dur - when - 0.5), ease: "none" }, when + 0.46);
  }`,
  );
}

function prompt(c: SceneContext, p: Extract<PrimitiveSegment["primitive"], { type: "prompt" }>) {
  const win = windowFor(p.frame, c);
  const speed = Math.max(0.6, Math.min(3, (p.out - p.in) / c.dur));
  // Close enough that the field fills most of the window, as far as the footage stays sharp.
  const near = Math.min((win.w * 0.86) / p.input[2], maxScale(c) * 1.3, win.scale * 3);
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
  }
}

/** The opening: the line a phrase at a time, then a line opening across the frame for what follows. */
export function openerScene(id: string, size: Size, vars: Vars) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-rule { position: absolute; left: 0; right: 0; top: calc(50% - 1px); height: calc(2 * var(--ac-u)); background: var(--ac-fg); transform: scaleX(0); }`,
    `    <div id="S-stage" class="ac-fill"></div><div id="S-rule"></div>`,
    `  var phrases = AC.json(v.phrases, []), beat = Number(v.beat), slot = Number(v.slot);
  phrases.forEach(function (p, i) {
    var wrap = document.createElement("div"), line = document.createElement("div");
    wrap.className = "ac-fill ac-center";
    line.className = "ac-line";
    line.style.fontSize = AC.fit(p.length, 340, 0.78) + "px";
    line.textContent = p;
    wrap.appendChild(line);
    S.el("stage").appendChild(wrap);
    var at = i * slot, end = i < phrases.length - 1 ? at + slot : S.dur - beat;
    AC.land(tl, line, at);
    AC.grow(tl, wrap, at, end - at);
    AC.leave(tl, line, end);
  });
  tl.fromTo(S.el("rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "expo.out" }, S.dur - beat - 0.04);`,
  );
}

/** The close: the logo landing on the music's hit, the line, and the address drawn out of a thin line. */
export function endCardScene(id: string, size: Size, vars: Vars, o: { logo: boolean }) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-stack { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(38 * var(--ac-u)); }
#S-logo { max-width: 56%; opacity: 0; }
#S-site { position: relative; font-family: var(--ac-text); font-size: calc(34 * var(--ac-u)); color: var(--ac-bg); background: var(--ac-fg); border-radius: 999px; padding: calc(14 * var(--ac-u)) calc(38 * var(--ac-u)); transform: scaleX(0); }
#S-site span { opacity: 0; display: block; }`,
    `    <div id="S-stack">${o.logo ? `<img id="S-logo" src="assets/logo.png" alt="">` : ""}<div id="S-line"></div><div id="S-site"><span id="S-url"></span></div></div>`,
    `  var u = AC.u(), logo = S.el("logo"), beat = Number(v.beat);
  AC.grow(tl, S.el("stack"), 0, S.dur);
  if (logo) {
    var h = Math.min(120 * u, Number(v.logoHeight) * 5.5 * u);
    logo.style.height = h + "px";
    tl.fromTo(logo, { opacity: 0, scale: 1.14, filter: "blur(26px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "expo.out" }, 0);
  }
  AC.words(tl, S.el("line"), v.line, "", beat, S.dur, "build", 120, 0.8);
  S.el("url").textContent = v.site;
  tl.fromTo(S.el("site"), { scaleX: 0, scaleY: 0.08 }, { scaleX: 1, scaleY: 0.08, duration: 0.2, ease: "power2.out" }, beat * 2.5);
  tl.to(S.el("site"), { scaleY: 1, duration: 0.18, ease: "back.out(1.6)" }, beat * 2.5 + 0.2);
  tl.fromTo(S.el("url"), { opacity: 0 }, { opacity: 1, duration: 0.2 }, beat * 2.5 + 0.3);`,
  );
}
