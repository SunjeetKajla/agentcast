// The scene catalogue (PRD §9.7.4): each function writes one HyperFrames scene file. Copy, length,
// transitions and sampled paths arrive as the mount's variables, so the same file renders every
// language and aspect, and a scene the director rewrites keeps working across variants. The look
// copies the two reference films; the comments say which moment.

export type Vars = Record<string, string | number | boolean>;
export type Size = { w: number; h: number };

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The variables a scene declares, typed from the values it's mounted with. */
export function declare(vars: Vars) {
  return Object.entries(vars).map(([id, value]) => ({
    id,
    type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
    label: id,
    default: value,
  }));
}

/**
 * A scene file: its root (`#root`, same composition id as its host), the `in` wrapper the arrival
 * animates, the `out` wrapper the exit animates, and the scene's own markup inside. `script` runs with
 * `S` (AC.scene), `v` (its variables) and `tl` (its paused timeline) in scope.
 */
function sceneFile(id: string, size: Size, vars: Vars, css: string, body: string, script: string) {
  return `<template>
<style>
#root { position: absolute; inset: 0; overflow: hidden; }
${css.replaceAll("#S-", `#${id}-`)}
</style>
<div id="root" data-composition-id="${id}" data-width="${size.w}" data-height="${size.h}" data-composition-variables='${esc(JSON.stringify(declare(vars)))}'>
  <div id="${id}-in" class="ac-fill"><div id="${id}-out" class="ac-fill">
${body.replaceAll('id="S-', `id="${id}-`)}
  </div></div>
  <div id="${id}-ribbon" class="ac-ribbon" data-layout-allow-overflow></div>
</div>
<script>
(function () {
  var S = AC.scene(${JSON.stringify(id)}, window.__hyperframes.getVariables()), v = S.v, tl = S.tl;
  AC.enter(tl, S.el("in"), v.enter, Number(v.enterSecs), S.el("ribbon"));
  AC.exit(tl, S.el("out"), v.exit, Number(v.exitSecs), S.dur);
${script}
  S.done();
})();
</script>
</template>
`;
}

/** The ambient layer under every scene: soft glows on slow orbits and film grain (both films). */
export function groundScene(id: string, size: Size, vars: Vars) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-glows { position: absolute; inset: -20%; }
#S-glows .g { position: absolute; border-radius: 50%; filter: blur(calc(120 * var(--ac-u))); opacity: 0.55; }
#S-g1 { width: 55%; height: 60%; left: 2%; top: 48%; background: var(--ac-glow1); }
#S-g2 { width: 50%; height: 55%; left: 52%; top: 0%; background: var(--ac-glow2); }
#S-g3 { width: 35%; height: 40%; left: 35%; top: 30%; background: var(--ac-glow3); opacity: 0.35; }`,
    `    <div id="S-base" class="ac-fill" style="background: var(--ac-bg)"></div>
    <div id="S-glows"><div id="S-g1" class="g"></div><div id="S-g2" class="g"></div><div id="S-g3" class="g"></div></div>
    <div id="S-grain" class="ac-fill ac-grain"></div>`,
    `  var orbit = function (el, dx, dy, period, phase) {
    var half = period / 2, n = Math.ceil(S.dur / half);
    tl.fromTo(el, { xPercent: -dx, yPercent: -dy }, { xPercent: dx, yPercent: dy, duration: half, ease: "sine.inOut", repeat: n, yoyo: true }, -phase);
  };
  orbit(S.el("g1"), 14, 8, 11, 2);
  orbit(S.el("g2"), -10, 12, 13, 5);
  orbit(S.el("g3"), 18, -10, 9, 1);
  var steps = Math.max(1, Math.round(S.dur * 12));
  tl.fromTo(S.el("grain"), { backgroundPosition: "0px 0px" }, { backgroundPosition: steps * 37 + "px " + steps * 53 + "px", duration: S.dur, ease: "steps(" + steps + ")" }, 0);`,
  );
}

const ground = `    <div id="S-ground" class="ac-fill"></div>`;
const groundScript = `  var g = S.el("ground");
  if (v.ground === "field") g.className = "ac-fill ac-ground-field";
  else if (v.ground === "dark") g.className = "ac-fill ac-ground-dark";
  if (v.ground === "field" || v.ground === "dark") { S.el("out").classList.add(v.ground === "dark" ? "ac-on-dark" : "ac-on-field"); g.insertAdjacentHTML("beforeend", '<div class="ac-fill ac-grain"></div>'); }`;

