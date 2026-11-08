"use client";

// The landing page's particles, as imperative canvas engines that React components start and stop.
// - startHero: drifting dust that parts around the pointer, plus the yellow swish under the statement
//   with a comet that runs along it and sheds sparks.
// - startFilm: particles that take the pipeline's shapes (browser, routes, film strip, timeline, frames)
//   and swoop along curved paths between them.

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = () => innerWidth <= 760;
const ratio = () => Math.min(devicePixelRatio || 1, 2);

type Dot = { x: number; y: number; z: number; y2: boolean };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; s: number };

export function startHero(opts: {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  swish: SVGPathElement;
  line1: HTMLElement;
  line2: HTMLElement;
  wrap1: HTMLElement;
  wrap2: HTMLElement;
  statement: HTMLElement;
}): () => void {
  const { hero, canvas, swish } = opts;
  const ctx = canvas.getContext("2d")!;
  const RM = reduced();
  let W = 0, H = 0, dpr = ratio(), alive = true, visible = true, raf = 0;
  const dots: Dot[] = [];
  const sparks: Spark[] = [];
  const mouse = { x: 0.5, y: 0.5, px: -999, py: -999 };
  let len = 0;
  const comet = { p: -1, t0: 0, dur: 1600 };
  let lastComet = 0;

  function size() {
    const r = hero.getBoundingClientRect();
    W = r.width; H = r.height; dpr = ratio();
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = phone() ? 220 : 520;
    dots.length = 0;
    for (let i = 0; i < n; i++) dots.push({ x: Math.random() * W, y: Math.random() * H, z: rand(0.25, 1), y2: Math.random() < 0.07 });
  }

  function buildSwish() {
    const hr = hero.getBoundingClientRect();
    const a = opts.line1.getBoundingClientRect(), b = opts.line2.getBoundingClientRect();
    const w1 = opts.wrap1.getBoundingClientRect(), w2 = opts.wrap2.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(opts.statement).fontSize);
    const r1 = { l: a.left - hr.left, b: w1.bottom - hr.top - fs * 0.08 };
    const r2 = { l: b.left - hr.left, r: b.right - hr.left, b: w2.bottom - hr.top - fs * 0.08 };
    const base = r2.b - fs * 0.06;
    let d: string;
    if (phone() || r2.l - r1.l < fs * 0.5) {
      d = `M ${r2.l} ${base + fs * 0.06} C ${r2.l + (r2.r - r2.l) * 0.3} ${base + fs * 0.16}, ${r2.l + (r2.r - r2.l) * 0.65} ${base - fs * 0.02}, ${r2.r + fs * 0.05} ${base - fs * 0.18}`;
    } else {
      const px = Math.max(r1.l + fs * 0.1, r2.l - fs * 0.32);
      d = `M ${r1.l + fs * 0.04} ${r1.b + fs * 0.02}`
        + ` C ${r1.l + fs * 0.5} ${r1.b + fs * 0.06}, ${px + fs * 0.12} ${r1.b + fs * 0.1}, ${px} ${(r1.b + base) / 2 + fs * 0.08}`
        + ` S ${r2.l - fs * 0.05} ${base + fs * 0.2}, ${r2.l + fs * 0.4} ${base + fs * 0.12}`
        + ` C ${r2.l + (r2.r - r2.l) * 0.45} ${base + fs * 0.06}, ${r2.r - fs * 0.7} ${base + fs * 0.16}, ${r2.r - fs * 0.25} ${base + fs * 0.12}`
        + ` S ${r2.r + fs * 0.12} ${base + fs * 0.02}, ${r2.r + fs * 0.1} ${base - fs * 0.45}`;
    }
    swish.setAttribute("d", d);
    swish.style.strokeWidth = `${Math.max(6, fs * 0.045)}px`;
    len = swish.getTotalLength();
    swish.style.strokeDasharray = `${len}`;
  }

  function draw(first: boolean) {
    if (RM) { swish.style.strokeDashoffset = "0"; return; }
    swish.style.transition = "none";
    swish.style.strokeDashoffset = `${len}`;
    swish.getBoundingClientRect();
    swish.style.transition = `stroke-dashoffset ${comet.dur}ms cubic-bezier(.65,0,.35,1)`;
    swish.style.strokeDashoffset = "0";
    comet.p = 0; comet.t0 = performance.now();
    void first;
  }

  function frame(now: number) {
    if (!alive) return;
    if (visible) {
      ctx.clearRect(0, 0, W, H);
      const t = now * 0.00025, ox = (mouse.x - 0.5) * 30, oy = (mouse.y - 0.5) * 20;
      for (const p of dots) {
        if (!RM) {
          const ang = Math.sin(p.x * 0.0021 + t) * Math.cos(p.y * 0.0027 - t * 0.8) * Math.PI * 2;
          p.x += Math.cos(ang) * 0.35 * p.z; p.y += Math.sin(ang) * 0.35 * p.z - 0.05 * p.z;
          if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10; if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
        }
        let x = p.x + ox * p.z, y = p.y + oy * p.z;
        const dx = x - mouse.px, dy = y - mouse.py, dd = dx * dx + dy * dy;
        if (dd < 12000) { const f = (1 - dd / 12000) * 26, m = Math.sqrt(dd) || 1; x += (dx / m) * f; y += (dy / m) * f; }
        ctx.globalAlpha = 0.18 + 0.55 * p.z;
        ctx.fillStyle = p.y2 ? "#f7dd47" : "#ffffff";
        const s = 0.8 + p.z * 1.6;
        ctx.fillRect(x, y, s, s);
      }
      if (comet.p >= 0 && len) {
        const k = Math.min(1, (now - comet.t0) / comet.dur);
        const pt = swish.getPointAtLength(easeIO(k) * len);
        for (let i = 0; i < 3; i++) sparks.push({ x: pt.x, y: pt.y, vx: rand(-1.2, 1.2), vy: rand(-1.6, 0.6), life: 1, s: rand(1, 3) });
        ctx.globalAlpha = 1; ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.fill();
        if (k >= 1) { comet.p = -1; lastComet = now; }
      } else if (!RM && len && lastComet && now - lastComet > 7000) {
        comet.p = 0; comet.t0 = now;
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.x += s.vx; s.y += s.vy; s.vy += 0.03; s.life -= 0.018;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = s.life; ctx.fillStyle = "#f7dd47"; ctx.fillRect(s.x, s.y, s.s, s.s);
      }
      ctx.globalAlpha = 1;
    }
    if (!RM) raf = requestAnimationFrame(frame);
  }

  const onMove = (e: PointerEvent) => {
    const r = hero.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width; mouse.y = (e.clientY - r.top) / r.height;
    mouse.px = e.clientX - r.left; mouse.py = e.clientY - r.top;
  };
  const onLeave = () => { mouse.px = mouse.py = -999; };
  hero.addEventListener("pointermove", onMove);
  hero.addEventListener("pointerleave", onLeave);
  const io = new IntersectionObserver((e) => { visible = Boolean(e[0]?.isIntersecting); });
  io.observe(hero);
  let resizeT: ReturnType<typeof setTimeout>;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { size(); buildSwish(); swish.style.strokeDashoffset = "0"; }, 200); };
  addEventListener("resize", onResize);

  let drawT: ReturnType<typeof setTimeout>;
  const ready = document.fonts?.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  void ready.then(() => {
    if (!alive) return;
    size(); buildSwish();
    swish.style.strokeDashoffset = `${len}`;
    drawT = setTimeout(() => draw(true), RM ? 0 : 1050);
    raf = requestAnimationFrame(frame);
  });

  return () => {
    alive = false;
    cancelAnimationFrame(raf); clearTimeout(drawT); clearTimeout(resizeT);
    io.disconnect();
    hero.removeEventListener("pointermove", onMove);
    hero.removeEventListener("pointerleave", onLeave);
    removeEventListener("resize", onResize);
  };
}

