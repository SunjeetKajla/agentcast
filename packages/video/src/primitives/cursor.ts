// The hand cursor (docs/BRAND_MOTION_PLAN.md §6): our own drawings of an arrow and a pointing hand. It glides on
// a curve to each recorded click, turns into the hand over the target, and presses with a ring rippling out.
// Only recorded clicks are used: a cursor never goes somewhere the recording didn't.

/** Shapes of the hand: a dark outline layer under a white fill layer, so overlapping shapes read as one. */
const HAND_SHAPES = [
  `<rect x="13" y="2" width="8" height="25" rx="4"/>`,
  `<rect x="20.5" y="13.5" width="7.5" height="15" rx="3.75"/>`,
  `<rect x="27.5" y="15.5" width="7" height="14" rx="3.5"/>`,
  `<rect x="33.5" y="18.5" width="6" height="12" rx="3"/>`,
  `<rect x="11" y="20" width="28.5" height="21" rx="9"/>`,
  `<rect x="3" y="22" width="13" height="7" rx="3.5" transform="rotate(38 9.5 25.5)"/>`,
].join("");
const HAND = `<svg viewBox="-2 -2 46 48" style="width: calc(64 * var(--ac-u)); height: calc(68 * var(--ac-u));"><g fill="#121314" stroke="#121314" stroke-width="3.4" stroke-linejoin="round">${HAND_SHAPES}</g><g fill="#fff">${HAND_SHAPES}</g><path d="M21 20.5v5M27.5 22v4.5M33.8 24v3.6" stroke="#121314" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/></svg>`;
const ARROW = `<svg viewBox="0 0 28 38" style="width: calc(42 * var(--ac-u)); height: calc(57 * var(--ac-u));"><path d="M3 3 L3 31 L10 24.4 L15 35 L19.6 33 L14.8 22.6 L24.4 22.6 Z" fill="#fff" stroke="#121314" stroke-width="2.2" stroke-linejoin="round"/></svg>`;

/** The cursor's CSS, scoped to a scene (`#S-` is the scene's id prefix). */
export const CURSOR_CSS = `#S-cur { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; z-index: 50; }
#S-cur .arrow { position: absolute; left: calc(-4 * var(--ac-u)); top: calc(-4 * var(--ac-u)); filter: drop-shadow(0 calc(6 * var(--ac-u)) calc(10 * var(--ac-u)) rgba(0,0,0,0.45)); }
#S-cur .hand { position: absolute; left: calc(-24 * var(--ac-u)); top: calc(-3 * var(--ac-u)); opacity: 0; transform-origin: calc(24 * var(--ac-u)) calc(4 * var(--ac-u)); filter: drop-shadow(0 calc(8 * var(--ac-u)) calc(12 * var(--ac-u)) rgba(0,0,0,0.45)); }
#S-cur .ring { position: absolute; left: calc(-36 * var(--ac-u)); top: calc(-36 * var(--ac-u)); width: calc(72 * var(--ac-u)); height: calc(72 * var(--ac-u)); border-radius: 50%; border: calc(3 * var(--ac-u)) solid rgba(255,255,255,0.85); box-shadow: 0 0 0 1px rgba(0,0,0,0.15); opacity: 0; }`;

export const CURSOR_HTML = `<div id="S-cur"><div class="arrow">${ARROW}</div><div class="hand">${HAND}</div><div class="ring"></div></div>`;

/** A press: where (in the element the cursor lives in) and when (seconds into the scene). */
export type Press = { x: number; y: number; at: number };

/** When a glide to a press starts, and how long it takes. */
const GLIDE = 0.5;

/**
 * The cursor's timeline, as scene script (`S`, `tl` in scope): it comes in from below right before the first
 * press, glides to each, turns into the hand just before it and presses on it, then fades.
 */
export function cursorScript(presses: Press[], dur: number): string {
  if (!presses.length) return "";
  const first = presses[0]!;
  const lines = [
    `var cur = S.el("cur"), hand = cur.querySelector(".hand"), arrow = cur.querySelector(".arrow"), ring = cur.querySelector(".ring"), u = AC.u();`,
    `tl.set(cur, { x: ${first.x.toFixed(1)} + 260 * u, y: ${first.y.toFixed(1)} + 300 * u }, 0);`,
    `tl.to(cur, { opacity: 1, duration: 0.2 }, ${Math.max(0, first.at - GLIDE - 0.3).toFixed(3)});`,
  ];
  presses.forEach((p, i) => {
    const start = Math.max(0, p.at - GLIDE - (i ? 0 : 0.1));
    lines.push(
      `tl.to(cur, { x: ${p.x.toFixed(1)}, duration: ${GLIDE}, ease: "power2.inOut" }, ${start.toFixed(3)});`,
      `tl.to(cur, { y: ${p.y.toFixed(1)}, duration: ${GLIDE}, ease: "power3.inOut" }, ${start.toFixed(3)});`,
      `tl.to(arrow, { opacity: 0, duration: 0.08 }, ${(p.at - 0.2).toFixed(3)});`,
      `tl.to(hand, { opacity: 1, duration: 0.08 }, ${(p.at - 0.2).toFixed(3)});`,
      `tl.to(hand, { scale: 0.88, duration: 0.08, ease: "power2.out" }, ${(p.at - 0.08).toFixed(3)});`,
      `tl.to(hand, { scale: 1, duration: 0.22, ease: "back.out(3)" }, ${p.at.toFixed(3)});`,
      `tl.fromTo(ring, { scale: 0.3, opacity: 0.9 }, { scale: 1.25, opacity: 0, duration: 0.45, ease: "expo.out" }, ${p.at.toFixed(3)});`,
    );
  });
  const last = presses.at(-1)!;
  lines.push(`tl.to(cur, { opacity: 0, duration: 0.25 }, ${Math.min(dur - 0.25, last.at + 0.6).toFixed(3)});`);
  return lines.join("\n  ");
}

/**
 * The presses a move can show: recorded clicks inside its stretch of footage, in its own time, inside the
 * region it shows, at least half a second in and clear of the end. Positions are in the region's pixels.
 */
export function pressesIn(o: { clicks: { t: number; box: [number, number, number, number] }[]; from: number; to: number; speed: number; dur: number; frame: [number, number, number, number]; scale: number }): Press[] {
  const out: Press[] = [];
  for (const c of o.clicks) {
    if (c.t < o.from || c.t > o.to) continue;
    const at = (c.t - o.from) / o.speed;
    const cx = c.box[0] + c.box[2] / 2;
    const cy = c.box[1] + c.box[3] / 2;
    if (at < 0.6 || at > o.dur - 0.3) continue;
    if (cx < o.frame[0] || cx > o.frame[0] + o.frame[2] || cy < o.frame[1] || cy > o.frame[1] + o.frame[3]) continue;
    if (out.length && at - out.at(-1)!.at < 0.7) continue;
    out.push({ x: (cx - o.frame[0]) * o.scale, y: (cy - o.frame[1]) * o.scale, at: Math.round(at * 1000) / 1000 });
  }
  return out;
}
