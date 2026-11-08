// Checkpoint C's scenes, by hand (docs/BRAND_MOTION_PLAN.md §7, §9): Sarvam, a voice AI product, on a light
// ground with its own orbs as the brand world. Pixels at 1080p; times are seconds into each scene, on a 120 BPM
// grid. Positions are sarvam.ai's CSS pixels (1440×900), measured on job_mw6o12r65ef81c's recording, which is
// 1920×1200 (P source pixels per CSS pixel).
import { readFileSync } from "node:fs";
import { cursor, scene, type Theme } from "./scenes.ts";

const P = 1920 / 1440;
const EARLY = 0.04;
const INK = "#1f1f1f";
const PAPER = "#fbfaf7";
const LIGHT: Theme = { ground: PAPER, ink: INK, bloom: "radial-gradient(closest-side, rgba(245,150,90,0.18), rgba(190,40,100,0.06) 55%, transparent 100%)" };
/** The brand's colours, from its orbs: magenta, maroon, orange, amber, green. */
const ORB_COLOURS = ["#a51d58", "#7a1c3c", "#e8642e", "#f8b84a", "#86c13f"];
const TAMIL = `"Noto Sans Tamil", var(--ac-text)`;

/** The hero's orbs, as circles in its 2× capture (CSS centre and radius). */
const ORBS = {
  maroon: { x: 328, y: 668, r: 126 },
  green: { x: 505, y: 500, r: 87 },
  amber: { x: 962, y: 553, r: 111 },
  orange: { x: 1017, y: 733, r: 79 },
  big: { x: 720, y: 742, r: 247 },
};
type Orb = keyof typeof ORBS;

/** An orb cut from the hero, `d` px across, centred at (x, y). Multiply keeps the white around it invisible on paper. */
const orb = (id: string, name: Orb, d: number, x: number, y: number) => {
  const o = ORBS[name];
  const k = d / (o.r * 2);
  return `<div id="${id}" class="orb" style="left: ${(x - d / 2).toFixed(1)}px; top: ${(y - d / 2).toFixed(1)}px; width: ${d}px; height: ${d}px; background-size: ${(1440 * k).toFixed(1)}px ${(900 * k).toFixed(1)}px; background-position: ${(-(o.x - o.r) * k).toFixed(1)}px ${(-(o.y - o.r) * k).toFixed(1)}px;"></div>`;
};
const ORB_CSS = `.orb { position: absolute; border-radius: 50%; background-image: url(assets/hero.png); background-repeat: no-repeat; mix-blend-mode: multiply; }`;

type Wordmark = { svg: string; letters: number[][]; aspect: number };

export function wordmarkOf(svgFile: string, jsonFile: string): Wordmark {
  const svg = readFileSync(svgFile, "utf8");
  const meta = JSON.parse(readFileSync(jsonFile, "utf8")) as { width: number; height: number; letters: number[][] };
  return { svg, letters: meta.letters, aspect: meta.width / meta.height };
}