/* ───────── The film: particles that take the pipeline's shapes ───────── */

type Shape = (c: CanvasRenderingContext2D, w: number, h: number) => void;

const shapeUnderstand: Shape = (c, w, h) => {
  const bw = Math.min(w * 0.82, h * 1.25), bh = bw * 0.66, x = (w - bw) / 2, y = (h - bh) / 2;
  c.strokeStyle = "#fff"; c.lineWidth = 5; c.strokeRect(x, y, bw, bh);
  c.fillStyle = "#fff"; c.fillRect(x, y + bh * 0.1, bw, 4);
  c.fillStyle = "#ff0"; [0, 1, 2].forEach((i) => { c.beginPath(); c.arc(x + 18 + i * 18, y + bh * 0.05, 5, 0, 7); c.fill(); });
  c.fillStyle = "#fff"; c.fillRect(x + bw * 0.08, y + bh * 0.24, bw * 0.5, bh * 0.09); c.fillRect(x + bw * 0.08, y + bh * 0.37, bw * 0.36, bh * 0.09);
  for (let i = 0; i < 3; i++) c.fillRect(x + bw * 0.08, y + bh * (0.54 + i * 0.07), bw * (0.42 - i * 0.06), 4);
  c.fillStyle = "#0f0"; c.fillRect(x + bw * 0.08, y + bh * 0.78, bw * 0.18, bh * 0.08);
  c.strokeStyle = "#fff"; c.lineWidth = 3; c.strokeRect(x + bw * 0.62, y + bh * 0.24, bw * 0.3, bh * 0.62);
  c.beginPath(); c.moveTo(x + bw * 0.62, y + bh * 0.86); c.lineTo(x + bw * 0.74, y + bh * 0.6); c.lineTo(x + bw * 0.82, y + bh * 0.72); c.lineTo(x + bw * 0.92, y + bh * 0.5); c.stroke();
};
const shapeExplore: Shape = (c, w, h) => {
  const ox = w * 0.1, oy = h * 0.5;
  const ends: [number, number][] = [[w * 0.88, h * 0.18], [w * 0.9, h * 0.5], [w * 0.86, h * 0.82]];
  c.lineWidth = 4; c.strokeStyle = "#fff";
  ends.forEach(([ex, ey], i) => {
    c.beginPath(); c.moveTo(ox, oy);
    c.bezierCurveTo(w * 0.38, oy + (i - 1) * h * 0.05, w * 0.5, ey, ex, ey); c.stroke();
    for (let k = 1; k < 4; k++) {
      const t = k / 4, mt = 1 - t;
      const bx = mt ** 3 * ox + 3 * mt * mt * t * w * 0.38 + 3 * mt * t * t * w * 0.5 + t ** 3 * ex;
      const by = mt ** 3 * oy + 3 * mt * mt * t * (oy + (i - 1) * h * 0.05) + 3 * mt * t * t * ey + t ** 3 * ey;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(bx, by, 9, 0, 7); c.fill();
    }
    c.fillStyle = "#ff0"; c.beginPath(); c.arc(ex, ey, 22, 0, 7); c.fill();
  });
  c.fillStyle = "#0f0"; c.beginPath(); c.arc(ox, oy, 26, 0, 7); c.fill();
};
const shapeRecord: Shape = (c, w, h) => {
  c.save(); c.translate(w / 2, h / 2); c.rotate(-0.08);
  const sw = w * 0.95, sh = Math.min(h * 0.46, sw * 0.3);
  c.fillStyle = "#fff"; c.fillRect(-sw / 2, -sh / 2, sw, sh);
  c.globalCompositeOperation = "destination-out";
  const n = 14, hs = sh * 0.09;
  for (let i = 0; i < n; i++) { const x = -sw / 2 + (i + 0.5) * (sw / n) - hs / 2; c.fillRect(x, -sh / 2 + hs * 0.6, hs, hs); c.fillRect(x, sh / 2 - hs * 1.6, hs, hs); }
  const fw = sw / 4;
  for (let i = 0; i < 4; i++) c.fillRect(-sw / 2 + i * fw + 8, -sh / 2 + hs * 2.4, fw - 16, sh - hs * 4.8);
  c.globalCompositeOperation = "source-over";
  c.fillStyle = "#ff0";
  for (let i = 0; i < 4; i++) {
    const cx = -sw / 2 + i * fw + fw / 2, s = sh * 0.14;
    c.beginPath(); c.moveTo(cx - s * 0.6, -s); c.lineTo(cx + s, 0); c.lineTo(cx - s * 0.6, s); c.fill();
  }
  c.restore();
};
const shapeDirect: Shape = (c, w, h) => {
  const x0 = w * 0.06, x1 = w * 0.94, tw = x1 - x0;
  const tracks: [number, number, string][][] = [
    [[0, 0.14, "y"], [0.16, 0.38, "w"], [0.4, 0.7, "w"], [0.72, 0.9, "w"], [0.92, 1, "y"]],
    [[0.1, 0.3, "w"], [0.45, 0.62, "w"], [0.75, 0.86, "w"]],
  ];
  tracks.forEach((tr, ti) => tr.forEach(([a, b, col]) => { c.fillStyle = col === "y" ? "#ff0" : "#fff"; c.fillRect(x0 + a * tw, h * (0.22 + ti * 0.17), (b - a) * tw - 6, h * 0.11); }));
  c.fillStyle = "#fff";
  for (let i = 0; i < 90; i++) { const v = Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11)) * 0.12 + 0.015; c.fillRect(x0 + (i / 90) * tw, h * 0.7 - (v * h) / 2, tw / 90 - 3, v * h); }
  c.fillStyle = "#0f0"; c.fillRect(x0 + tw * 0.57, h * 0.12, 6, h * 0.76);
  c.beginPath(); c.moveTo(x0 + tw * 0.57 - 14, h * 0.1); c.lineTo(x0 + tw * 0.57 + 20, h * 0.1); c.lineTo(x0 + tw * 0.57 + 3, h * 0.15); c.fill();
};
const shapeRender: Shape = (c, w, h) => {
  const H = Math.min(h * 0.7, w * 0.42), wide = ((H * 16) / 9) * 0.82, tall = ((H * 9) / 16) * 1.25;
  const gap = w * 0.06, total = wide + tall + gap, x = (w - total) / 2, y = (h - H) / 2;
  const tri = (cx: number, cy: number, s: number) => { c.beginPath(); c.moveTo(cx - s * 0.6, cy - s); c.lineTo(cx + s, cy); c.lineTo(cx - s * 0.6, cy + s); c.fill(); };
  c.strokeStyle = "#fff"; c.lineWidth = 5;
  const wh = (wide * 9) / 16; c.strokeRect(x, y + (H - wh) / 2, wide, wh);
  const th = Math.min(H, (tall * 16) / 9); c.strokeRect(x + wide + gap, y + (H - th) / 2, tall, th);
  c.fillStyle = "#ff0"; tri(x + wide / 2, y + H / 2, wh * 0.16); tri(x + wide + gap + tall / 2, y + H / 2, tall * 0.2);
  c.fillStyle = "#fff";
  for (let i = 0; i < 3; i++) c.fillRect(x + wide * (0.2 + i * 0.2), y + (H + wh) / 2 - wh * 0.14, wide * 0.15, 5);
  c.fillStyle = "#0f0"; c.fillRect(x + wide * 0.4, y + (H + wh) / 2 - wh * 0.14, wide * 0.15, 5);
};
const SHAPES: Shape[] = [shapeUnderstand, shapeExplore, shapeRecord, shapeDirect, shapeRender];

