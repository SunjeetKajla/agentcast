import type { PrimitiveSegment, Rect } from "@agentcast/shared";
import { sceneFile, type Vars } from "../hyperframes/scenes.ts";
import { CURSOR_CSS, CURSOR_HTML, cursorScript } from "./cursor.ts";
import type { SceneContext } from "./index.ts";

// Brand moves (docs/BRAND_MOTION_PLAN.md §5, PRD §9.7.8), from the checkpoints made general: the site's pages as
// a wall, the recorded typing as a glow pill, footage on a laptop, the product's own output, and other
// companies' logos orbiting the brand. Sizes come from the canvas, so each works in 16:9 and 9:16, at any height.

type P<T extends string> = Extract<PrimitiveSegment["primitive"], { type: T }>;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Where a job's file is placed in the composition: its own folder by kind, under its own name. */
export const assetOf = (kind: "pages" | "cloud" | "output" | "imagery", rel: string) => `assets/${kind}/${rel.split("/").pop()}`;

/** Timings shared by each move's scene and its sounds. */
export const WALL = { enter: 0.8, dive: 1.3 };
export const MOCKUP = { enter: 0.9, through: 1.3 };
/** The pill: when typing starts and ends, and when the hand presses send (seconds into the part). */
export function pillTimes(p: P<"pill">, dur: number, beat: number) {
  const parts = [...p.text].length;
  const start = 0.6;
  // Typed through by the time the hand comes for send (or near the end): never pressed half-written.
  const window = Math.max(0.6, (p.press ? dur - 1.35 : dur - 0.75) - start);
  const rate = Math.min(40, Math.max(12, parts / window));
  const typed = start + parts / rate;
  const press = p.press ? Math.min(dur - 0.9, Math.ceil((typed + 0.25) / beat) * beat) : undefined;
  return { start, rate, typed, press, fold: dur - 0.45 };
}
/** The output: the press that starts it, on the first beat. */
export const outputStart = (beat: number) => beat;

const scene = (c: SceneContext, vars: Vars, css: string, body: string, script: string) => ({ vars, file: sceneFile(c.id, c.size, vars, css, body, script) });

/** The site's own pages on a tilted plane, columns sliding against each other; the camera dives into one until it fills the frame. */
export function wall(c: SceneContext, p: P<"wall">) {
  const tall = c.canvas.h > c.canvas.w;
  const tw = c.canvas.w * (tall ? 0.62 : 0.3125);
  const th = tw * 0.625;
  const gap = tw * 0.047;
  const cols = 5;
  const rows = 5;
  const focus = p.pages[Math.min(p.focus, p.pages.length - 1)]!;
  const others = p.pages.filter((x) => x !== focus);
  let k = 0;
  const columns: string[] = [];
  for (let col = 0; col < cols; col++) {
    const tiles: string[] = [];
    for (let row = 0; row < rows; row++) {
      const src = col === 2 && row === 2 ? focus : others[k++ % others.length]!;
      tiles.push(`<div class="tile" style="top: ${r1(row * (th + gap))}px; background-image: url(${assetOf("pages", src)});"></div>`);
    }
    columns.push(`<div id="S-c${col}" class="col" style="left: ${r1(col * (tw + gap))}px;">${tiles.join("")}</div>`);
  }
  const centre = { x: 2 * (tw + gap) + tw / 2, y: 2 * (th + gap) + th / 2 };
  const vars: Vars = { ...c.common, fill: r3(c.canvas.w / tw) };
  return scene(
    c,
    vars,
    `#S-stage { position: absolute; inset: 0; perspective: ${r1(c.canvas.w)}px; }
#S-plane { position: absolute; left: ${r1(c.canvas.w / 2 - centre.x)}px; top: ${r1(c.canvas.h / 2 - centre.y)}px; width: ${r1(cols * (tw + gap))}px; height: ${r1(rows * (th + gap))}px; transform-origin: ${r1(centre.x)}px ${r1(centre.y)}px; transform-style: preserve-3d; }
.col { position: absolute; top: 0; width: ${r1(tw)}px; }
.tile { position: absolute; left: 0; width: ${r1(tw)}px; height: ${r1(th)}px; border-radius: calc(12 * var(--ac-u)); background-size: cover; background-position: center top; box-shadow: 0 0 0 1px color-mix(in srgb, var(--ac-fg) 14%, transparent), 0 calc(30 * var(--ac-u)) calc(70 * var(--ac-u)) var(--ac-shade); }`,
    `    <div id="S-stage"><div id="S-plane">${columns.join("")}</div></div>`,
    `  var plane = S.el("plane"), u = AC.u(), dive = S.dur - ${WALL.dive};
  tl.fromTo(plane, { opacity: 0, y: 320 * u, rotationX: 46, rotationZ: -18, scale: 0.5 }, { opacity: 1, y: 0, rotationX: 40, rotationZ: -15, scale: 0.6, duration: ${WALL.enter}, ease: "expo.out" }, 0);
  tl.to(plane, { rotationZ: -13, scale: 0.66, duration: Math.max(0.1, dive - ${WALL.enter}), ease: "none" }, ${WALL.enter});
  [0, 1, 3, 4].forEach(function (i) {
    var up = i % 2 === 0;
    tl.fromTo(S.el("c" + i), { y: (up ? 240 : -240) * u }, { y: (up ? -260 : 260) * u, duration: S.dur, ease: "none" }, 0);
  });
  tl.fromTo(S.el("c2"), { y: 420 * u }, { y: 0, duration: dive, ease: "power3.out" }, 0);
  // The dive: straighten and scale until the middle page fills the frame's width.
  tl.to(plane, { rotationX: 0, rotationZ: 0, scale: Number(v.fill), duration: ${WALL.dive}, ease: "expo.inOut" }, dive);`,
  );
}