/**
 * The opening (Lovable 0–8.5 s, LangEase 0–3 s): the script's title line as kinetic type, then the
 * logo landing with the product name building beside it and the site typing on underneath.
 * Layouts: center, editorial (left column), wordmark (the name huge), split (beside the hero).
 */
export function titleScene(id: string, size: Size, vars: Vars, o: { logo: boolean; hero: boolean }) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-tag { padding: 0 8%; }
#S-lock { gap: calc(28 * var(--ac-u)); }
#S-row { display: flex; align-items: center; gap: calc(34 * var(--ac-u)); }
#S-logo { height: calc(110 * var(--ac-u)); width: auto; display: block; }
#S-site { font-family: var(--ac-text); font-size: calc(30 * var(--ac-u)); letter-spacing: 0.02em; opacity: 0.7; min-height: 1.2em; }
#S-hero { position: absolute; right: -8%; top: 18%; width: 52%; aspect-ratio: 16 / 10; border-radius: calc(var(--ac-radius) * 1.4); overflow: hidden; box-shadow: 0 calc(50 * var(--ac-u)) calc(120 * var(--ac-u)) rgba(0,0,0,0.28); }
#S-hero img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.layout-editorial #S-lock, .layout-split #S-lock { align-items: flex-start; padding-left: 9%; text-align: left; }
.layout-split #S-lock { width: 52%; }`,
    `${ground}
    <div id="S-tag" class="ac-fill ac-center"></div>
    ${o.hero ? `<div id="S-hero"><img src="assets/hero.jpg" alt=""></div>` : ""}
    <div id="S-lock" class="ac-fill ac-center">
      <div id="S-row">${o.logo ? `<img id="S-logo" src="assets/logo.png" alt="">` : ""}<div id="S-name"></div></div>
      <div id="S-site"></div>
    </div>`,
    `${groundScript}
  S.el("out").classList.add("layout-" + v.layout);
  var lockAt = 0.1;
  if (v.title && S.dur >= 2.6) {
    var cut = S.dur * 0.45;
    AC.words(tl, S.el("tag"), v.title, v.accent, 0.1, cut, "swap", 150);
    tl.fromTo(S.el("tag"), { opacity: 1 }, { opacity: 0, duration: 0.25, ease: "power2.in", immediateRender: false }, cut - 0.2);
    lockAt = cut;
  }
  tl.fromTo(S.el("lock"), { opacity: 0 }, { opacity: 1, duration: 0.01 }, lockAt);
  var logo = S.el("logo");
  if (logo) tl.fromTo(logo, { opacity: 0, scale: 0.55, rotation: -10, filter: "blur(14px)" }, { opacity: 1, scale: 1, rotation: 0, filter: "blur(0px)", duration: 0.6, ease: "back.out(1.8)" }, lockAt);
  var big = v.layout === "wordmark" ? 230 : 180;
  var share = v.layout === "split" ? 0.3 : logo ? 0.62 : 0.84;
  if (logo && v.logoHasName) logo.style.height = "calc(" + (v.layout === "wordmark" ? 190 : 150) + " * var(--ac-u))";
  else AC.words(tl, S.el("name"), v.name, v.name, lockAt + 0.12, S.dur, "build", big, share);
  AC.typeOn(tl, S.el("site"), v.site, lockAt + 0.55, Math.min(0.8, String(v.site).length * 0.04));
  var hero = S.el("hero");
  if (hero) tl.fromTo(hero, { opacity: 0, rotationY: -28, rotationX: 12, scale: 0.8, transformPerspective: 2400 }, { opacity: 1, rotationY: -12, rotationX: 5, scale: 1, duration: 1.4, ease: "power3.out" }, lockAt);
  AC.drift(tl, S.el("row"), S.dur, 0.1);
  AC.drift(tl, S.el("tag"), S.dur, 0.12);`,
  );
}

