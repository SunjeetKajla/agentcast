// The checkpoint film's scenes, by hand. Everything is in pixels at 1080p. Times are seconds into the
// scene, and every scene is two bars (4 s) at 120 BPM, so a beat is 0.5 s. Footage and stills are the
// real recording at 2880×1800; `P` below converts its CSS pixels (1440×900) to the source's.

const P = 2;
/** A move that lands on a beat starts a little before it. */
const EARLY = 0.04;

function scene(id: string, css: string, body: string, script: string) {
  return `<template>
<style>
#root { position: absolute; inset: 0; overflow: hidden; }
.line { font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.04em; line-height: 1.05; white-space: nowrap; color: #f7f8f8; }
.center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.win { position: absolute; overflow: hidden; border-radius: 22px; background: #0d0e10; box-shadow: 0 0 0 1px rgba(255,255,255,0.13), 0 70px 160px rgba(0,0,0,0.75), 0 0 180px rgba(255,255,255,0.05); filter: brightness(1.22) contrast(1.06); }
.plane { position: absolute; left: 0; top: 0; width: 2880px; height: 1800px; transform-origin: 0 0; }
.plane video { position: absolute; left: 0; top: 0; width: 2880px; height: 1800px; }
${css}
</style>
<div id="root" data-composition-id="${id}" data-width="1920" data-height="1080">
${body}
</div>
<script>
(function () {
  var S = AC.scene(${JSON.stringify(id)}), tl = S.tl;
  var el = function (name) { return document.getElementById(name); };
  var word = function (name, at, out) {
    tl.fromTo(el(name), { opacity: 0, scale: 1.18, filter: "blur(22px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.34, ease: "expo.out" }, at - ${EARLY});
    if (out) tl.to(el(name), { opacity: 0, scale: 0.94, filter: "blur(12px)", duration: 0.16, ease: "power2.in" }, out - 0.16);
  };
  // Type keeps growing while it's up, so a landed word never stands still.
  var grow = function (name, at, secs) {
    tl.fromTo(el(name), { scale: 1 }, { scale: 1.06, duration: secs, ease: "none" }, at);
  };
${script}
  S.done();
})();
</script>
</template>
`;
}

/** Linear's own headline, one phrase a beat of the bar, then a line opening across the frame. */
const intro = scene(
  "intro",
  `.big { opacity: 0; }
#w1 { font-size: 340px; }
#w2 { font-size: 230px; }
#w3 { font-size: 270px; }
#w4 { font-size: 270px; }
#intro-rule { position: absolute; left: 0; right: 0; top: 539px; height: 2px; background: #f7f8f8; transform: scaleX(0); }`,
  `<div id="g1" class="center"><div id="w1" class="line big">Plan</div></div>
  <div id="g2" class="center"><div id="w2" class="line big">and navigate</div></div>
  <div id="g3" class="center"><div id="w3" class="line big">from idea</div></div>
  <div id="g4" class="center"><div id="w4" class="line big">to launch.</div></div>
  <div id="intro-rule"></div>`,
  `  word("w1", 0, 1);
  word("w2", 1, 2);
  word("w3", 2, 3);
  word("w4", 3, 3.5);
  [0, 1, 2, 3].forEach(function (i) { grow("g" + (i + 1), i, 1); });
  tl.fromTo(el("intro-rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "expo.out" }, 3.5 - ${EARLY});`,
);

/**
 * The label opens out of that line, then the project panel lifts out of the page and, as it scrolls
 * to its properties, a highlight hops down the rows on the beat.
 */
const PANEL = { x: 776 * P, y: 25 * P };
const rows = [206, 258, 311].map((y) => (y - 26) * P);
const m1 = scene(
  "m1",
  `#m1-label { font-size: 190px; }
#m1-mask { clip-path: inset(50% 0 50% 0); }
#m1-win { left: 210px; top: 40px; width: 1500px; height: 1000px; opacity: 0; }
#m1-hop { position: absolute; left: ${792 * P}px; width: ${610 * P}px; height: ${52 * P}px; border-radius: 16px; background: rgba(255,255,255,0.1); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.28); opacity: 0; }`,
  `<div id="m1-mask" class="center"><div id="m1-label" class="line">Manage projects</div></div>
  <div id="m1-win" class="win"><div id="m1-plane" class="plane">
    <video id="m1-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="1" data-duration="3" data-media-start="1.9"></video>
    <div id="m1-hop"></div>
  </div></div>`,
  `  tl.fromTo(el("m1-mask"), { clipPath: "inset(50% 0% 50% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.4, ease: "expo.out" }, 0);
  tl.fromTo(el("m1-label"), { scale: 1 }, { scale: 1.05, duration: 1, ease: "none" }, 0);
  tl.set(el("m1-mask"), { opacity: 0 }, 1);
  gsap.set(el("m1-win"), { transformPerspective: 2400 });
  gsap.set(el("m1-plane"), { x: ${-PANEL.x * 1.17}, y: ${-PANEL.y * 1.17}, scale: 1.17 });
  tl.fromTo(el("m1-win"), { opacity: 0, y: 170, rotationX: 24, rotationY: -14, rotationZ: 3, scale: 0.86 }, { opacity: 1, y: 0, rotationX: 7, rotationY: -5, rotationZ: 0.6, scale: 1, duration: 0.7, ease: "expo.out" }, 1 - ${EARLY});
  tl.to(el("m1-win"), { rotationX: 1, rotationY: 2, rotationZ: 0, scale: 1.05, duration: 2.3, ease: "none" }, 1.7);
  ${JSON.stringify(rows)}.forEach(function (y, i) {
    // From beat 3 of the bar: the panel has finished scrolling by then.
    tl.set(el("m1-hop"), { y: y, opacity: 1 }, 2.5 + i * 0.5);
    tl.fromTo(el("m1-hop"), { scale: 0.985 }, { scale: 1, duration: 0.2, ease: "back.out(3)" }, 2.5 + i * 0.5);
  });`,
);