export function makeSarvamScenes(o: { wordmark: Wordmark; typed: string; peaks: number[]; voiceAt: number; voiceSeconds: number }) {
  /** 0–4 s. The orbs float in from the edges on the eighth notes around the line, the big one rising like a sun. */
  const placed: [Orb, number, number, number, number, number][] = [
    // name, diameter, x, y, from-x, from-y
    ["maroon", 300, 300, 780, -260, 980],
    ["green", 190, 560, 250, 360, -220],
    ["amber", 250, 1530, 290, 2140, 120],
    ["orange", 170, 1700, 770, 2120, 1180],
  ];
  const intro = scene(
    "intro",
    `${ORB_CSS}
#i-a, #i-b { font-size: 190px; opacity: 0; }
#i-big { z-index: 0; }`,
    `${placed.map(([n, d, x, y], i) => orb(`i-o${i}`, n, d, x, y)).join("")}
  ${orb("i-big", "big", 620, 960, 1270)}
  <div class="center"><div id="i-a" class="line">Built in India.</div></div>
  <div class="center"><div id="i-b" class="line">For India.</div></div>`,
    `  ${JSON.stringify(placed.map(([, , x, y, fx, fy]) => [fx - x, fy - y]))}.forEach(function (from, i) {
    tl.fromTo(el("i-o" + i), { x: from[0], y: from[1], scale: 0.6, rotation: -30 }, { x: 0, y: 0, scale: 1, rotation: 0, duration: 0.9, ease: "back.out(1.3)" }, i * 0.25);
    tl.to(el("i-o" + i), { y: (i % 2 ? 14 : -14), duration: 2.3, ease: "sine.inOut" }, 0.9 + i * 0.25);
    tl.to(el("i-o" + i), { x: from[0] * 0.6, y: from[1] * 0.6, scale: 0.8, duration: 0.4, ease: "power3.in" }, 3.6);
  });
  tl.fromTo(el("i-big"), { y: 260 }, { y: 0, duration: 1.4, ease: "expo.out" }, 0.25);
  tl.to(el("i-big"), { y: 300, duration: 0.4, ease: "power3.in" }, 3.6);
  tl.fromTo(el("i-a"), { opacity: 0, scale: 1.15, filter: "blur(20px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.4, ease: "expo.out" }, 0.5 - ${EARLY});
  tl.to(el("i-a"), { opacity: 0, filter: "blur(12px)", duration: 0.16 }, 1.84);
  tl.fromTo(el("i-b"), { opacity: 0, scale: 1.15, filter: "blur(20px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.4, ease: "expo.out" }, 2 - ${EARLY});
  tl.fromTo(el("i-b"), { scale: 1 }, { scale: 1.06, duration: 1.6, ease: "none" }, 2.4);
  tl.to(el("i-b"), { opacity: 0, filter: "blur(14px)", duration: 0.25 }, 3.75);`,
    LIGHT,
  );

  /**
   * 4–8 s. A glow pill: a line grows into a white pill inside a ring of the brand's colours, the recorded
   * Tamil line types into it, the hand presses "Generate with Bulbul V4" on the beat, and the pill folds back
   * into a line.
   */
  // The first sentence of the recorded line.
  const line = o.typed.split(/(?<=\.)\s/)[0]!;
  const ring = ORB_COLOURS.concat(ORB_COLOURS[0]!).join(", ");
  const pill = { w: 1480, h: 150, x: 220, y: 465 };
  const button = { w: 380, h: 96 };
  const buttonCentre = { x: pill.x + pill.w - 27 - button.w / 2, y: pill.y + pill.h / 2 };
  const pillScene = scene(
    "pill",
    `@font-face { font-family: "Noto Sans Tamil"; src: url("assets/fonts/NotoSansTamil.ttf"); font-weight: 100 900; }
#p-glow { position: absolute; left: ${pill.x - 26}px; top: ${pill.y - 26}px; width: ${pill.w + 52}px; height: ${pill.h + 52}px; border-radius: 999px; background: linear-gradient(90deg, ${ring}, ${ring}); background-size: 200% 100%; filter: blur(28px); opacity: 0; }
#p-pill { position: absolute; left: ${pill.x}px; top: ${pill.y}px; width: ${pill.w}px; height: ${pill.h}px; border-radius: 999px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 30px 80px rgba(120,20,60,0.18); transform-origin: 50% 50%; overflow: hidden; }
#p-text { position: absolute; left: 64px; top: 0; bottom: 0; display: flex; align-items: center; font-family: ${TAMIL}; font-size: 50px; color: ${INK}; white-space: nowrap; }
#p-text span { opacity: 0; white-space: pre; }
#p-caret { display: inline-block; width: 4px; height: 58px; margin-left: 6px; background: #e8642e; border-radius: 2px; }
#p-chip { position: absolute; left: ${pill.x + 40}px; top: ${pill.y - 74}px; font-family: ${TAMIL}; font-size: 28px; color: ${INK}; background: #fff; border-radius: 999px; padding: 10px 26px; box-shadow: 0 0 0 1px rgba(0,0,0,0.08); opacity: 0; }
#p-go { position: absolute; right: 27px; top: ${(pill.h - button.h) / 2}px; width: ${button.w}px; height: ${button.h}px; border-radius: 999px; background: #22252a; color: #fff; font-family: var(--ac-text); font-size: 30px; font-weight: 500; display: flex; align-items: center; justify-content: center; opacity: 0; }
#p-spin { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.25); border-top-color: #fff; opacity: 0; }`,
    `<div id="p-glow"></div>
  <div id="p-chip">தமிழ் · Tamil</div>
  <div id="p-pill"><div id="p-text"><span class="t-run"></span><span id="p-caret"></span></div><div id="p-go"><span id="p-label">Generate with Bulbul V4</span><div id="p-spin"></div></div></div>
  ${cursor("p-cur")}`,
    `  var text = ${JSON.stringify(line)};
  var parts = typeof Intl !== "undefined" && Intl.Segmenter ? Array.from(new Intl.Segmenter("ta", { granularity: "grapheme" }).segment(text), function (s) { return s.segment; }) : Array.from(text);
  var holder = el("p-text"), caret = el("p-caret");
  holder.removeChild(holder.firstChild);
  parts.forEach(function (g, i) {
    var s = document.createElement("span");
    s.textContent = g;
    holder.insertBefore(s, caret);
    // About 18 graphemes a second, from 0.6 s.
    tl.set(s, { opacity: 1 }, 0.6 + i / 18);
  });
  // The line opens into the pill, inside the brand's ring of light.
  tl.fromTo(el("p-pill"), { scaleX: 0.002, scaleY: 0.04 }, { scaleX: 1, duration: 0.3, ease: "expo.out" }, 0);
  tl.to(el("p-pill"), { scaleY: 1, duration: 0.3, ease: "back.out(1.6)" }, 0.22);
  tl.fromTo(el("p-glow"), { opacity: 0, scale: 0.7 }, { opacity: 0.85, scale: 1, duration: 0.8, ease: "expo.out" }, 0.2);
  // The ring's colours flow along it while it's up.
  tl.fromTo(el("p-glow"), { backgroundPosition: "0% 50%" }, { backgroundPosition: "100% 50%", duration: 3.5, ease: "none" }, 0.2);
  tl.fromTo(el("p-go"), { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, 0.45);
  tl.fromTo(el("p-chip"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, ease: "back.out(2)" }, 2 - ${EARLY});
  tl.to(caret, { opacity: 0, duration: 0.01 }, 2.9);
  // The press: the button dips, its words give way to a spinner, the ring of light flares.
  cur.show("p-cur", 1620, 1000, 2.15);
  cur.glide("p-cur", ${buttonCentre.x.toFixed(1)}, ${(buttonCentre.y + 8).toFixed(1)}, 2.2, 0.7);
  cur.hand("p-cur", 2.75);
  cur.press("p-cur", 3);
  tl.to(el("p-go"), { scale: 0.96, duration: 0.08 }, 2.92);
  tl.to(el("p-go"), { scale: 1, duration: 0.2, ease: "back.out(3)" }, 3);
  tl.to(el("p-label"), { opacity: 0, duration: 0.1 }, 3);
  tl.to(el("p-spin"), { opacity: 1, duration: 0.1 }, 3.05);
  tl.fromTo(el("p-spin"), { rotation: 0 }, { rotation: 300, duration: 0.5, ease: "none" }, 3.05);
  tl.to(el("p-glow"), { opacity: 1, scale: 1.06, filter: "blur(36px)", duration: 0.3, ease: "power2.out" }, 3);
  cur.hide("p-cur", 3.25);
  // Folds back into a line, and the line away.
  tl.to(el("p-pill"), { scaleY: 0.04, duration: 0.18, ease: "power3.in" }, 3.55);
  tl.to(el("p-pill"), { scaleX: 0.002, duration: 0.2, ease: "power3.in" }, 3.72);
  tl.to([el("p-glow"), el("p-chip")], { opacity: 0, duration: 0.3 }, 3.6);`,
    LIGHT,
  );

  /**
   * 8–12 s. The real playground, lifted out of the page as a window: the line finishes typing, the hand
   * presses the real Generate, and the real player arrives with the waveform of what Bulbul made. Generate is
   * clicked at 14.46 s of the recording.
   */
  const card = { x: 140, y: 225, w: 1050, h: 458 };
  const K = 1.62;
  const win = { x: (1920 - card.w * K) / 2, y: (1080 - card.h * K) / 2 };
  const MEDIA = 14.46 - 2.5;
  const go = { x: win.x + (707 - card.x) * K, y: win.y + (636 - card.y) * K };
  const playground = scene(
    "playground",
    `${ORB_CSS}
#g-win { position: absolute; left: ${win.x.toFixed(1)}px; top: ${win.y.toFixed(1)}px; width: ${(card.w * K).toFixed(1)}px; height: ${(card.h * K).toFixed(1)}px; overflow: hidden; border-radius: 28px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 50px 120px rgba(90,20,50,0.18); opacity: 0; }
#g-plane { position: absolute; left: 0; top: 0; width: 1920px; height: 1200px; transform-origin: 0 0; transform: translate(${(-card.x * K).toFixed(1)}px, ${(-card.y * K).toFixed(1)}px) scale(${(K / P).toFixed(4)}); }
#g-plane video { position: absolute; left: 0; top: 0; width: 1920px; height: 1200px; }`,
    `${orb("g-o1", "green", 160, 120, 140)}${orb("g-o2", "amber", 200, 1830, 980)}
  <div id="g-win"><div id="g-plane"><video id="g-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="4" data-media-start="${MEDIA.toFixed(2)}"></video></div></div>
  ${cursor("g-cur")}`,
    `  gsap.set(el("g-win"), { transformPerspective: 2400 });
  tl.fromTo(el("g-win"), { opacity: 0, y: 160, rotationX: 22, scale: 0.9 }, { opacity: 1, y: 0, rotationX: 4, scale: 1, duration: 0.7, ease: "expo.out" }, 0);
  tl.to(el("g-win"), { rotationX: 0, scale: 1.03, duration: 3.3, ease: "none" }, 0.7);
  tl.fromTo([el("g-o1"), el("g-o2")], { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: "back.out(1.5)", stagger: 0.15 }, 0.1);
  cur.show("g-cur", 1500, 1060, 1.1);
  cur.glide("g-cur", ${go.x.toFixed(1)}, ${(go.y + 6).toFixed(1)}, 1.2, 0.95);
  cur.hand("g-cur", 2.0);
  cur.press("g-cur", 2.5);
  tl.to(el("g-cur"), { x: ${(go.x + 160).toFixed(1)}, y: ${(go.y + 140).toFixed(1)}, duration: 0.6, ease: "power2.inOut" }, 2.75);
  cur.hide("g-cur", 3.3);
  tl.to(el("g-win"), { y: -60, opacity: 0, filter: "blur(10px)", duration: 0.3, ease: "power3.in" }, 3.72);`,
    LIGHT,
  );

  /**
   * 12–16 s. The site's own line, "Don't take our word for it. Listen.", and the big orb: the hand presses its
   * play button and one of Bulbul V4's own samples plays, its waveform lighting up as it goes.
   */
  const bars = o.peaks.length;
  const barW = 14;
  const gap = 8;
  const waveW = bars * (barW + gap);
  const wave = { x: 860, y: 600, h: 260 };
  const listen = scene(
    "listen",
    `${ORB_CSS}
#l-small { position: absolute; left: 860px; top: 250px; font-family: var(--ac-text); font-size: 48px; color: #6b6b6b; opacity: 0; }
#l-big { position: absolute; left: 852px; top: 300px; font-size: 170px; opacity: 0; }
#l-wave { position: absolute; left: ${wave.x}px; top: ${wave.y - wave.h / 2}px; width: ${waveW}px; height: ${wave.h}px; }
.bar { position: absolute; bottom: 50%; width: ${barW}px; border-radius: ${barW / 2}px; background: #d9d6d0; transform-origin: 50% 100%; }
.bar-d { position: absolute; top: 50%; width: ${barW}px; border-radius: ${barW / 2}px; background: #e7e4de; transform-origin: 50% 0; }
#l-tag { position: absolute; left: 860px; top: ${wave.y + wave.h / 2 + 40}px; font-family: var(--ac-text); font-size: 30px; color: ${INK}; background: #fff; border-radius: 999px; padding: 10px 26px; box-shadow: 0 0 0 1px rgba(0,0,0,0.08); opacity: 0; }`,
    `${orb("l-orb", "big", 700, 470, 880)}
  <div id="l-small">Don’t take our word for it.</div>
  <div id="l-big" class="line">Listen.</div>
  <div id="l-wave">${o.peaks
      .map((p, i) => {
        const h = Math.max(6, p * (wave.h / 2 - 6));
        return `<div id="l-b${i}" class="bar" style="left: ${i * (barW + gap)}px; height: ${h.toFixed(1)}px;"></div><div id="l-d${i}" class="bar-d" style="left: ${i * (barW + gap)}px; height: ${(h * 0.55).toFixed(1)}px;"></div>`;
      })
      .join("")}</div>
  <div id="l-tag">Bulbul V4</div>
  ${cursor("l-cur")}`,
    `  tl.fromTo(el("l-orb"), { y: 500, scale: 0.8 }, { y: 0, scale: 1, duration: 0.8, ease: "expo.out" }, 0);
  tl.fromTo(el("l-small"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }, 0.1);
  tl.fromTo(el("l-big"), { opacity: 0, scale: 1.15, filter: "blur(18px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.4, ease: "expo.out" }, 0.5 - ${EARLY});
  tl.fromTo(el("l-tag"), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.35, ease: "back.out(2)" }, 1);
  // The bars rise in, grey; then, from the press, each lights in the brand's colours as the voice reaches it.
  for (var i = 0; i < ${bars}; i++) {
    tl.fromTo([el("l-b" + i), el("l-d" + i)], { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "back.out(2)" }, 0.3 + i * 0.006);
    var at = ${o.voiceAt} + (i / ${bars}) * ${o.voiceSeconds};
    var c = ${JSON.stringify(ORB_COLOURS)}[Math.floor((i / ${bars}) * 5)];
    tl.to(el("l-b" + i), { backgroundColor: c, duration: 0.08 }, at);
    tl.to(el("l-d" + i), { backgroundColor: c, opacity: 0.35, duration: 0.08 }, at);
    tl.fromTo(el("l-b" + i), { scaleY: 1 }, { scaleY: 1.18, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out" }, at);
  }
  // The orb breathes with the voice.
  tl.fromTo(el("l-orb"), { scale: 1 }, { scale: 1.035, duration: 0.25, yoyo: true, repeat: ${Math.max(1, Math.floor(o.voiceSeconds / 0.5) * 2 - 1)}, ease: "sine.inOut" }, ${o.voiceAt});
  cur.show("l-cur", 980, 1060, 0);
  cur.glide("l-cur", 470, 895, 0.05, 0.4);
  cur.hand("l-cur", 0.3);
  cur.press("l-cur", ${o.voiceAt});
  cur.hide("l-cur", ${o.voiceAt + 0.35});
  tl.to([el("l-small"), el("l-big"), el("l-wave"), el("l-tag")], { opacity: 0, x: -60, duration: 0.25, ease: "power3.in" }, 3.75);
  tl.to(el("l-orb"), { x: -700, duration: 0.3, ease: "power3.in" }, 3.72);`,
    LIGHT,
  );

  /**
   * 16–20 s, on the strong bar. The real request, lifted out of the page: the dark code card slides in from the
   * right and comes to rest tilted, beside the product's name, while its real terms ride a rule below.
   */
  const code = { x: 846, y: 345, w: 313, h: 307 };
  const CK = 1.62;
  const terms = ["Text to Speech", "bulbul:v4-flash", "Voice Agents", "Document AI", "Sarvam Cloud", "On-Premises", "Indus Cowork"];
  const codeScene = scene(
    "code",
    `${ORB_CSS}
#c-card { position: absolute; left: 1050px; top: 150px; width: ${(code.w * CK).toFixed(1)}px; height: ${(code.h * CK).toFixed(1)}px; overflow: hidden; border-radius: 26px; box-shadow: 0 60px 120px rgba(40,10,30,0.35); }
#c-plane { position: absolute; left: 0; top: 0; width: 1920px; height: 1200px; transform-origin: 0 0; transform: translate(${(-code.x * CK).toFixed(1)}px, ${(-code.y * CK).toFixed(1)}px) scale(${(CK / P).toFixed(4)}); }
#c-plane video { position: absolute; left: 0; top: 0; width: 1920px; height: 1200px; }
#c-name { position: absolute; left: 160px; top: 300px; font-size: 150px; opacity: 0; }
#c-model { position: absolute; left: 168px; top: 490px; font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 44px; color: #a51d58; opacity: 0; }
#c-rule { position: absolute; left: 0; right: 0; top: 900px; height: 2px; background: ${INK}; opacity: 0.25; transform-origin: 0 50%; }
#c-track { position: absolute; left: 0; top: 832px; display: flex; white-space: nowrap; }
.term { font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.03em; font-size: 54px; color: ${INK}; padding-right: 90px; }`,
    `${orb("c-o1", "orange", 200, 1820, 120)}
  <div id="c-card"><div id="c-plane"><video id="c-v" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="4" data-media-start="16.6"></video></div></div>
  <div id="c-name" class="line">Bulbul V4</div>
  <div id="c-model">bulbul:v4-flash</div>
  <div id="c-rule"></div>
  <div id="c-track">${terms.map((t) => `<div class="term">${t}</div>`).join("")}</div>`,
    `  gsap.set(el("c-card"), { transformPerspective: 2200 });
  tl.fromTo(el("c-card"), { x: 1100, rotationY: -40, rotationZ: 6 }, { x: 0, rotationY: -14, rotationZ: 1.5, duration: 0.8, ease: "expo.out" }, 0);
  tl.to(el("c-card"), { rotationY: -6, rotationZ: 0, scale: 1.04, duration: 3, ease: "none" }, 0.8);
  tl.fromTo(el("c-name"), { opacity: 0, y: 40, filter: "blur(14px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.45, ease: "expo.out" }, 0.5 - ${EARLY});
  tl.fromTo(el("c-model"), { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.4, ease: "expo.out" }, 1 - ${EARLY});
  tl.fromTo(el("c-rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "expo.out" }, 0.9);
  tl.fromTo(el("c-track"), { x: 1920 }, { x: -1500, duration: 3.1, ease: "none" }, 0.9);
  tl.fromTo(el("c-o1"), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: "back.out(1.4)" }, 0.2);
  tl.to([el("c-card"), el("c-name"), el("c-model"), el("c-track"), el("c-rule")], { opacity: 0, y: -40, duration: 0.25, ease: "power3.in" }, 3.75);`,
    LIGHT,
  );

  /**
   * 20–24 s, on the track's own ending. The wordmark's letters rise one after another (it has no mark to
   * lead with), the orbs come back around it, then the call to action and the address.
   */
  const W = 760;
  const H = W / o.wordmark.aspect;
  const left = (1920 - W) / 2;
  const top = 380;
  const letters = o.wordmark.letters
    .map(([x, , w], i) => `<div id="e-l${i}" class="letter" style="left: ${(x! * W).toFixed(1)}px; width: ${(w! * W).toFixed(1)}px;">${o.wordmark.svg.replace("<svg ", `<svg width="${W}" height="${H.toFixed(1)}" style="position:absolute;left:${(-x! * W).toFixed(1)}px;top:0" `)}</div>`)
    .join("");
  const end: [Orb, number, number, number][] = [
    ["maroon", 230, 300, 300],
    ["green", 150, 1600, 220],
    ["amber", 200, 1660, 820],
    ["orange", 130, 330, 850],
  ];
  const outro = scene(
    "outro",
    `${ORB_CSS}
#e-mark { position: absolute; left: ${left}px; top: ${top}px; width: ${W}px; height: ${H.toFixed(1)}px; }
.letter { position: absolute; top: 0; height: 100%; overflow: hidden; }
#e-cta { position: absolute; left: 0; right: 0; top: ${top + H + 70}px; text-align: center; font-family: var(--ac-display); font-weight: 600; letter-spacing: -0.03em; font-size: 64px; color: ${INK}; opacity: 0; }
#e-url { position: absolute; left: 0; right: 0; top: ${top + H + 180}px; display: flex; justify-content: center; }
#e-pill { font-family: var(--ac-text); font-size: 32px; color: #fff; background: ${INK}; border-radius: 999px; padding: 12px 34px; opacity: 0; }`,
    `${end.map(([n, d, x, y], i) => orb(`e-o${i}`, n, d, x, y)).join("")}
  <div id="e-mark">${letters}</div>
  <div id="e-cta">Try Sarvam APIs</div>
  <div id="e-url"><div id="e-pill">sarvam.ai</div></div>`,
    `  for (var i = 0; i < ${o.wordmark.letters.length}; i++)
    tl.fromTo(el("e-l" + i).firstChild, { y: ${(H * 1.1).toFixed(1)}, filter: "blur(8px)" }, { y: 0, filter: "blur(0px)", duration: 0.55, ease: "expo.out" }, 0.5 - ${EARLY} + i * 0.09);
  tl.fromTo(el("e-mark"), { scale: 1 }, { scale: 1.04, duration: 3.5, ease: "none" }, 0.5);
  ${JSON.stringify(end.map(([, , x, y]) => [x < 960 ? -500 : 500, y < 540 ? -300 : 300]))}.forEach(function (from, i) {
    tl.fromTo(el("e-o" + i), { x: from[0], y: from[1], scale: 0.5 }, { x: 0, y: 0, scale: 1, duration: 1, ease: "back.out(1.2)" }, 0.9 + i * 0.12);
  });
  tl.fromTo(el("e-cta"), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45, ease: "expo.out" }, 1.5 - ${EARLY});
  tl.fromTo(el("e-pill"), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45, ease: "expo.out" }, 2 - ${EARLY});`,
    LIGHT,
  );

  return { intro, pill: pillScene, playground, listen, code: codeScene, outro };
}