/**
 * The recorded typing rebuilt: a line opens into a pill inside a ring of the brand's light, the real value types
 * in, and when the recording pressed something after typing, the hand presses send on the beat. Then it folds away.
 */
export function pill(c: SceneContext, p: P<"pill">) {
  const tall = c.canvas.h > c.canvas.w;
  const w = c.canvas.w * (tall ? 0.9 : 0.77);
  const h = Math.min(c.canvas.h * 0.14, w * 0.12);
  const x = (c.canvas.w - w) / 2;
  const y = (c.canvas.h - h) / 2;
  const b = h * 0.68;
  const t = pillTimes(p, c.dur, c.beat);
  const parts = [...p.text].length;
  // The recording's own button: its words on a pill-shaped button, sized to them (an arrow without them).
  const labelSize = h * 0.24;
  const bw = p.button ? Math.min(w * 0.42, Math.max(b, [...p.button].length * labelSize * 0.56 + h * 0.5)) : b;
  // Latin glyphs average about 0.56 em; Indic and other scripts run wider.
  const wide = /[^\u0000-\u024f\u2000-\u206f]/.test(p.text);
  const size = Math.min(h * 0.34, (w - bw - h * 0.9) / Math.max(8, parts * (wide ? 0.6 : 0.56)));
  const send = { x: x + w - h * 0.16 - bw / 2, y: y + h / 2 };
  const chipSize = h * 0.22;
  const vars: Vars = { ...c.common, text: p.text, start: r3(t.start), rate: r3(t.rate), press: t.press === undefined ? -1 : r3(t.press), fold: r3(t.fold), button: p.button ?? "", chips: JSON.stringify(p.chips ?? []) };
  return scene(
    c,
    vars,
    `#S-glow { position: absolute; left: ${r1(x - h * 0.18)}px; top: ${r1(y - h * 0.18)}px; width: ${r1(w + h * 0.36)}px; height: ${r1(h * 1.36)}px; border-radius: 999px; background: ${c.colourful ? "linear-gradient(90deg, var(--ac-c1), var(--ac-c2), var(--ac-c3), var(--ac-c4), var(--ac-c1), var(--ac-c2), var(--ac-c3), var(--ac-c4))" : "linear-gradient(90deg, color-mix(in srgb, var(--ac-fg) 22%, transparent), color-mix(in srgb, var(--ac-fg) 8%, transparent), color-mix(in srgb, var(--ac-fg) 22%, transparent), color-mix(in srgb, var(--ac-fg) 8%, transparent))"}; background-size: 200% 100%; filter: blur(${r1(h * 0.19)}px); opacity: 0; }
#S-pill { position: absolute; left: ${r1(x)}px; top: ${r1(y)}px; width: ${r1(w)}px; height: ${r1(h)}px; border-radius: 999px; background: var(--ac-surface, #fff); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ac-fg) 10%, transparent), 0 calc(30 * var(--ac-u)) calc(80 * var(--ac-u)) var(--ac-shade); overflow: hidden; }
#S-text { position: absolute; left: ${r1(h * 0.42)}px; right: ${r1(bw + h * 0.3)}px; top: 0; bottom: 0; display: flex; align-items: center; font-family: var(--ac-text); font-size: ${r1(size)}px; color: var(--ac-fg); white-space: nowrap; overflow: hidden; }
#S-text span { opacity: 0; white-space: pre; }
#S-caret { display: inline-block; width: ${r1(Math.max(2, size * 0.08))}px; height: ${r1(size * 1.15)}px; margin-left: ${r1(size * 0.12)}px; background: var(--ac-accent); border-radius: 2px; }
#S-send { position: absolute; right: ${r1(h * 0.16)}px; top: ${r1((h - b) / 2)}px; width: ${r1(bw)}px; height: ${r1(b)}px; border-radius: 999px; background: var(--ac-fg); display: flex; align-items: center; justify-content: center; }
#S-send svg { width: ${r1(b * 0.42)}px; height: ${r1(b * 0.42)}px; }
#S-label { font-family: var(--ac-text); font-weight: 600; font-size: ${r1(labelSize)}px; color: var(--ac-bg); white-space: nowrap; }
#S-spin { position: absolute; left: 50%; top: 50%; width: ${r1(b * 0.56)}px; height: ${r1(b * 0.56)}px; margin: ${r1(-b * 0.28)}px 0 0 ${r1(-b * 0.28)}px; border-radius: 50%; border: ${r1(b * 0.07)}px solid color-mix(in srgb, var(--ac-bg) 30%, transparent); border-top-color: var(--ac-bg); opacity: 0; }
#S-chips { position: absolute; left: ${r1(x + h * 0.2)}px; top: ${r1(y - chipSize * 2.9)}px; display: flex; gap: ${r1(chipSize * 0.5)}px; }
.chip { font-family: var(--ac-text); font-weight: 500; font-size: ${r1(chipSize)}px; color: var(--ac-fg); background: var(--ac-surface, #fff); border-radius: 999px; padding: ${r1(chipSize * 0.45)}px ${r1(chipSize * 0.95)}px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--ac-fg) 12%, transparent), 0 calc(12 * var(--ac-u)) calc(30 * var(--ac-u)) var(--ac-shade); white-space: nowrap; opacity: 0; }
.chip i { display: inline-block; width: ${r1(chipSize * 0.5)}px; height: ${r1(chipSize * 0.5)}px; border-radius: 50%; margin-right: ${r1(chipSize * 0.45)}px; vertical-align: 0.05em; }
${t.press !== undefined ? CURSOR_CSS : ""}`,
    `    <div id="S-glow"></div>
    <div id="S-chips">${(p.chips ?? []).map((_, i) => `<div id="S-chip${i}" class="chip"><i style="background: var(--ac-c${(i % 4) + 1})"></i><span id="S-ct${i}"></span></div>`).join("")}</div>
    <div id="S-pill"><div id="S-text"><span id="S-caret"></span></div><div id="S-send">${p.button ? `<span id="S-label"></span>` : `<svg viewBox="0 0 24 24"><path d="M5 12h13M12 5l7 7-7 7" fill="none" stroke="var(--ac-bg)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`}<div id="S-spin"></div></div></div>
    ${t.press !== undefined ? CURSOR_HTML : ""}`,
    `  var text = v.text, holder = S.el("text"), caret = S.el("caret");
  var parts = typeof Intl !== "undefined" && Intl.Segmenter ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), function (s) { return s.segment; }) : Array.from(text);
  parts.forEach(function (g, i) {
    var s = document.createElement("span");
    s.textContent = g;
    holder.insertBefore(s, caret);
    tl.set(s, { opacity: 1 }, Number(v.start) + i / Number(v.rate));
  });
  // The whole line laid out (unseen) first: shrink it until it fits beside the button (wide scripts run long).
  var fs = parseFloat(getComputedStyle(holder).fontSize), room = holder.clientWidth;
  var used = function () { var w = 0; for (var c = holder.firstChild; c; c = c.nextSibling) w += c.getBoundingClientRect ? c.getBoundingClientRect().width : 0; return w; };
  for (var n = 0; n < 12 && used() > room && fs > 10; n++) { fs *= 0.9; holder.style.fontSize = fs + "px"; }
  tl.fromTo(S.el("pill"), { scaleX: 0.002, scaleY: 0.05 }, { scaleX: 1, duration: 0.3, ease: "expo.out" }, 0);
  tl.to(S.el("pill"), { scaleY: 1, duration: 0.3, ease: "back.out(1.6)" }, 0.22);
  tl.fromTo(S.el("glow"), { opacity: 0, scale: 0.8 }, { opacity: 0.85, scale: 1, duration: 0.8, ease: "expo.out" }, 0.2);
  tl.fromTo(S.el("glow"), { backgroundPosition: "0% 50%" }, { backgroundPosition: "100% 50%", duration: Math.max(0.1, S.dur - 0.2), ease: "none" }, 0.2);
  tl.fromTo(S.el("send"), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(2)" }, 0.45);
  if (v.button) S.el("label").textContent = v.button;
  // The choices made before typing, as chips rising in above the pill.
  AC.json(v.chips, []).forEach(function (text, i) {
    S.el("ct" + i).textContent = text;
    tl.fromTo(S.el("chip" + i), { opacity: 0, y: 24 * AC.u() }, { opacity: 1, y: 0, duration: 0.45, ease: "expo.out" }, 0.3 + i * 0.12);
    tl.to(S.el("chip" + i), { opacity: 0, duration: 0.2 }, Number(v.fold));
  });
  var press = Number(v.press);
  if (press >= 0) {
    tl.to(caret, { opacity: 0, duration: 0.01 }, press - 0.1);
    tl.to(S.el("send"), { scale: 0.9, duration: 0.08 }, press - 0.08);
    tl.to(S.el("send"), { scale: 1, duration: 0.2, ease: "back.out(3)" }, press);
    tl.to(S.el("send").firstElementChild, { opacity: 0, duration: 0.08 }, press);
    tl.to(S.el("spin"), { opacity: 1, duration: 0.08 }, press + 0.04);
    tl.fromTo(S.el("spin"), { rotation: 0 }, { rotation: 360, duration: 0.6, ease: "none" }, press + 0.04);
    tl.to(S.el("glow"), { opacity: 1, scale: 1.06, duration: 0.3, ease: "power2.out" }, press);
  }
  tl.to(S.el("pill"), { scaleY: 0.05, duration: 0.18, ease: "power3.in" }, Number(v.fold));
  tl.to(S.el("pill"), { scaleX: 0.002, duration: 0.2, ease: "power3.in" }, Number(v.fold) + 0.17);
  tl.to(S.el("glow"), { opacity: 0, duration: 0.3 }, Number(v.fold));
  ${t.press !== undefined ? cursorScript([{ x: send.x, y: send.y + h * 0.05, at: t.press }], c.dur) : ""}`,
  );
}

/** Footage on a laptop we draw: it turns into view, then the camera goes through its screen into the frame. */
export function mockup(c: SceneContext, p: P<"mockup">) {
  const tall = c.canvas.h > c.canvas.w;
  const lw = c.canvas.w * (tall ? 0.92 : 0.667);
  const lh = lw * 0.64;
  const bezel = lw * 0.017;
  const sw = lw - bezel * 2;
  const sh = lh - bezel * 2;
  const lx = (c.canvas.w - lw) / 2;
  const ly = (c.canvas.h - lh) / 2 - lh * 0.04;
  const frame: Rect = p.frame;
  const scale = Math.max(sw / frame[2], sh / frame[3]);
  const speed = Math.max(0.6, Math.min(3, (p.out - p.in) / c.dur));
  const rate = speed !== 1 ? ` data-playback-rate="${r3(speed)}"` : "";
  const vars: Vars = { ...c.common, fill: r3(c.canvas.w / sw), centre: r1(ly + lh / 2) };
  return scene(
    c,
    vars,
    `#S-stage { position: absolute; inset: 0; perspective: ${r1(c.canvas.w * 1.15)}px; }
#S-laptop { position: absolute; inset: 0; transform-style: preserve-3d; transform-origin: ${r1(c.canvas.w / 2)}px ${r1(ly + lh / 2)}px; }
#S-lid { position: absolute; left: ${r1(lx)}px; top: ${r1(ly)}px; width: ${r1(lw)}px; height: ${r1(lh)}px; border-radius: ${r1(lw * 0.023)}px; background: #0c0d0e; box-shadow: 0 0 0 ${r1(Math.max(1, lw * 0.0016))}px #2a2c30, 0 calc(80 * var(--ac-u)) calc(160 * var(--ac-u)) var(--ac-shade); }
#S-screen { position: absolute; left: ${r1(bezel)}px; top: ${r1(bezel)}px; width: ${r1(sw)}px; height: ${r1(sh)}px; overflow: hidden; border-radius: ${r1(lw * 0.008)}px; background: #000; }
#S-plane { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; transform-origin: 0 0; transform: translate(${r1(-frame[0] * scale)}px, ${r1(-frame[1] * scale)}px) scale(${r3(scale)}); }
#S-plane video { position: absolute; left: 0; top: 0; width: ${c.viewport.w}px; height: ${c.viewport.h}px; }
#S-base { position: absolute; left: ${r1(lx - lw * 0.086)}px; top: ${r1(ly + lh)}px; width: ${r1(lw * 1.172)}px; height: ${r1(lw * 0.034)}px; border-radius: 4px 4px ${r1(lw * 0.017)}px ${r1(lw * 0.017)}px; background: linear-gradient(#3a3c41, #1b1c1f 70%); clip-path: polygon(3% 0, 97% 0, 100% 100%, 0 100%); }
#S-dark { position: absolute; inset: 0; background: var(--ac-bg); opacity: 0; }`,
    `    <div id="S-stage"><div id="S-laptop"><div id="S-lid"><div id="S-screen"><div id="S-plane"><video id="S-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="${r3(c.dur)}" data-media-start="${r3(p.in)}"${rate}></video></div></div></div><div id="S-base"></div></div></div>
    <div id="S-dark"></div>`,
    `  var lap = S.el("laptop"), u = AC.u(), through = S.dur - ${MOCKUP.through};
  tl.fromTo(lap, { y: 620 * u, rotationX: 38, rotationY: -26, scale: 0.86 }, { y: 0, rotationX: 10, rotationY: -12, scale: 0.92, duration: ${MOCKUP.enter}, ease: "expo.out" }, 0);
  tl.to(lap, { rotationX: 5, rotationY: 7, scale: 0.95, duration: Math.max(0.1, through - ${MOCKUP.enter}), ease: "sine.inOut" }, ${MOCKUP.enter});
  // Through the screen: straighten, fill the frame with it, then on past the bezel.
  tl.to(lap, { rotationX: 0, rotationY: 0, scale: Number(v.fill), y: AC.size().h / 2 - Number(v.centre), duration: 0.9, ease: "expo.inOut" }, through);
  tl.to(lap, { scale: Number(v.fill) * 1.5, filter: "blur(12px)", duration: 0.35, ease: "power3.in" }, through + 0.9);
  tl.to(S.el("dark"), { opacity: 1, duration: 0.3, ease: "power2.in" }, S.dur - 0.3);`,
  );
}