/**
 * The label on white for contrast at the middle of the film, then the roadmap builds a column at a
 * time on the eighth notes, and one card lifts out of it.
 */
const BOARD = { x: 100 * P, y: 283 * P, w: 1238 * P, h: 560 * P };
const SCALE = 0.71;
const columns = [
  [100, 306],
  [406, 312],
  [718, 312],
  [1030, 308],
].map(([x, w]) => ({ x: (x! - 100) * P, w: w! * P }));
const card = { x: (412 - 100) * P, y: (334 - 283) * P, w: 304 * P, h: 102 * P };
const left = (1920 - BOARD.w * SCALE) / 2;
const top = (1080 - BOARD.h * SCALE) / 2;
/** How far the lifted card travels to the middle of the frame. */
const toMiddle = {
  x: 960 - (left + (card.x + card.w / 2) * SCALE),
  y: 540 - (top + (card.y + card.h / 2) * SCALE),
};
const m2 = scene(
  "m2",
  `#m2-white { position: absolute; inset: 0; background: #f7f8f8; }
#m2-white .line { color: #08090a; font-size: 180px; }
#m2-white .line span { display: inline-block; opacity: 0; }
#m2-board { position: absolute; left: ${left}px; top: ${top}px; width: ${BOARD.w}px; height: ${BOARD.h}px; transform: scale(${SCALE}); transform-origin: 0 0; filter: brightness(1.45) contrast(1.08); -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent), linear-gradient(180deg, #000 80%, transparent); -webkit-mask-composite: source-in; mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent), linear-gradient(180deg, #000 80%, transparent); mask-composite: intersect; }
.col { position: absolute; top: 0; height: ${BOARD.h}px; background-image: url(assets/board.png); background-size: 2880px 1800px; opacity: 0; }
#m2-card { position: absolute; left: ${left + card.x * SCALE}px; top: ${top + card.y * SCALE}px; width: ${card.w * SCALE}px; height: ${card.h * SCALE}px; border-radius: 12px; background-image: url(assets/board.png); background-size: ${2880 * SCALE}px ${1800 * SCALE}px; background-position: ${-(BOARD.x + card.x) * SCALE}px ${-(BOARD.y + card.y) * SCALE}px; box-shadow: 0 0 0 1px rgba(255,255,255,0.3), 0 50px 120px rgba(0,0,0,0.85), 0 0 90px rgba(255,255,255,0.1); filter: brightness(1.7) contrast(1.05); opacity: 0; }`,
  `<div id="m2-board">${columns
    .map(
      (c, i) =>
        `<div id="m2-c${i}" class="col" style="left: ${c.x}px; width: ${c.w}px; background-position: ${-(BOARD.x + c.x)}px ${-BOARD.y}px;"></div>`,
    )
    .join("")}</div>
  <div id="m2-card"></div>
  <div id="m2-white" class="center"><div id="m2-copy" class="line"><span id="m2-w1">Plan</span> <span id="m2-w2">every</span> <span id="m2-w3">quarter</span></div></div>`,
  `  word("m2-w1", 0);
  word("m2-w2", 0.25);
  word("m2-w3", 0.5);
  grow("m2-copy", 0, 1);
  tl.set(el("m2-white"), { opacity: 0 }, 1);
  [0, 1, 2, 3].forEach(function (i) {
    tl.fromTo(el("m2-c" + i), { opacity: 0, y: 220, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, 1 + i * 0.25 - ${EARLY});
  });
  tl.fromTo(el("m2-board"), { scale: ${SCALE} }, { scale: ${SCALE * 1.05}, duration: 3, ease: "none" }, 1);
  tl.to(el("m2-board"), { opacity: 0.28, filter: "brightness(1.1) contrast(1.08) blur(5px)", duration: 0.3, ease: "power2.out" }, 2.5 - ${EARLY});
  tl.fromTo(el("m2-card"), { opacity: 0, scale: 1, x: 0, y: 0 }, { opacity: 1, scale: 2.3, x: ${toMiddle.x}, y: ${toMiddle.y}, duration: 0.5, ease: "back.out(1.4)" }, 2.5 - ${EARLY});
  tl.to(el("m2-card"), { scale: 2.42, duration: 1, ease: "none" }, 3);`,
);