/**
 * A headline as kinetic type (LangEase 0–3 s and 24.6–28.4 s; Lovable 9–12.5 s and 53.5–57 s): short
 * lines build word by word on one line, longer ones swap in 1–3-word groups; the accent word takes the
 * brand colour (a gradient fill for colourful brands). Grounds: clear, field (brand gradient), dark.
 */
export function kineticScene(id: string, size: Size, vars: Vars) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-kicker { position: absolute; left: 0; right: 0; top: 30%; text-align: center; font-family: var(--ac-text); font-size: calc(30 * var(--ac-u)); letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6; }
#S-words { padding: 0 7%; }`,
    `${ground}
    <div id="S-body" class="ac-fill">
      <div id="S-kicker"></div>
      <div id="S-words" class="ac-fill ac-center"></div>
    </div>`,
    `${groundScript}
  var words = String(v.text || "").split(/\\s+/).filter(Boolean);
  var mode = words.length <= 4 && String(v.text).length <= 26 ? "build" : "swap";
  AC.words(tl, S.el("words"), v.text, v.accent, Number(v.enterSecs) * 0.5 + 0.05, S.dur - 0.2, mode, 210);
  if (v.kicker) { S.el("kicker").textContent = v.kicker; tl.fromTo(S.el("kicker"), { opacity: 0, y: 20 }, { opacity: 0.6, y: 0, duration: 0.4, ease: "power3.out" }, 0.1); }
  AC.drift(tl, S.el("body"), S.dur, 0.12);`,
  );
}

/**
 * A recorded moment (LangEase 15.8–17.4 s and 20.2–22 s; Lovable 27–33 s): the footage in a window
 * that arrives tilted from depth and opens to the full frame as the camera dives in, the big cursor
 * squishing on each click, callouts lifting out as chips, a title riding in as kinetic type.
 * `clips` are the footage pieces (one per speed ramp), timed in the file so re-runs can remap them.
 */
