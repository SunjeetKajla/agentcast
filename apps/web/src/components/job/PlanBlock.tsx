"use client";

import { CreativeBrief, ProductBrief, jobPaths } from "@agentcast/shared";
import { useArtifact } from "@/lib/useArtifact";

// The plan, once the worker has read the product (PRD §9.4: the creative brief's read-back on the job
// page): what it understood the product to be, and what the video will do about it.

export default function PlanBlock({ jobId, versions }: { jobId: string; versions: Record<string, number> }) {
  const creative = useArtifact(jobId, jobPaths.creativeBrief, CreativeBrief, versions[jobPaths.creativeBrief]);
  const product = useArtifact(jobId, jobPaths.productBrief, ProductBrief, versions[jobPaths.productBrief]);
  if (!creative.data && !product.data) return null;
  const c = creative.data, p = product.data;

  return (
    <section className="blk" aria-labelledby="plan-h">
      <div className="blk-h">
        <h2 id="plan-h">The plan</h2>
        <span>{c?.inferred ? "worked out from the site" : c ? "from your prompt and the site" : "from the site"}</span>
      </div>
      <div className="plan-blk">
        <div>
          {c && <p className="plan-sum">{c.summary}</p>}
          {p && (
            <>
              <p className="plan-prod"><b>{p.name}</b>: {p.oneLiner}</p>
              {p.valueProps.length > 0 && (
                <ul className="plan-vp">
                  {p.valueProps.slice(0, 4).map((v) => <li key={v}>{v}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
        {c && (
          <dl className="facts">
            <div><dt>Length</dt><dd>about {Math.round(c.targetSeconds)} s</dd></div>
            <div><dt>For</dt><dd>{c.audience}</dd></div>
            <div><dt>Goal</dt><dd>{c.goal}</dd></div>
            <div><dt>Feel</dt><dd>{[c.personality, ...c.tone].join(", ")}</dd></div>
            {c.mustShow.length > 0 && <div><dt>Must show</dt><dd>{c.mustShow.join("; ")}</dd></div>}
            <div><dt>Ends on</dt><dd>{c.cta}</dd></div>
          </dl>
        )}
      </div>
    </section>
  );
}
