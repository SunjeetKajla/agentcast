// Checkpoint B's scenes, by hand (docs/BRAND_MOTION_PLAN.md §9). Pixels at 1080p; times are seconds into
// each scene, on a 120 BPM grid (a beat is 0.5 s). Positions are linear.app's CSS pixels (1440×900),
// measured on job_e2eled0001's recording, which is 2880×1800 (P source pixels per CSS pixel).
import { readFileSync } from "node:fs";

const P = 2;
/** A move that lands on a beat starts a little before it. */
const EARLY = 0.04;
const INK = "#f7f8f8";
const GROUND = "#08090a";

/** A film's ground, ink and bloom of light. */
export type Theme = { ground: string; ink: string; bloom: string };
const DARK: Theme = { ground: GROUND, ink: INK, bloom: "radial-gradient(closest-side, rgba(220,226,255,0.2), rgba(190,200,240,0.07) 55%, transparent 100%)" };

type Logo = { viewBox: string; mark: number[]; letters: number[][] };

/** The logo's parts as inline SVG: the mark alone, and each letter as the wordmark seen through its own viewBox. */
export function logoParts(svgFile: string, jsonFile: string) {
  const svg = readFileSync(svgFile, "utf8");
  const meta = JSON.parse(readFileSync(jsonFile, "utf8")) as Logo;
  const paths = [...svg.matchAll(/<path [^>]*><\/path>/g)].map((m) => m[0]);
  const [, , , vh] = meta.viewBox.split(/[\s,]+/).map(Number);
  const mark = `<svg viewBox="0 0 ${meta.mark[0]! + meta.mark[2]!} ${vh}" width="100%" height="100%">${paths[0]}</svg>`;
  const letters = meta.letters.map(([x, , w]) => ({
    x: x!,
    w: w!,
    svg: `<svg viewBox="${x} 0 ${w} ${vh}" width="100%" height="100%" preserveAspectRatio="none">${paths.slice(1).join("")}</svg>`,
  }));
  return { mark, markWidth: meta.mark[0]! + meta.mark[2]!, letters, vh: vh! };
}

/**
 * The cursors, our own drawings: an arrow, and a pointing hand whose fingertip is the hot spot. Each is a
 * dark outline layer under a white fill layer, so overlapping shapes read as one silhouette.
 */
const HAND_SHAPES = [
  `<rect x="13" y="2" width="8" height="25" rx="4"/>`,
  `<rect x="20.5" y="13.5" width="7.5" height="15" rx="3.75"/>`,
  `<rect x="27.5" y="15.5" width="7" height="14" rx="3.5"/>`,
  `<rect x="33.5" y="18.5" width="6" height="12" rx="3"/>`,
  `<rect x="11" y="20" width="28.5" height="21" rx="9"/>`,
  `<rect x="3" y="22" width="13" height="7" rx="3.5" transform="rotate(38 9.5 25.5)"/>`,
].join("");
const HAND = `<svg viewBox="-2 -2 46 48" width="64" height="68"><g fill="#121314" stroke="#121314" stroke-width="3.4" stroke-linejoin="round">${HAND_SHAPES}</g><g fill="#fff">${HAND_SHAPES}</g><path d="M21 20.5v5M27.5 22v4.5M33.8 24v3.6" stroke="#121314" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/></svg>`;
const ARROW = `<svg viewBox="0 0 28 38" width="42" height="57"><path d="M3 3 L3 31 L10 24.4 L15 35 L19.6 33 L14.8 22.6 L24.4 22.6 Z" fill="#fff" stroke="#121314" stroke-width="2.2" stroke-linejoin="round"/></svg>`;

/** The cursor's markup: both shapes, the hand hidden, positioned so (x, y) is the hot spot. */
export const cursor = (id: string) =>
  `<div id="${id}" class="cur"><div class="cur-arrow">${ARROW}</div><div class="cur-hand">${HAND}</div><div class="cur-ring"></div></div>`;

