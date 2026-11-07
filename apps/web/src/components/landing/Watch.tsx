"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { mountDemo } from "@/lib/demo-job";
import { useComposer } from "./composer";

export default function Watch() {
  const frame = useRef<HTMLDivElement>(null);
  const demo = useRef<ReturnType<typeof mountDemo> | null>(null);
  const { choices } = useComposer();
  const settings = {
    hindi: choices.langs.includes("hi"),
    vertical: choices.aspects.includes("9x16"),
    music: !choices.voiceover,
    gates: !choices.autopilot,
  };
  const key = JSON.stringify(settings);

  useEffect(() => {
    demo.current = mountDemo(frame.current!, settings);
    return () => demo.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    demo.current?.update(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <section className="watch" id="watch" aria-labelledby="watch-h">
      <div className="wrap watch-head">
        <h2 className="head" id="watch-h" data-rise>Watch the agents work</h2>
        <div className="side">
          <p data-rise>
            Every job gets a live page. The stages fill in, three agents try flows side by side, and nothing is filmed until
            you approve it. This is a sample run on autopilot; yours runs on your product.
          </p>
          <Link href="/jobs" className="btn btn-ink magnet" data-rise>
            See your videos <span className="arr" aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
      <div className="wrap">
        <div className="job-frame" ref={frame} data-rise />
      </div>
    </section>
  );
}