export function shotScene(
  id: string,
  size: Size,
  vars: Vars,
  o: { clips: { start: number; duration: number; mediaStart: number; rate: number }[]; src: Size },
) {
  const video = o.clips
    .map(
      (c, i) =>
        `<video id="S-v${i}" class="clip" src="assets/footage.mp4" muted playsinline data-start="${c.start}" data-duration="${c.duration}" data-media-start="${c.mediaStart}"${c.rate !== 1 ? ` data-playback-rate="${c.rate}"` : ""}></video>`,
    )
    .join("\n          ");
  return sceneFile(
    id,
    size,
    vars,
    `#S-win { position: absolute; left: 0; top: 0; width: var(--ac-w); height: var(--ac-h); overflow: hidden; background: var(--ac-surface); transform-origin: 50% 50%; box-shadow: 0 0 0 calc(1.5 * var(--ac-u)) var(--ac-rim), 0 calc(60 * var(--ac-u)) calc(140 * var(--ac-u)) rgba(0,0,0,0.35); }
#S-plane { position: absolute; left: 0; top: 0; width: ${o.src.w}px; height: ${o.src.h}px; transform-origin: 0 0; }
#S-plane video { position: absolute; left: 0; top: 0; width: ${o.src.w}px; height: ${o.src.h}px; }
#S-bar { position: absolute; left: 0; right: 0; top: 0; height: calc(64 * var(--ac-u)); background: var(--ac-surface); display: flex; align-items: center; gap: calc(12 * var(--ac-u)); padding: 0 calc(26 * var(--ac-u)); border-bottom: 1px solid rgba(0,0,0,0.06); }
#S-bar i { width: calc(16 * var(--ac-u)); height: calc(16 * var(--ac-u)); border-radius: 50%; background: rgba(127,127,127,0.35); display: block; }
#S-url { margin-left: calc(24 * var(--ac-u)); padding: calc(8 * var(--ac-u)) calc(22 * var(--ac-u)); border-radius: 999px; background: rgba(127,127,127,0.12); font-family: var(--ac-text); font-size: calc(22 * var(--ac-u)); color: var(--ac-fg); opacity: 0.75; }
#S-title { position: absolute; left: 0; right: 0; bottom: 14%; }
#S-title { padding: calc(18 * var(--ac-u)) 0; }
#S-title .ac-line { color: var(--ac-fg); text-shadow: 0 0 calc(30 * var(--ac-u)) var(--ac-bg), 0 0 calc(60 * var(--ac-u)) var(--ac-bg), 0 0 calc(90 * var(--ac-u)) var(--ac-bg); }
#S-lts { position: absolute; left: 6%; bottom: 9%; }`,
    `    <div id="S-body" class="ac-fill">
      <div id="S-win">
        <div id="S-plane">
          ${video}
        </div>
        <div id="S-bar"><i></i><i></i><i></i><span id="S-url"></span></div>
        <div id="S-chips" class="ac-fill"></div>
        <div id="S-ripple" class="ac-ripple"></div>
        <div id="S-cursor" class="ac-cursor"><svg viewBox="0 0 32 32"><path d="M6 3 L6 26 L12 20 L16 29 L20 27.5 L16 18.6 L24.5 18.6 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>
      </div>
      <div id="S-lts"></div>
      <div id="S-title" class="ac-center"></div>
    </div>`,
    `  var u = AC.u();
  AC.path(tl, S.el("plane"), AC.json(v.cam, []), ["x", "y", "scale"]);
  var win = S.el("win");
  gsap.set(win, { transformPerspective: 2600 * u });
  AC.path(tl, win, AC.json(v.win, []), ["rotationX", "rotationY", "rotationZ", "scale", "y", "borderRadius"]);
  var bar = S.el("bar");
  if (v.chrome === "browser") { S.el("url").textContent = v.url; AC.path(tl, bar, AC.json(v.bar, []), ["opacity"]); } else bar.style.display = "none";
  var cur = S.el("cursor");
  AC.path(tl, cur, AC.json(v.cursor, []), ["x", "y", "opacity"]);
  var rip = S.el("ripple");
  AC.json(v.clicks, []).forEach(function (c) {
    tl.fromTo(cur, { scale: 1 }, { scale: 0.82, duration: 0.09, ease: "power2.out", yoyo: true, repeat: 1, immediateRender: false }, Math.max(0, c[0] - 0.06));
    tl.fromTo(rip, { x: c[1], y: c[2], scale: 0.2, opacity: 0.85 }, { x: c[1], y: c[2], scale: 2.4, opacity: 0, duration: 0.55, ease: "power2.out", immediateRender: false }, c[0]);
  });
  // Callouts lift out of the page as chips next to their element (LangEase 17.4 s).
  AC.json(v.callouts, []).forEach(function (c, i) {
    var chip = document.createElement("div");
    chip.className = "ac-chip";
    chip.textContent = v["co" + i] || "";
    chip.style.left = c.x + "px"; chip.style.top = c.y + "px";
    S.el("chips").appendChild(chip);
    tl.fromTo(chip, { opacity: 0, y: 18 * u, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.6)" }, c.t);
    tl.fromTo(chip, { opacity: 1 }, { opacity: 0, y: -10 * u, duration: 0.25, ease: "power2.in", immediateRender: false }, c.t + c.secs);
  });
  AC.json(v.lowerThirds, []).forEach(function (l, i) {
    var lt = document.createElement("div");
    lt.className = "ac-chip ac-chip-big";
    lt.textContent = v["lt" + i] || "";
    S.el("lts").appendChild(lt);
    tl.fromTo(lt, { opacity: 0, x: -30 * u }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" }, l.t);
    tl.fromTo(lt, { opacity: 1 }, { opacity: 0, duration: 0.25, immediateRender: false }, l.t + l.secs);
  });
  if (v.title) {
    var tEnd = Math.min(S.dur, Number(v.titleSecs) + 0.3);
    AC.words(tl, S.el("title"), v.title, v.titleAccent, 0.15, tEnd, "build", 120);
    tl.fromTo(S.el("title"), { opacity: 1 }, { opacity: 0, duration: 0.3, immediateRender: false }, tEnd);
  }`,
  );
}

/**
 * The payoff clips as floating screens around a centred line (LangEase 5.8–10 s and 18.2–20 s): the
 * screens tilt in 3D and drift toward the camera while the line builds in the middle.
 */