export function scene(id: string, css: string, body: string, script: string, theme: Theme = DARK) {
  return `<template>
<style>
#root { position: absolute; inset: 0; overflow: hidden; background: ${theme.ground}; }
.line { font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.04em; line-height: 1.05; white-space: nowrap; color: ${theme.ink}; }
.center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.plane { position: absolute; left: 0; top: 0; width: 2880px; height: 1800px; transform-origin: 0 0; }
.plane video { position: absolute; left: 0; top: 0; width: 2880px; height: 1800px; }
.bloom { position: absolute; left: -15%; right: -15%; top: 45%; height: 130%; border-radius: 50%; background: ${theme.bloom}; filter: blur(30px); opacity: 0; }
.cur { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; z-index: 50; }
.cur-arrow { position: absolute; left: -4px; top: -4px; filter: drop-shadow(0 6px 10px rgba(0,0,0,0.45)); }
.cur-hand { position: absolute; left: -24px; top: -3px; opacity: 0; transform-origin: 24px 4px; filter: drop-shadow(0 8px 12px rgba(0,0,0,0.45)); }
.cur-ring { position: absolute; left: -36px; top: -36px; width: 72px; height: 72px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.85); opacity: 0; }
${css}
</style>
<div id="root" data-composition-id="${id}" data-width="1920" data-height="1080">
${body}
</div>
<script>
(function () {
  var S = AC.scene(${JSON.stringify(id)}), tl = S.tl;
  var el = function (name) { return document.getElementById(name); };
  // The cursor: glides on a curve (x and y on different eases), turns into the hand over a target, and
  // presses: the hand dips to 0.88, a ring ripples from the fingertip.
  var cur = {
    show: function (c, x, y, at) { tl.set(el(c), { x: x, y: y }, 0); tl.to(el(c), { opacity: 1, duration: 0.2 }, at); },
    glide: function (c, x, y, at, secs) {
      tl.to(el(c), { x: x, duration: secs, ease: "power2.inOut" }, at);
      tl.to(el(c), { y: y, duration: secs, ease: "power3.inOut" }, at);
    },
    hand: function (c, at) {
      tl.to(el(c).querySelector(".cur-arrow"), { opacity: 0, duration: 0.08 }, at);
      tl.to(el(c).querySelector(".cur-hand"), { opacity: 1, duration: 0.08 }, at);
    },
    press: function (c, at) {
      var hand = el(c).querySelector(".cur-hand"), ring = el(c).querySelector(".cur-ring");
      tl.to(hand, { scale: 0.88, duration: 0.08, ease: "power2.out" }, at - 0.08);
      tl.to(hand, { scale: 1, duration: 0.22, ease: "back.out(3)" }, at);
      tl.fromTo(ring, { scale: 0.3, opacity: 0.9 }, { scale: 1.25, opacity: 0, duration: 0.45, ease: "expo.out" }, at);
    },
    hide: function (c, at) { tl.to(el(c), { opacity: 0, duration: 0.2 }, at); },
  };
${script}
  S.done();
})();
</script>
</template>
`;
}

/** The lockup at 1000 px wide: the mark, and the letters in a strip that clips them where the mark ends. */
function lockup(prefix: string, logo: ReturnType<typeof logoParts>, scale: number) {
  const markW = logo.markWidth * scale;
  const clip = markW + 4 * scale;
  const letters = logo.letters
    .map((l, i) => `<div id="${prefix}-l${i}" class="letter" style="left: ${(l.x * scale - clip).toFixed(1)}px; width: ${(l.w * scale).toFixed(1)}px;">${l.svg}</div>`)
    .join("");
  return {
    css: `#${prefix}-lock { position: absolute; width: ${(400 * scale).toFixed(0)}px; height: ${(logo.vh * scale).toFixed(0)}px; }
#${prefix}-mark { position: absolute; left: 0; top: 0; width: ${markW.toFixed(1)}px; height: 100%; }
#${prefix}-strip { position: absolute; left: ${clip.toFixed(1)}px; right: 0; top: 0; bottom: 0; overflow: hidden; }
#${prefix}-strip .row { position: absolute; inset: 0; }
#${prefix}-strip .letter { position: absolute; top: 0; height: 100%; }`,
    body: `<div id="${prefix}-lock"><div id="${prefix}-mark">${logo.mark}</div><div id="${prefix}-strip"><div id="${prefix}-row" class="row">${letters}</div></div></div>`,
    /**
     * The wordmark slides out from behind the mark as one strip, so no letter crosses another; each letter
     * also rises and sharpens a little after the one before it.
     */
    reveal: (at: number) =>
      [
        `tl.fromTo(el("${prefix}-row"), { x: ${(-(400 - logo.markWidth) * scale).toFixed(1)} }, { x: 0, duration: 0.7, ease: "expo.out" }, ${at.toFixed(2)});`,
        ...logo.letters.map(
          (_, i) =>
            `tl.fromTo(el("${prefix}-l${i}"), { y: 14, opacity: 0, filter: "blur(10px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.45, ease: "expo.out" }, ${(at + 0.04 + i * 0.06).toFixed(2)});`,
        ),
      ].join("\n  "),
    markW,
  };
}

