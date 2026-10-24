"use client";

import { CreativeBrief, ProductBrief, jobPaths } from "@agentcast/shared";
import { useArtifact } from "@/lib/useArtifact";

// The plan, refined by the worker once it has read the product (PRD §9.4: the creative brief's
// read-back on the job page), with what it understood the product to be.

export default function PlanCard({ jobId, versions }: { jobId: string; versions: Record<string, number> }) {
  const creative = useArtifact(jobId, jobPaths.creativeBrief, CreativeBrief, versions[jobPaths.creativeBrief]);
  const product = useArtifact(jobId, jobPaths.productBrief, ProductBrief, versions[jobPaths.productBrief]);
  if (!creative.data && !product.data) return null;

  return (
    <section data-reveal className="rounded-2xl border border-white/10 bg-[#121215]/80 p-5 space-y-4" aria-labelledby="plan-title">
      <h2 id="plan-title" className="text-sm font-medium text-white">
        The plan
      </h2>
      {creative.data && <p className="font-serif text-xl leading-snug text-white">{creative.data.summary}</p>}
      {creative.data && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-white/40">Length</dt>
            <dd className="text-white/80">~{Math.round(creative.data.targetSeconds)} s</dd>
          </div>
          <div>
            <dt className="text-white/40">Motion</dt>
            <dd className="capitalize text-white/80">{creative.data.personality}</dd>
          </div>
          <div>
            <dt className="text-white/40">For</dt>
            <dd className="text-white/80">{creative.data.audience}</dd>
          </div>
          <div>
            <dt className="text-white/40">Ends on</dt>
            <dd className="text-white/80">{creative.data.cta}</dd>
          </div>
        </dl>
      )}
      {product.data && (
        <div className="space-y-2 border-t border-white/[0.05] pt-4">
          <p className="text-sm text-white/80">
            <span className="text-white">{product.data.name}</span> — {product.data.oneLiner}
          </p>
          <ul className="space-y-1 text-xs text-white/55">
            {product.data.valueProps.map((v) => (
              <li key={v}>· {v}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
