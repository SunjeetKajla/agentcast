"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { gsap } from "@/lib/motion";
import type { FieldState } from "@/lib/job-model";

// The field: the job's status as one large colour (blue while AgentCast works, yellow when it needs
// you, white when the videos are ready, pink when something failed), with the stage named large.
// A change of state sweeps the new colour across; a new stage name rises out of its line.

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Field({
  state,
  title,
  lead,
  clock,
  sub,
  children,
  labelId = "air-h",
}: {
  state: FieldState;
  title: string;
  lead: string;
  clock?: string;
  sub?: string;
  children?: ReactNode;
  labelId?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLSpanElement>(null);
  const shown = useRef<FieldState>(state);
  const dust = useRef<HTMLCanvasElement>(null);

  // Sweep the new colour in from the left, then settle on it.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || shown.current === state) return;
    const from = shown.current;
    shown.current = state;
    if (reduced()) return;
    const sweep = document.createElement("div");
    sweep.className = "air-sweep";
    sweep.dataset.state = state;
    el.prepend(sweep);
    el.dataset.state = from;
    gsap.fromTo(sweep, { scaleX: 0 }, {
      scaleX: 1, duration: 0.75, ease: "expo.inOut",
      onComplete: () => { el.dataset.state = state; sweep.remove(); },
    });
    return () => { sweep.remove(); el.dataset.state = state; };
  }, [state]);

  useEffect(() => {
    if (!heading.current || reduced()) return;
    gsap.fromTo(heading.current, { yPercent: 105 }, { yPercent: 0, duration: 0.9, ease: "expo.out" });
  }, [title]);

  // A little of the hero's dust, in the field's own ink.
  useEffect(() => {
    const c = dust.current;
    if (!c) return;
    const RM = reduced();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let dots: { x: number; y: number; z: number }[] = [];
    let raf = 0, alive = true, visible = true;
    const io = new IntersectionObserver((e) => { visible = Boolean(e[0]?.isIntersecting); });
    io.observe(c);
    const frame = (now: number) => {
      if (!alive) return;
      const r = c.getBoundingClientRect();
      if (visible && r.width > 0) {
        if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
          c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
          dots = Array.from({ length: Math.round((r.width * r.height) / 9000) }, () => ({ x: Math.random() * r.width, y: Math.random() * r.height, z: 0.3 + Math.random() * 0.7 }));
        }
        const x = c.getContext("2d")!;
        x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.height);
        const s = root.current?.dataset.state;
        x.fillStyle = s === "wait" || s === "fail" ? "#05060f" : s === "done" ? "#1423b8" : "#ffffff";
        const t = now * 0.0002;
        for (const p of dots) {
          if (!RM) { const a = Math.sin(p.x * 0.004 + t) * Math.cos(p.y * 0.005 - t) * 6.28; p.x += Math.cos(a) * 0.25 * p.z; p.y += Math.sin(a) * 0.25 * p.z; }
          if (p.x < 0) p.x = r.width; if (p.x > r.width) p.x = 0; if (p.y < 0) p.y = r.height; if (p.y > r.height) p.y = 0;
          x.globalAlpha = 0.12 + 0.3 * p.z; const sz = 0.8 + p.z * 1.4; x.fillRect(p.x, p.y, sz, sz);
        }
      }
      if (!RM) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); io.disconnect(); };
  }, []);

  return (
    <section ref={root} className="air" data-state={state} aria-labelledby={labelId}>
      <canvas ref={dust} className="air-dust" aria-hidden="true" />
      <div className="air-in">
        <div className="air-head">
          <div>
            <h2 className="air-h" id={labelId}><span ref={heading}>{title}</span></h2>
            <p className="air-lead">{lead}</p>
          </div>
          {clock && (
            <div className="air-clock">
              <b>{clock}</b>
              {sub && <span>{sub}</span>}
            </div>
          )}
        </div>
        {children && <div className="air-body">{children}</div>}
      </div>
    </section>
  );
}