export function makeScenes(o: { logo: ReturnType<typeof logoParts>; pages: string[] }) {
  const { logo, pages } = o;
  const SCALE = 2.5;

  /** 0–4 s. The mark sweeps in on a bloom of light, lands on the beat, then slides left as the wordmark comes out from behind it. */
  const open = lockup("o", logo, SCALE);
  const openLeft = (1920 - 400 * SCALE) / 2;
  const intro = scene(
    "intro",
    `${open.css}
#o-lock { left: ${openLeft}px; top: ${(1080 - logo.vh * SCALE) / 2}px; }
#o-mark { clip-path: polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%); }`,
    `<div id="o-bloom" class="bloom"></div>${open.body}`,
    `  tl.fromTo(el("o-bloom"), { opacity: 0, y: 260 }, { opacity: 1, y: 0, duration: 1.6, ease: "power2.out" }, 0);
  tl.fromTo(el("o-bloom"), { scale: 1 }, { scale: 1.12, duration: 4, ease: "none" }, 0);
  // Alone in the middle first: the lockup's mark sits ${((400 * SCALE - open.markW) / 2).toFixed(0)} px right of where it ends.
  gsap.set(el("o-mark"), { x: ${((400 * SCALE - open.markW) / 2).toFixed(1)} });
  tl.fromTo(el("o-mark"), { clipPath: "polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)", rotation: -24, scale: 0.7, filter: "blur(14px)" }, { clipPath: "polygon(0% 0%, 140% 0%, 100% 100%, 0% 100%)", rotation: 0, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "expo.out" }, 0.5 - ${EARLY});
  tl.fromTo(el("o-mark"), { scale: 1 }, { scale: 1.04, duration: 1, ease: "none" }, 1.05);
  tl.to(el("o-mark"), { x: 0, scale: 1, duration: 0.5, ease: "expo.inOut" }, 2 - 0.2);
  ${open.reveal(2.1)}
  tl.fromTo(el("o-lock"), { scale: 1 }, { scale: 1.05, duration: 1.6, ease: "none" }, 2.2);
  tl.to(el("o-lock"), { opacity: 0, scale: 0.94, filter: "blur(16px)", duration: 0.3, ease: "power2.in" }, 3.7);`,
  );

  /**
   * 4–8 s. The site's own pages on a tilted plane, the columns sliding against each other. The middle
   * column settles with linear.app/plan at the centre, and the camera straightens and dives into it until it
   * fills the frame, framed as the next scene's footage is: a match cut.
   */
  const TILE = { w: 600, h: 375, gap: 28 };
  const COLS = 5;
  const ROWS = 5;
  const target = { c: 2, r: 2 };
  const plan = pages.findIndex((p) => p === "pages/07.jpg");
  const others = pages.filter((_, i) => i !== plan);
  let k = 0;
  const tiles: string[] = [];
  for (let c = 0; c < COLS; c++) {
    const col: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      // The tile the camera dives into is the recording's own first frame, so the cut into the footage matches exactly.
      const src = c === target.c && r === target.r ? "pages/plan-rec.jpg" : others[k++ % others.length]!;
      col.push(`<div class="tile" style="top: ${r * (TILE.h + TILE.gap)}px; background-image: url(assets/${src});"></div>`);
    }
    tiles.push(`<div id="w-c${c}" class="col" style="left: ${c * (TILE.w + TILE.gap)}px;">${col.join("")}</div>`);
  }
  const centre = { x: target.c * (TILE.w + TILE.gap) + TILE.w / 2, y: target.r * (TILE.h + TILE.gap) + TILE.h / 2 };
  const wall = scene(
    "wall",
    `#w-stage { position: absolute; inset: 0; perspective: 1900px; }
#w-plane { position: absolute; left: ${960 - centre.x}px; top: ${540 - centre.y}px; width: ${COLS * (TILE.w + TILE.gap)}px; height: ${ROWS * (TILE.h + TILE.gap)}px; transform-origin: ${centre.x}px ${centre.y}px; transform-style: preserve-3d; }
.col { position: absolute; top: 0; width: ${TILE.w}px; }
.tile { position: absolute; left: 0; width: ${TILE.w}px; height: ${TILE.h}px; border-radius: 12px; background-size: cover; background-position: center top; box-shadow: 0 0 0 1px rgba(255,255,255,0.12), 0 30px 70px rgba(0,0,0,0.65); }`,
    `<div id="w-bloom" class="bloom"></div><div id="w-stage"><div id="w-plane">${tiles.join("")}</div></div>`,
    `  var plane = el("w-plane");
  tl.fromTo(el("w-bloom"), { opacity: 0.5 }, { opacity: 0.9, duration: 3, ease: "none" }, 0);
  tl.fromTo(plane, { opacity: 0, y: 320, rotationX: 46, rotationZ: -18, scale: 0.5 }, { opacity: 1, y: 0, rotationX: 40, rotationZ: -15, scale: 0.6, duration: 0.8, ease: "expo.out" }, 0);
  tl.to(plane, { rotationZ: -13, scale: 0.66, duration: 1.8, ease: "none" }, 0.8);
  // The columns slide against each other; the middle one settles before the dive.
  [0, 1, 3, 4].forEach(function (c) {
    var up = c % 2 === 0;
    tl.fromTo(el("w-c" + c), { y: up ? 240 : -240 }, { y: up ? -260 : 260, duration: 4, ease: "none" }, 0);
  });
  tl.fromTo(el("w-c${target.c}"), { y: 420 }, { y: 0, duration: 2.6, ease: "power3.out" }, 0);
  // The dive: straighten and scale until the tile is 1920 wide, as the footage that follows is framed.
  tl.to(plane, { rotationX: 0, rotationZ: 0, scale: ${(1920 / TILE.w).toFixed(4)}, duration: 1.3, ease: "expo.inOut" }, 2.6);`,
  );

  /**
   * 8–12 s. The page as it was recorded, framed as the tile ended. The hand glides in and clicks
   * "Projects" on the beat; as the site's panel opens, it lifts out of the page on its own layer, the page
   * dims behind it, and the hand runs down its rows with the highlight. Click at 1.54 s of the recording.
   */
  const FULL = 1920 / 2880;
  const OFFSET = (1080 - 1800 * FULL) / 2;
  const MEDIA = 0.04;
  const link = { x: (752 + 28) * P * FULL, y: (438 + 12) * P * FULL + OFFSET };
  const panel = { x: 776, y: 24, w: 640, h: 852 };
  const K = 1.15;
  const lifted = { x: (1920 - panel.w * K) / 2, y: (1080 - panel.h * K) / 2 };
  const before = { x: panel.x * P * FULL - lifted.x, y: panel.y * P * FULL + OFFSET - lifted.y, s: (P * FULL) / K };
  const rowY = (i: number) => (75 + 52.5 * i - panel.y) * K;
  const projects = scene(
    "projects",
    `#p-page { position: absolute; left: 0; top: ${OFFSET}px; }
#p-lift { position: absolute; left: ${lifted.x.toFixed(1)}px; top: ${lifted.y.toFixed(1)}px; width: ${(panel.w * K).toFixed(1)}px; height: ${(panel.h * K).toFixed(1)}px; overflow: hidden; border-radius: 18px; transform-origin: 0 0; opacity: 0; box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 60px 140px rgba(0,0,0,0.8); }
#p-lift .plane { transform: translate(${(-panel.x * P * K) / 2}px, ${(-panel.y * P * K) / 2}px) scale(${K / 2}); }
#p-hop { position: absolute; left: ${(17 * K).toFixed(1)}px; width: ${(607 * K).toFixed(1)}px; height: ${(52 * K).toFixed(1)}px; border-radius: 12px; background: rgba(255,255,255,0.09); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.3); opacity: 0; }`,
    `<div id="p-page" class="plane" style="transform: scale(${FULL});"><video id="p-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="4" data-media-start="${MEDIA}"></video></div>
  <div id="p-lift"><div class="plane"><video id="p-lv" class="clip" src="assets/footage.mp4" muted playsinline data-start="2.4" data-duration="1.6" data-media-start="${MEDIA + 2.4}"></video></div><div id="p-hop"></div></div>
  ${cursor("p-cur")}`,
    `  cur.show("p-cur", 1560, 980, 0.25);
  cur.glide("p-cur", ${link.x.toFixed(1)}, ${link.y.toFixed(1)}, 0.3, 1.05);
  cur.hand("p-cur", 1.2);
  cur.press("p-cur", 1.5);
  // The panel leaves the page on its own layer, exactly where it is, then comes forward to the middle.
  tl.set(el("p-lift"), { opacity: 1, x: ${before.x.toFixed(1)}, y: ${before.y.toFixed(1)}, scale: ${before.s.toFixed(4)} }, 2.5 - ${EARLY});
  tl.to(el("p-lift"), { x: 0, y: 0, scale: 1, duration: 0.6, ease: "expo.inOut" }, 2.5 - ${EARLY});
  tl.fromTo(el("p-lift"), { rotationY: 0 }, { rotationY: -9, duration: 0.3, ease: "power2.out", yoyo: true, repeat: 1 }, 2.5 - ${EARLY});
  tl.to(el("p-page"), { filter: "brightness(0.35) blur(8px)", duration: 0.5, ease: "power2.out" }, 2.5);
  // The hand follows to the rows; the highlight lands on each on the eighth notes.
  cur.glide("p-cur", ${(lifted.x + 150).toFixed(1)}, ${(lifted.y + rowY(0) + 34).toFixed(1)}, 2.5, 0.55);
  [0, 1, 2, 3].forEach(function (i) {
    var y = [${[0, 1, 2, 3].map((i) => rowY(i).toFixed(1)).join(", ")}][i], at = 3 + i * 0.25;
    tl.set(el("p-hop"), { y: y, opacity: 1 }, at);
    tl.fromTo(el("p-hop"), { scale: 0.985 }, { scale: 1, duration: 0.18, ease: "back.out(3)" }, at);
    if (i) tl.to(el("p-cur"), { y: ${lifted.y.toFixed(1)} + y + 34, duration: 0.16, ease: "power2.out" }, at - 0.1);
  });
  tl.to(el("p-lift"), { x: -1500, rotationY: 18, filter: "blur(12px)", duration: 0.35, ease: "power3.in" }, 3.65);
  cur.hide("p-cur", 3.6);`,
  );

  /** 12–13 s. The label on white, its letters landing in a wave. */
  const words = "Roadmap every quarter";
  const label = scene(
    "label",
    `#root { background: ${INK}; }
#l-text { font-size: 150px; color: ${GROUND}; }
#l-text span { display: inline-block; white-space: pre; }`,
    `<div class="center"><div id="l-text" class="line">${[...words].map((ch, i) => `<span id="l-c${i}">${ch === " " ? "&nbsp;" : ch}</span>`).join("")}</div></div>`,
    `  for (var i = 0; i < ${words.length}; i++)
    tl.fromTo(el("l-c" + i), { y: 90, opacity: 0, rotation: 8 }, { y: 0, opacity: 1, rotation: 0, duration: 0.42, ease: "back.out(2.6)" }, i * 0.018);
  tl.fromTo(el("l-text"), { scale: 1 }, { scale: 1.05, duration: 1, ease: "none" }, 0);`,
  );

  /**
   * 13–16 s. The roadmap at 8.0 s of the recording, cut into its 15 cards: the quarter headers drop in, the
   * cards rise column by column, the hand clicks "JCB & Suica support" on the beat and it lifts to the middle.
   */
  const B = { x: 100, y: 280, w: 1250, h: 470 };
  const S = 1.45;
  const at = { x: (1920 - B.w * S) / 2, y: (1080 - B.h * S) / 2 };
  const xs = [105, 415, 727, 1038];
  const ys = [340, 443, 547, 651];
  const cards = xs.flatMap((x, c) => ys.slice(0, c === 2 ? 3 : 4).map((y, r) => ({ x, y, c, r })));
  const place = (x: number, y: number, w: number, h: number) =>
    `left: ${(at.x + (x - B.x) * S).toFixed(1)}px; top: ${(at.y + (y - B.y) * S).toFixed(1)}px; width: ${(w * S).toFixed(1)}px; height: ${(h * S).toFixed(1)}px; background-position: ${(-x * S).toFixed(1)}px ${(-y * S).toFixed(1)}px;`;
  const jcb = cards.findIndex((c) => c.c === 1 && c.r === 1);
  const jcbCentre = { x: at.x + (415 + 148.5 - B.x) * S, y: at.y + (443 + 47.5 - B.y) * S };
  const board = scene(
    "cards",
    `.cut { position: absolute; background-image: url(assets/board.png); background-size: ${(1440 * S).toFixed(0)}px ${(900 * S).toFixed(0)}px; border-radius: 10px; }
#c-board { position: absolute; inset: 0; }
#c-lift { box-shadow: 0 0 0 1px rgba(255,255,255,0.16), 0 50px 120px rgba(0,0,0,0.8); opacity: 0; z-index: 5; }`,
    `<div id="c-bloom" class="bloom"></div>
  <div id="c-board"><div id="c-head" class="cut" style="${place(B.x, B.y, B.w, 45)}"></div>
  ${cards.map((c, i) => `<div id="c-${i}" class="cut" style="${place(c.x, c.y, 297, 95)}"></div>`).join("\n  ")}</div>
  <div id="c-lift" class="cut" style="${place(415, 443, 297, 95)}"></div>
  ${cursor("c-cur")}`,
    `  tl.fromTo(el("c-bloom"), { opacity: 0.3 }, { opacity: 0.7, duration: 3, ease: "none" }, 0);
  tl.fromTo(el("c-head"), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "expo.out" }, 0);
  ${JSON.stringify(cards.map((c) => 0.1 + c.c * 0.12 + c.r * 0.06))}.forEach(function (t, i) {
    tl.fromTo(el("c-" + i), { y: 240, opacity: 0, rotationX: 30, scale: 0.95, filter: "blur(10px)" }, { y: 0, opacity: 1, rotationX: 0, scale: 1, filter: "blur(0px)", duration: 0.6, ease: "back.out(1.25)" }, t);
  });
  tl.fromTo(el("c-board"), { scale: 1 }, { scale: 1.035, duration: 2, ease: "none" }, 0);
  cur.show("c-cur", 1500, 1000, 1.05);
  cur.glide("c-cur", ${jcbCentre.x.toFixed(1)}, ${jcbCentre.y.toFixed(1)}, 1.1, 0.8);
  cur.hand("c-cur", 1.75);
  cur.press("c-cur", 2);
  tl.set(el("c-${jcb}"), { opacity: 0 }, 2);
  tl.set(el("c-lift"), { opacity: 1 }, 2);
  tl.to(el("c-board"), { opacity: 0.3, filter: "blur(5px)", duration: 0.35, ease: "power2.out" }, 2);
  tl.to(el("c-lift"), { x: ${(960 - jcbCentre.x).toFixed(1)}, y: ${(540 - jcbCentre.y).toFixed(1)}, scale: 2.1, duration: 0.5, ease: "back.out(1.3)" }, 2);
  tl.to(el("c-lift"), { scale: 2.18, duration: 0.5, ease: "none" }, 2.5);
  cur.hide("c-cur", 2.1);`,
  );

  /**
   * 16–20 s, on the track's strong bar. A laptop we draw turns into view with the recording on its screen
   * (Visual planning opening, from 8.6 s), then the camera goes through the screen into the dark.
   */
  const lid = { x: 320, y: 110, w: 1280, h: 820, bezel: 22 };
  const screenW = lid.w - lid.bezel * 2;
  const mockup = scene(
    "mockup",
    `#m-stage { position: absolute; inset: 0; perspective: 2200px; }
#m-laptop { position: absolute; inset: 0; transform-style: preserve-3d; transform-origin: 960px 520px; }
#m-lid { position: absolute; left: ${lid.x}px; top: ${lid.y}px; width: ${lid.w}px; height: ${lid.h}px; border-radius: 30px; background: #0c0d0e; box-shadow: 0 0 0 2px #2a2c30, inset 0 0 0 1px rgba(255,255,255,0.08), 0 80px 160px rgba(0,0,0,0.7); }
#m-screen { position: absolute; left: ${lid.bezel}px; top: ${lid.bezel}px; width: ${screenW}px; height: ${lid.h - lid.bezel * 2}px; overflow: hidden; border-radius: 10px; background: #000; }
#m-base { position: absolute; left: ${lid.x - 110}px; top: ${lid.y + lid.h}px; width: ${lid.w + 220}px; height: 44px; border-radius: 4px 4px 22px 22px; background: linear-gradient(#3a3c41, #1b1c1f 70%); clip-path: polygon(3% 0, 97% 0, 100% 100%, 0 100%); }
#m-notch { position: absolute; left: 50%; top: 0; width: 220px; height: 10px; margin-left: -110px; border-radius: 0 0 10px 10px; background: #141518; }
#m-dark { position: absolute; inset: 0; background: ${GROUND}; opacity: 0; }`,
    `<div id="m-bloom" class="bloom"></div>
  <div id="m-stage"><div id="m-laptop">
    <div id="m-lid"><div id="m-screen"><div class="plane" style="transform: scale(${(screenW / 2880).toFixed(4)});"><video id="m-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="4" data-media-start="8.6"></video></div></div></div>
    <div id="m-base"><div id="m-notch"></div></div>
  </div></div>
  <div id="m-dark"></div>`,
    `  var lap = el("m-laptop");
  tl.fromTo(el("m-bloom"), { opacity: 0, y: 200 }, { opacity: 1, y: 0, duration: 1.2, ease: "power2.out" }, 0);
  tl.fromTo(lap, { y: 620, rotationX: 38, rotationY: -26, scale: 0.86 }, { y: 0, rotationX: 10, rotationY: -12, scale: 0.92, duration: 0.9, ease: "expo.out" }, 0);
  tl.to(lap, { rotationX: 5, rotationY: 7, scale: 0.95, duration: 1.8, ease: "sine.inOut" }, 0.9);
  // Through the screen: straighten and fill the frame with it, then on past the bezel into the dark.
  tl.to(lap, { rotationX: 0, rotationY: 0, scale: ${(1920 / screenW).toFixed(3)}, y: 20, duration: 0.9, ease: "expo.inOut" }, 2.7);
  tl.to(lap, { scale: ${((1920 / screenW) * 1.6).toFixed(3)}, filter: "blur(14px)", duration: 0.35, ease: "power3.in" }, 3.6);
  tl.to(el("m-dark"), { opacity: 1, duration: 0.3, ease: "power2.in" }, 3.7);`,
  );

  /**
   * 20–24 s, on the track's own ending. The mark as light: huge, soft and dim, it sharpens and shrinks to
   * the mark on the beat, then the wordmark comes out from behind it and the address rises under it.
   */
  const end = lockup("e", logo, SCALE);
  const outro = scene(
    "outro",
    `${end.css}
#e-lock { left: ${openLeft}px; top: ${(1080 - logo.vh * SCALE) / 2 - 40}px; }
#e-glow { position: absolute; left: ${960 - end.markW / 2}px; top: ${540 - 40 - (logo.vh * SCALE) / 2}px; width: ${end.markW}px; height: ${logo.vh * SCALE}px; }
#e-url { position: absolute; left: 0; right: 0; top: 700px; display: flex; justify-content: center; }
#e-pill { font-family: var(--ac-text); font-size: 34px; color: ${GROUND}; background: ${INK}; border-radius: 999px; padding: 12px 34px; opacity: 0; }`,
    `<div id="e-bloom" class="bloom"></div><div id="e-glow">${logo.mark}</div>${end.body}<div id="e-url"><div id="e-pill">linear.app</div></div>`,
    `  tl.fromTo(el("e-bloom"), { opacity: 0 }, { opacity: 0.8, duration: 1.5, ease: "power2.out" }, 0);
  gsap.set(el("e-mark"), { opacity: 0, x: ${((400 * SCALE - end.markW) / 2).toFixed(1)} });
  tl.fromTo(el("e-glow"), { scale: 5, opacity: 0.4, filter: "blur(60px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: 1, ease: "expo.inOut" }, 0);
  tl.set(el("e-glow"), { opacity: 0 }, 1);
  tl.set(el("e-mark"), { opacity: 1 }, 1);
  tl.to(el("e-mark"), { x: 0, duration: 0.5, ease: "expo.inOut" }, 1.3);
  ${end.reveal(1.45)}
  tl.fromTo(el("e-pill"), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "expo.out" }, 2 - ${EARLY});
  tl.fromTo(el("e-lock"), { scale: 1 }, { scale: 1.04, duration: 2.5, ease: "none" }, 1.5);`,
  );

  return { intro, wall, projects, label, cards: board, mockup, outro };
}