export function montageScene(
  id: string,
  size: Size,
  vars: Vars,
  o: { clips: { duration: number; mediaStart: number; rate: number }[] },
) {
  const spots = [
    [-0.31, -0.24, 18, -14, -4],
    [0.3, -0.26, 14, 16, 5],
    [-0.29, 0.25, -12, -18, 3],
    [0.32, 0.23, -16, 14, -5],
  ];
  const cards = o.clips
    .slice(0, 4)
    .map(
      (c, i) =>
        `<div id="S-c${i}" class="ac-card" data-spot="${spots[i]!.join(",")}"><video id="S-v${i}" class="clip" src="assets/footage.mp4" muted playsinline data-start="0" data-duration="${c.duration}" data-media-start="${c.mediaStart}"${c.rate !== 1 ? ` data-playback-rate="${c.rate}"` : ""}></video></div>`,
    )
    .join("\n      ");
  return sceneFile(
    id,
    size,
    vars,
    `#S-stage { position: absolute; inset: 0; perspective: calc(2200 * var(--ac-u)); }
#S-stage .ac-card { position: absolute; left: 50%; top: 50%; width: 40%; aspect-ratio: 16 / 10; margin-left: -20%; margin-top: -12.5%; border-radius: calc(var(--ac-radius) * 1.2); overflow: hidden; background: var(--ac-surface); box-shadow: 0 calc(40 * var(--ac-u)) calc(110 * var(--ac-u)) rgba(0,0,0,0.25); }
#S-stage .ac-card video { width: 100%; height: 100%; object-fit: cover; object-position: top; }
#S-words { padding: 0 20%; }
#S-words .ac-line { text-shadow: 0 0 calc(40 * var(--ac-u)) var(--ac-bg), 0 0 calc(80 * var(--ac-u)) var(--ac-bg); }`,
    `${ground}
    <div id="S-stage">
      ${cards}
    </div>
    <div id="S-words" class="ac-fill ac-center"></div>`,
    `${groundScript}
  var s = AC.size(), tall = s.tall;
  Array.prototype.forEach.call(S.el("stage").children, function (card, i) {
    var p = card.getAttribute("data-spot").split(",").map(Number);
    var x = p[0] * s.w * (tall ? 0.7 : 1), y = p[1] * s.h * (tall ? 1.15 : 1);
    tl.fromTo(card, { x: x * 1.5, y: y * 1.5, z: -900, rotationX: p[2] * 1.6, rotationY: p[3] * 1.6, rotationZ: p[4], opacity: 0 },
      { x: x, y: y, z: -120, rotationX: p[2], rotationY: p[3], rotationZ: p[4] * 0.6, opacity: 1, duration: 1.1, ease: "power3.out" }, 0.05 + i * 0.12);
    tl.to(card, { z: 160, x: x * 1.18, y: y * 1.18, rotationX: p[2] * 0.7, rotationY: p[3] * 0.7, duration: Math.max(0.5, S.dur - 1.2), ease: "none" }, 1.15 + i * 0.12);
  });
  if (v.text) AC.words(tl, S.el("words"), v.text, v.accent, 0.5, S.dur - 0.2, "build", 150);`,
  );
}

/** A counting number on a glowing line (Lovable 12.5–17.9 s). Real numbers only. */
export function statScene(id: string, size: Size, vars: Vars) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-num { font-family: var(--ac-display); font-weight: 800; font-size: calc(230 * var(--ac-u)); letter-spacing: -0.05em; font-variant-numeric: tabular-nums; line-height: 1; }
#S-label { margin-top: calc(26 * var(--ac-u)); }
#S-line { position: absolute; left: -5%; width: 110%; top: 55%; height: 40%; overflow: visible; }
#S-line path { fill: none; stroke: url(#S-grad); stroke-width: calc(14 * var(--ac-u)); stroke-linecap: round; filter: drop-shadow(0 0 calc(18 * var(--ac-u)) var(--ac-accent)); }`,
    `${ground}
    <svg id="S-line" viewBox="0 0 1000 300" preserveAspectRatio="none"><defs><linearGradient id="S-grad" x1="0" x2="1"><stop offset="0" stop-color="var(--ac-glow2)"/><stop offset="1" stop-color="var(--ac-accent)"/></linearGradient></defs><path id="S-path" d="M0,260 C150,250 220,120 360,170 S600,280 700,140 S880,30 1000,20"/></svg>
    <div id="S-body" class="ac-fill ac-center"><div id="S-num"></div><div id="S-label"></div></div>`,
    `${groundScript}
  var path = S.el("path"), len = 1400;
  path.style.strokeDasharray = len;
  tl.fromTo(path, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: Math.min(2.2, S.dur * 0.7), ease: "power2.out" }, 0.1);
  var to = Number(v.value), from = to >= 100 ? Math.round(to * 0.7) : 0;
  AC.count(tl, S.el("num"), from, to, 0.15, Math.min(2.2, S.dur * 0.7), Number(v.decimals) || 0, v.prefix, v.suffix);
  tl.fromTo(S.el("num"), { opacity: 0, scale: 1.2, filter: "blur(16px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "power3.out" }, 0.1);
  AC.words(tl, S.el("label"), v.label, v.accent, 0.6, S.dur, "build", 70);
  AC.drift(tl, S.el("body"), S.dur, 0.08);`,
  );
}