/**
 * The product's own output, played: a disc in the brand's colour is pressed on the first beat and its audio
 * plays while a waveform of the real samples lights up in step. The audio itself is placed by the compiler.
 */
export function output(c: SceneContext, p: P<"output">) {
  const tall = c.canvas.h > c.canvas.w;
  const d = Math.min(c.canvas.w, c.canvas.h) * (tall ? 0.42 : 0.4);
  const disc = tall ? { x: c.canvas.w / 2, y: c.canvas.h * 0.36 } : { x: c.canvas.w * 0.27, y: c.canvas.h / 2 };
  const bars = p.peaks.length;
  const waveW = tall ? c.canvas.w * 0.84 : c.canvas.w * 0.5;
  const pitch = waveW / bars;
  const waveH = tall ? c.canvas.h * 0.16 : c.canvas.h * 0.3;
  const wave = tall ? { x: (c.canvas.w - waveW) / 2, y: c.canvas.h * 0.66 } : { x: c.canvas.w * 0.43, y: c.canvas.h / 2 };
  const start = outputStart(c.beat);
  const plays = Math.max(0.3, Math.min(p.seconds, c.dur - start - 0.15));
  const vars: Vars = { ...c.common, start: r3(start), plays: r3(plays), bars, title: p.title ?? "" };
  const titleSize = Math.min(c.canvas.h * 0.075, (tall ? c.canvas.w * 0.84 : waveW) / Math.max(6, [...(p.title ?? "")].length * 0.55));
  // The brand's own object as the disc (its orb), or one drawn in its colour.
  const look = p.disc
    ? `background: url(${assetOf("imagery", p.disc)}) center / contain no-repeat; filter: drop-shadow(0 calc(40 * var(--ac-u)) calc(60 * var(--ac-u)) var(--ac-shade));`
    : `background: ${c.colourful ? "radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--ac-c1) 55%, #fff), var(--ac-c1) 55%, color-mix(in srgb, var(--ac-c1) 70%, #000))" : "var(--ac-fg)"}; box-shadow: 0 calc(40 * var(--ac-u)) calc(90 * var(--ac-u)) var(--ac-shade);`;
  return scene(
    c,
    vars,
    `#S-disc { position: absolute; left: ${r1(disc.x - d / 2)}px; top: ${r1(disc.y - d / 2)}px; width: ${r1(d)}px; height: ${r1(d)}px; border-radius: 50%; ${look} }
#S-title { position: absolute; left: ${r1(tall ? (c.canvas.w - c.canvas.w * 0.84) / 2 : wave.x)}px; top: ${r1(tall ? wave.y - waveH / 2 - titleSize * 1.9 : wave.y - waveH / 2 - titleSize * 1.7)}px; font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.02em; font-size: ${r1(titleSize)}px; color: var(--ac-fg); white-space: nowrap; opacity: 0; }
#S-play { position: absolute; left: 50%; top: 50%; width: 28%; height: 28%; margin: -14%; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
#S-play svg { width: 42%; height: 42%; margin-left: 8%; }
.bar.lit1 { background: ${c.colourful ? "var(--ac-c1)" : "var(--ac-fg)"}; }
.bar.lit2 { background: ${c.colourful ? "var(--ac-c2)" : "var(--ac-fg)"}; }
.bar.lit3 { background: ${c.colourful ? "var(--ac-c3)" : "var(--ac-fg)"}; }
.bar.lit4 { background: ${c.colourful ? "var(--ac-c4)" : "var(--ac-fg)"}; }
.bar-d.lit { background: ${c.colourful ? "var(--ac-c1)" : "var(--ac-fg)"}; opacity: 0.3; }
#S-wave { position: absolute; left: ${r1(wave.x)}px; top: ${r1(wave.y - waveH / 2)}px; width: ${r1(waveW)}px; height: ${r1(waveH)}px; }
.bar { position: absolute; bottom: 50%; width: ${r1(pitch * 0.62)}px; border-radius: ${r1(pitch * 0.31)}px; background: color-mix(in srgb, var(--ac-fg) 18%, transparent); transform-origin: 50% 100%; }
.bar-d { position: absolute; top: 50%; width: ${r1(pitch * 0.62)}px; border-radius: ${r1(pitch * 0.31)}px; background: color-mix(in srgb, var(--ac-fg) 10%, transparent); transform-origin: 50% 0; }
${CURSOR_CSS}`,
    `    <div id="S-title"></div>
    <div id="S-disc"><div id="S-play"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="${c.colourful ? "var(--ac-c1)" : "var(--ac-fg)"}"/></svg></div></div>
    <div id="S-wave">${p.peaks
      .map((v, i) => {
        const h = Math.max(waveH * 0.03, v * (waveH / 2 - 4));
        return `<div id="S-b${i}" class="bar" style="left: ${r1(i * pitch)}px; height: ${r1(h)}px;"></div><div id="S-d${i}" class="bar-d" style="left: ${r1(i * pitch)}px; height: ${r1(h * 0.55)}px;"></div>`;
      })
      .join("")}</div>
    ${CURSOR_HTML}`,
    `  var start = Number(v.start), plays = Number(v.plays), n = Number(v.bars);
  tl.fromTo(S.el("disc"), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)" }, 0);
  if (v.title) {
    S.el("title").textContent = v.title;
    tl.fromTo(S.el("title"), { opacity: 0, y: 30 * AC.u(), filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, 0.2);
  }
  for (var i = 0; i < n; i++) {
    tl.fromTo([S.el("b" + i), S.el("d" + i)], { scaleY: 0 }, { scaleY: 1, duration: 0.35, ease: "back.out(2)" }, 0.15 + i * 0.006);
    var at = start + (i / n) * plays;
    // Lit as the voice reaches it (a class: a colour from a CSS variable can't be tweened).
    // Bands of the brand's colours along the wave, a quarter each.
    tl.set(S.el("b" + i), { className: "bar lit" + (1 + Math.floor((i / n) * 4)) }, at);
    tl.set(S.el("d" + i), { className: "bar-d lit" }, at);
    tl.fromTo(S.el("b" + i), { scaleY: 1 }, { scaleY: 1.15, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.out" }, at);
  }
  tl.to(S.el("play"), { scale: 0.88, duration: 0.08 }, start - 0.08);
  tl.to(S.el("play"), { scale: 1, duration: 0.22, ease: "back.out(3)" }, start);
  tl.fromTo(S.el("disc"), { scale: 1 }, { scale: 1.03, duration: 0.25, yoyo: true, repeat: Math.max(1, Math.floor(plays / 0.5) * 2 - 1), ease: "sine.inOut" }, start);
  ${cursorScript([{ x: disc.x, y: disc.y + d * 0.02, at: start }], c.dur)}`,
  );
}