type Pt = { x: number; y: number; c: "w" | "y" | "g" };
type P = Pt & { fx: number; fy: number; cx: number; cy: number; tx: number; ty: number; dl: number; ph: number; ox: number; oy: number };
const COLORS = { w: "#ffffff", y: "#f7dd47", g: "#1fc27a" } as const;

/** Starts the film. Returns `show(i)` to move to a chapter, and `stop()`. */
export function startFilm(section: HTMLElement, canvas: HTMLCanvasElement): { show: (i: number) => void; stop: () => void } {
  const ctx = canvas.getContext("2d")!;
  const RM = reduced();
  let W = 0, H = 0, dpr = ratio(), chapter = 0, visible = false, alive = true, raf = 0, morphStart = 0;
  let P: P[] = [], T: Pt[][] = [];
  const pointer = { x: -999, y: -999 };
  const MORPH = 1300;

  function sample(fn: Shape, n: number): Pt[] {
    const oc = document.createElement("canvas"); oc.width = W; oc.height = H;
    const c = oc.getContext("2d")!; fn(c, W, H);
    const data = c.getImageData(0, 0, W, H).data, pts: Pt[] = [];
    const step = Math.max(2, Math.round(Math.sqrt((W * H) / (n * 9))));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3]! > 128) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        pts.push({ x: x + rand(-1, 1), y: y + rand(-1, 1), c: r > 200 && g > 200 && b > 200 ? "w" : r > 200 && g > 200 ? "y" : "g" });
      }
    }
    for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j]!, pts[i]!]; }
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i % Math.max(1, pts.length)] ?? { x: W / 2, y: H / 2, c: "w" as const };
      out.push(i < pts.length ? p : { x: p.x + rand(-2, 2), y: p.y + rand(-2, 2), c: p.c });
    }
    return out;
  }
  function retarget(i: number, instant = false) {
    const tg = T[i]!; morphStart = performance.now();
    P.forEach((p, k) => {
      const t = tg[k]!;
      p.fx = p.x; p.fy = p.y; p.tx = t.x; p.ty = t.y; p.c = t.c;
      const mx = (p.fx + p.tx) / 2, my = (p.fy + p.ty) / 2, dx = p.tx - p.fx, dy = p.ty - p.fy, bend = rand(-0.9, 0.9);
      p.cx = mx - dy * bend + rand(-30, 30); p.cy = my + dx * bend + rand(-30, 30);
      p.dl = (t.x / W) * 380 + rand(0, 260);
      if (instant || RM) { p.x = p.tx; p.y = p.ty; p.dl = -1; }
    });
  }
  function size() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(10, Math.round(r.width)); H = Math.max(10, Math.round(r.height)); dpr = ratio();
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = phone() ? 1100 : 2400;
    T = SHAPES.map((s) => sample(s, n));
    if (P.length !== n) P = T[chapter]!.map((t) => ({ ...t, x: rand(0, W), y: rand(0, H), fx: 0, fy: 0, cx: 0, cy: 0, tx: t.x, ty: t.y, dl: 0, ph: rand(0, 6.28), ox: 0, oy: 0 }));
    retarget(chapter, true);
    if (RM) requestAnimationFrame(frame);
  }
  function frame(now: number) {
    if (!alive) return;
    if (visible || RM) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = RM ? "#05060f" : "rgba(5,6,15,0.3)";
      ctx.fillRect(0, 0, W, H);
      const groups: Record<Pt["c"], P[]> = { w: [], y: [], g: [] };
      for (const p of P) {
        if (p.dl >= 0) {
          const k = Math.min(1, Math.max(0, (now - morphStart - p.dl) / MORPH)), e = easeIO(k), m = 1 - e;
          p.x = m * m * p.fx + 2 * m * e * p.cx + e * e * p.tx;
          p.y = m * m * p.fy + 2 * m * e * p.cy + e * e * p.ty;
          if (k >= 1) p.dl = -1;
        } else if (!RM) {
          p.x = p.tx + Math.sin(now * 0.0013 + p.ph) * 0.9; p.y = p.ty + Math.cos(now * 0.0011 + p.ph) * 0.9;
        }
        const dx = p.x - pointer.x, dy = p.y - pointer.y, dd = dx * dx + dy * dy;
        let tx = 0, ty = 0;
        if (dd < 6400) { const f = (1 - dd / 6400) * 34, m = Math.sqrt(dd) || 1; tx = (dx / m) * f; ty = (dy / m) * f; }
        p.ox += (tx - p.ox) * 0.15; p.oy += (ty - p.oy) * 0.15;
        groups[p.c].push(p);
      }
      for (const c of ["w", "y", "g"] as const) {
        ctx.fillStyle = COLORS[c]; const s = c === "w" ? 1.7 : 2.3;
        ctx.globalAlpha = c === "w" ? 0.85 : 1;
        for (const p of groups[c]) ctx.fillRect(p.x + p.ox, p.y + p.oy, s, s);
      }
    }
    if (!RM) raf = requestAnimationFrame(frame);
  }
  const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; };
  const onLeave = () => { pointer.x = pointer.y = -999; };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  const io = new IntersectionObserver((e) => { visible = Boolean(e[0]?.isIntersecting); });
  io.observe(section);
  let resizeT: ReturnType<typeof setTimeout>;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(size, 200); };
  addEventListener("resize", onResize);
  size();
  raf = requestAnimationFrame(frame);

  return {
    show(i: number) {
      if (i === chapter || !T[i]) return;
      chapter = i; retarget(i);
      if (RM) requestAnimationFrame(frame);
    },
    stop() {
      alive = false; cancelAnimationFrame(raf); clearTimeout(resizeT); io.disconnect();
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave);
      removeEventListener("resize", onResize);
    },
  };
}
