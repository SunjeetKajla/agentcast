"use client";

import { useEffect, useRef, useState } from "react";
import type { Job } from "@agentcast/shared";
import { finished, mmss, timeline, took } from "@/lib/job-model";

// The run as an edit timeline: every stage a clip at its real start and length, gates edged in yellow,
// what's still to come as dashed slots at their usual length, and a green playhead at now.

export default function RunTimeline({ job, now }: { job: Job; now: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { clips, total, now: at } = timeline(job, now);
  const over = finished(job);
  const twoLanes = clips.some((c) => c.lane === 1);
  const step = [15, 30, 60, 120, 300, 600, 1200].find((s) => (s / total) * width >= 56) ?? 1800;
  const ticks: number[] = [];
  for (let t = 0; t <= total - step * 0.4; t += step) ticks.push(t);

  return (
    <section className="blk" aria-labelledby="run-h">
      <div className="blk-h">
        <h2 id="run-h">The run</h2>
        <span>{over ? `${mmss(at)} start to finish` : `${mmss(at)} so far · about ${mmss(total)} in all`}</span>
      </div>
      <div className="tl">
        <div className="tl-ruler" aria-hidden="true">
          {ticks.map((t) => <span key={t} style={{ left: `${(t / total) * 100}%` }}>{mmss(t)}</span>)}
        </div>
        <div ref={track} className={`tl-track ${twoLanes ? "two" : ""}`}>
          {clips.map((c) => {
            const w = ((c.b - c.a) / total) * 100;
            const px = (w / 100) * width;
            const zero = c.b - c.a < 0.5;
            const state = zero && !c.estimated ? "skipped" : c.status === "cancelled" ? "done" : c.status;
            const label = c.estimated ? `about ${took(c.b - c.a)}` : c.status === "skipped" ? "skipped" : took(c.b - c.a);
            return (
              <div
                key={c.stage}
                className={`clip ${state} ${c.gate ? "gate" : ""} ${px < 44 ? "narrow" : ""} lane-${c.lane}`}
                style={{ left: `${(c.a / total) * 100}%`, width: `calc(${w}% - 2px)` }}
                title={`${c.label}: ${label}`}
              >
                <b>{c.label}</b>
                <span>{label}</span>
              </div>
            );
          })}
          {!over && <div className="playhead" style={{ left: `${(at / total) * 100}%` }} aria-hidden="true" />}
        </div>
      </div>
      <p className="tl-key">
        <span><i className="k-done" />Done</span>
        <span><i className="k-run" />Working</span>
        <span><i className="k-gate" />Review gate</span>
        <span><i className="k-wait" />Waiting on you</span>
        <span><i className="k-fail" />Failed</span>
        <span><i className="k-next" />Still to come, estimated</span>
        {!over && <span><i className="k-now" />Now</span>}
      </p>
    </section>
  );
}