/**
 * Other companies' logos from the site (only with consent), each on a tile, orbiting the brand's logo; past the
 * middle they fly into a row beneath it.
 */
export function orbit(c: SceneContext, p: P<"orbit">, o: { logo?: string; logoAspect?: number }) {
  const tall = c.canvas.h > c.canvas.w;
  const tile = Math.min(c.canvas.w, c.canvas.h) * 0.1;
  const radius = Math.min(c.canvas.w, c.canvas.h) * (tall ? 0.36 : 0.34);
  const n = p.logos.length;
  const lh = Math.min(c.canvas.h * 0.11, (c.canvas.w * 0.4) / (o.logoAspect ?? 3));
  const rowGap = tile * 0.3;
  const rowW = n * tile + (n - 1) * rowGap;
  const rowScale = Math.min(1, (c.canvas.w * 0.9) / rowW);
  const vars: Vars = { ...c.common, n, radius: r1(radius), tile: r1(tile), rowGap: r1(rowGap), rowScale: r3(rowScale), rowY: r1(c.canvas.h / 2 + lh * 0.9 + tile * 0.6) };
  return scene(
    c,
    vars,
    `#S-centre { position: absolute; left: 50%; top: 50%; height: ${r1(lh)}px; transform: translate(-50%, -50%); opacity: 0; }
#S-ring { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.logo-tile { position: absolute; left: 0; top: 0; width: ${r1(tile)}px; height: ${r1(tile)}px; margin: ${r1(-tile / 2)}px; border-radius: ${r1(tile * 0.24)}px; background: var(--ac-surface, var(--ac-bg)); box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 calc(14 * var(--ac-u)) calc(30 * var(--ac-u)) var(--ac-shade); display: flex; align-items: center; justify-content: center; }
.logo-tile img { max-width: 70%; max-height: 70%; }`,
    `    ${o.logo ? `<img id="S-centre" src="${o.logo}" alt="">` : ""}
    <div id="S-ring">${p.logos.map((l, i) => `<div id="S-t${i}" class="logo-tile"><img src="${assetOf("cloud", l)}" alt=""></div>`).join("")}</div>`,
    `  var n = Number(v.n), r = Number(v.radius), tile = Number(v.tile), gap = Number(v.rowGap), k = Number(v.rowScale);
  var size = AC.size(), lineUp = S.dur * 0.62, rowY = Number(v.rowY) - size.h / 2;
  if (S.el("centre")) tl.fromTo(S.el("centre"), { opacity: 0, scale: 0.85, filter: "blur(14px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, 0.1);
  for (var i = 0; i < n; i++) {
    var el = S.el("t" + i), a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    // Around the circle a quarter turn by the line-up, a point at a time so the motion stays an orbit.
    var steps = 8;
    tl.fromTo(el, { x: Math.cos(a0) * r * 1.6, y: Math.sin(a0) * r * 1.6, scale: 0.4, opacity: 0 }, { x: Math.cos(a0) * r, y: Math.sin(a0) * r, scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)" }, 0.15 + i * 0.07);
    for (var s = 1; s <= steps; s++) {
      var a = a0 + (s / steps) * (Math.PI / 2);
      tl.to(el, { x: Math.cos(a) * r, y: Math.sin(a) * r, duration: (lineUp - 0.75) / steps, ease: "none" }, 0.75 + ((s - 1) / steps) * (lineUp - 0.75));
    }
    var rx = (-(n * tile + (n - 1) * gap) / 2 + tile / 2 + i * (tile + gap)) * k;
    tl.to(el, { x: rx, y: rowY, scale: k, duration: 0.55, ease: "expo.inOut" }, lineUp + i * 0.03);
  }`,
  );
}