/** A word swap on the beat, then the panel, tilted, scrolling through those same views. */
const m3 = scene(
  "m3",
  `#m3-copy { font-size: 170px; }
#m3-noun { display: inline-block; position: relative; }
#m3-noun span { position: absolute; left: 0; top: 0; opacity: 0; }
#m3-noun i { font-style: normal; visibility: hidden; }
#m3-win { left: 300px; top: 60px; width: 1500px; height: 1300px; opacity: 0; filter: brightness(1.32) contrast(1.06); }`,
  `<div id="m3-text" class="center"><div id="m3-copy" class="line">See it as a <span id="m3-noun"><i>timeline</i><span id="m3-n1">list</span><span id="m3-n2">board</span><span id="m3-n3">timeline</span></span></div></div>
  <div id="m3-win" class="win"><div id="m3-plane" class="plane">
    <video id="m3-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="1.5" data-duration="2.5" data-media-start="9.2"></video>
  </div></div>`,
  `  [["m3-n1", 0, 0.5], ["m3-n2", 0.5, 1], ["m3-n3", 1, 0]].forEach(function (n) {
    tl.fromTo(el(n[0]), { opacity: 0, y: 70, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.26, ease: "expo.out" }, n[1] - ${EARLY});
    if (n[2]) tl.to(el(n[0]), { opacity: 0, y: -60, filter: "blur(10px)", duration: 0.14, ease: "power2.in" }, n[2] - 0.14);
  });
  grow("m3-copy", 0, 1.5);
  tl.set(el("m3-text"), { opacity: 0 }, 1.5);
  gsap.set(el("m3-win"), { transformPerspective: 2200 });
  gsap.set(el("m3-plane"), { x: ${-PANEL.x * 1.17}, y: ${-PANEL.y * 1.17}, scale: 1.17 });
  tl.fromTo(el("m3-win"), { opacity: 0, y: 200, rotationX: 26, rotationY: -26, rotationZ: 5, scale: 0.82, x: -60 }, { opacity: 1, y: 0, rotationX: 13, rotationY: -15, rotationZ: 2.5, scale: 1, x: -120, duration: 0.7, ease: "expo.out" }, 1.5 - ${EARLY});
  tl.to(el("m3-win"), { rotationX: 7, rotationY: -8, rotationZ: 1, y: -70, scale: 1.08, duration: 1.8, ease: "none" }, 2.2);`,
);

/** The hit lands on the bar: the logo, the line, the address. The only hold in the film. */
const outro = scene(
  "outro",
  `#o-logo { position: absolute; left: 600px; top: 330px; width: 720px; height: 240px; background: url(assets/logo.png) center / contain no-repeat; opacity: 0; }
#o-line { font-size: 104px; position: absolute; left: 0; right: 0; top: 590px; text-align: center; }
#o-line span { display: inline-block; opacity: 0; }
#o-url { position: absolute; left: 0; right: 0; top: 735px; text-align: center; font-family: var(--ac-text); font-size: 36px; letter-spacing: 0.01em; color: rgba(247,248,248,0.62); opacity: 0; }`,
  `<div id="o-stack" style="position:absolute;inset:0"><div id="o-logo"></div>
  <div id="o-line" class="line"><span id="o1">Build</span> <span id="o2">with</span> <span id="o3">momentum</span></div>
  <div id="o-url">linear.app</div></div>`,
  `  tl.fromTo(el("o-logo"), { opacity: 0, scale: 1.14, filter: "blur(26px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "expo.out" }, 0);
  word("o1", 0.5);
  word("o2", 0.75);
  word("o3", 1);
  tl.fromTo(el("o-stack"), { scale: 1 }, { scale: 1.035, duration: 4, ease: "none" }, 0);
  tl.fromTo(el("o-url"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, 1.5);`,
);

/** True near-black, as Linear's own films are, so footage's dark edges disappear into it. */
const ground = scene(
  "ground",
  `#g-fill { position: absolute; inset: 0; background: radial-gradient(70% 60% at 50% 45%, #111214 0%, #08090a 70%); }`,
  `<div id="g-fill"></div>`,
  "",
);

export const SCENES: Record<string, string> = {
  ground,
  intro,
  m1,
  m2,
  m3,
  outro,
};
