"use client";

import { ArtDirection, BeatSheet, jobPaths } from "@agentcast/shared";
import { useArtifact } from "@/lib/useArtifact";

// The film's plan at script review (PRD §9.7.7–9.7.8): the design art direction chose, with its reasons, and the
// beat sheet bar by bar, with any shot left out and why, so nothing approved here disappears later.

const TYPE: Record<string, string> = {
  "project-tool": "a project tool",
  "ai-prompt": "an AI prompt product",
  "voice-audio": "a voice product",
  "design-canvas": "a design tool",
  "dev-tool": "a developer tool",
  "data-analytics": "an analytics product",
  commerce: "a store",
  fintech: "a finance product",
  "consumer-app": "a consumer app",
  suite: "a suite of products",
  other: "a product",
};
const MOVE: Record<string, string> = {
  prompt: "typing close-up",
  build: "board building",
  cards: "cards rising",
  panel: "panel lifting out",
  list: "list with highlights",
  ticker: "ticker of terms",
  swap: "word swap",
  wall: "wall of the site's pages",
  "glow-pill": "glow pill",
  mockup: "laptop mockup",
  output: "the product's own output",
  orbit: "logos orbiting",
  mascot: "mascot",
};
const LOGO: Record<string, string> = { lockup: "the mark lands, then the name slides out", letters: "letter by letter", fade: "blurs in whole" };
const WORLD: Record<string, string> = { plain: "plain", bloom: "a bloom of the brand's light", field: "the brand's colours" };

export default function FilmPlan({ jobId, versions }: { jobId: string; versions: Record<string, number> }) {
  const art = useArtifact(jobId, jobPaths.artDirection, ArtDirection, versions[jobPaths.artDirection]);
  const sheet = useArtifact(jobId, jobPaths.beatSheet, BeatSheet, versions[jobPaths.beatSheet]);
  if (!art.data && !sheet.data) return null;
  const a = art.data;
  const s = sheet.data;
  return (
    <section className="sb" aria-label="The film's plan">
      <ol className="sb-list">
        {a && (
          <li className="sb-beat">
            <div className="sb-head">
              <b>The design</b>
              <span>
                For {TYPE[a.productType] ?? a.productType}, chosen by {a.by === "director" ? "the director" : "the rules"}
              </span>
            </div>
            <p className="sb-intent">
              {s ? `${s.skeletonId} structure` : a.skeletonId} · logo {LOGO[a.brand.logo] ?? a.brand.logo} · {a.brand.opener === "logo" ? "opens on the logo" : "opens on its line"} ·{" "}
              {a.brand.cursor === "hand" ? "a hand cursor on recorded clicks" : "no cursor"} · ground: {WORLD[a.brand.world] ?? a.brand.world}
            </p>
            {a.featured.length > 0 && (
              <div className="sb-head">
                {a.featured.map((m) => (
                  <q key={m} className="sb-onscreen">
                    {MOVE[m] ?? m}
                  </q>
                ))}
              </div>
            )}
            <ul className="sb-intent">
              {Object.entries(a.reasons).map(([key, why]) => (
                <li key={key}>
                  <b>{key}</b>: {why}
                </li>
              ))}
              {a.changed.map((c) => (
                <li key={c}>Changed: {c}</li>
              ))}
            </ul>
          </li>
        )}
        {s && (
          <li className="sb-beat">
            <div className="sb-head">
              <b>Beat sheet</b>
              <span>
                {s.seconds.toFixed(1)} s at {Math.round(s.bpm)} BPM
              </span>
            </div>
            <p className="sb-intent">{s.thesis}</p>
            <ol className="sb-intent">
              {s.beats.map((b) => (
                <li key={b.id}>
                  bars {b.bars[0]}
                  {b.bars[1] > b.bars[0] ? `–${b.bars[1]}` : ""} · {b.at.toFixed(1)} s · {b.move}
                  {b.copy ? ` · “${b.copy}”` : ""}
                </li>
              ))}
            </ol>
            {s.dropped.length > 0 && (
              <ul className="sb-intent">
                {s.dropped.map((d) => (
                  <li key={d.beatId}>
                    Left out: {d.title ? `“${d.title}”` : d.beatId} ({d.reason})
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ol>
    </section>
  );
}