/** The end card, the only hold (both films' last 3–4 s): lockup, the CTA, the URL typing on in a pill. */
export function outroScene(id: string, size: Size, vars: Vars, o: { logo: boolean }) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-body { gap: calc(34 * var(--ac-u)); }
#S-row { display: flex; align-items: center; gap: calc(24 * var(--ac-u)); }
#S-logo { height: calc(84 * var(--ac-u)); width: auto; display: block; }
#S-name { font-family: var(--ac-display); font-weight: 700; font-size: calc(76 * var(--ac-u)); letter-spacing: -0.03em; }
#S-cta { padding: 0 8%; }
#S-url { font-family: var(--ac-text); font-size: calc(32 * var(--ac-u)); padding: calc(14 * var(--ac-u)) calc(34 * var(--ac-u)); border-radius: 999px; background: var(--ac-fg); color: var(--ac-bg); min-height: 1.2em; }`,
    `${ground}
    <div id="S-body" class="ac-fill ac-center">
      <div id="S-row">${o.logo ? `<img id="S-logo" src="assets/logo.png" alt="">` : ""}<div id="S-name"></div></div>
      <div id="S-cta"></div>
      <div id="S-url"></div>
    </div>`,
    `${groundScript}
  var logo = S.el("logo");
  S.el("name").textContent = logo && v.logoHasName ? "" : v.name;
  if (logo) tl.fromTo(logo, { opacity: 0, scale: 0.6, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "back.out(1.7)" }, 0.1);
  tl.fromTo(S.el("name"), { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 0.2);
  if (v.cta) AC.words(tl, S.el("cta"), v.cta, v.accent, 0.4, S.dur, "build", 120);
  tl.fromTo(S.el("url"), { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.7)" }, 0.9);
  AC.typeOn(tl, S.el("url"), v.site, 1.0, Math.min(0.9, String(v.site).length * 0.05));`,
  );
}

/**
 * Captions over the whole video, one line at a time in the bottom band, each word lighting as it's
 * spoken (karaoke) or the line alone (block, minimal). Lines come as `[{s, e, text, words}]`.
 */
export function captionsScene(id: string, size: Size, vars: Vars) {
  return sceneFile(
    id,
    size,
    vars,
    `#S-band { position: absolute; left: 8%; right: 8%; bottom: 7%; display: flex; justify-content: center; }
#S-band .cap { position: absolute; bottom: 0; max-width: 100%; text-align: center; font-family: var(--ac-text); font-weight: 600; font-size: calc(40 * var(--ac-u)); line-height: 1.25; color: #fff; opacity: 0; }
#S-band .cap { background: rgba(10,10,14,0.78); padding: calc(12 * var(--ac-u)) calc(24 * var(--ac-u)); border-radius: calc(14 * var(--ac-u)); }
.style-minimal #S-band .cap { font-size: calc(32 * var(--ac-u)); padding: calc(8 * var(--ac-u)) calc(18 * var(--ac-u)); background: rgba(10,10,14,0.62); }
#S-band .w { opacity: 0.55; }`,
    `    <div id="S-band"></div>`,
    `  S.el("out").classList.add("style-" + v.style);
  AC.json(v.lines, []).forEach(function (line) {
    var el = document.createElement("div");
    el.className = "cap";
    S.el("band").appendChild(el);
    if (v.style === "karaoke" && line.words && line.words.length) {
      line.words.forEach(function (w, i) {
        var span = document.createElement("span");
        span.className = "w"; span.textContent = w.t;
        el.appendChild(span);
        if (i < line.words.length - 1) el.appendChild(document.createTextNode(" "));
        tl.fromTo(span, { opacity: 0.55 }, { opacity: 1, duration: 0.08, immediateRender: false }, w.s);
      });
    } else el.textContent = line.text;
    tl.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.18, ease: "power2.out" }, line.s);
    tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.15, immediateRender: false }, Math.max(line.s + 0.2, line.e));
  });`,
  );
}

/** The styles every scene shares, on index.html. */
export const SHARED_CSS = `* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--ac-w); height: var(--ac-h); overflow: hidden; background: var(--ac-bg); color: var(--ac-fg); font-family: var(--ac-text); -webkit-font-smoothing: antialiased; }
.ac-fill { position: absolute; inset: 0; }
.ac-center { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.ac-line { font-family: var(--ac-display); font-weight: 700; letter-spacing: -0.035em; line-height: 1.04; white-space: nowrap; }
.ac-word { display: inline-block; }
.ac-accent { color: var(--ac-accent); }
.ac-grad .ac-accent { background: linear-gradient(92deg, var(--ac-accent), var(--ac-accent2)); -webkit-background-clip: text; background-clip: text; color: transparent; padding-bottom: 0.06em; }
.ac-ground-field { background: radial-gradient(60% 75% at 20% 105%, var(--ac-accent2) 0%, transparent 70%), radial-gradient(65% 80% at 85% -5%, var(--ac-accent) 0%, transparent 72%), var(--ac-field); }
.ac-ground-dark { background: radial-gradient(45% 55% at 12% 110%, var(--ac-glow1) 0%, transparent 70%), radial-gradient(40% 50% at 92% -10%, var(--ac-glow2) 0%, transparent 70%), #0b0b10; }
.ac-on-field { color: var(--ac-on-field); }
.ac-on-field .ac-accent { color: var(--ac-on-field); }
.ac-grad .ac-on-field .ac-accent { background: linear-gradient(92deg, var(--ac-on-field), color-mix(in srgb, var(--ac-on-field) 70%, transparent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.ac-on-dark { color: #fff; }
.ac-on-dark .ac-accent { color: var(--ac-accent-dark); }
.ac-grain { opacity: 0.07; mix-blend-mode: overlay; pointer-events: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }
.ac-ribbon { position: absolute; top: -20%; bottom: -20%; left: 25%; width: 50%; background: linear-gradient(90deg, transparent, var(--ac-accent) 30%, var(--ac-accent2) 70%, transparent); filter: blur(calc(40 * var(--ac-u))); transform: skewX(-14deg); opacity: 0; pointer-events: none; }
.ac-cursor { position: absolute; left: 0; top: 0; width: calc(54 * var(--ac-u)); height: calc(54 * var(--ac-u)); margin: calc(-6 * var(--ac-u)) 0 0 calc(-10 * var(--ac-u)); transform-origin: 20% 15%; filter: drop-shadow(0 calc(6 * var(--ac-u)) calc(10 * var(--ac-u)) rgba(0,0,0,0.3)); opacity: 0; }
.ac-cursor svg { width: 100%; height: 100%; display: block; }
.ac-ripple { position: absolute; left: 0; top: 0; width: calc(70 * var(--ac-u)); height: calc(70 * var(--ac-u)); margin: calc(-35 * var(--ac-u)) 0 0 calc(-35 * var(--ac-u)); border-radius: 50%; border: calc(4 * var(--ac-u)) solid var(--ac-accent); opacity: 0; }
.ac-chip { position: absolute; transform-origin: 0 100%; white-space: nowrap; font-family: var(--ac-text); font-weight: 600; font-size: calc(30 * var(--ac-u)); padding: calc(14 * var(--ac-u)) calc(24 * var(--ac-u)); border-radius: calc(16 * var(--ac-u)); background: var(--ac-chip); color: var(--ac-on-chip); box-shadow: 0 calc(18 * var(--ac-u)) calc(50 * var(--ac-u)) rgba(0,0,0,0.25); opacity: 0; }
.ac-chip-big { position: relative; font-size: calc(40 * var(--ac-u)); }`;
