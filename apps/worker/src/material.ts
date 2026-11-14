import {
  CaptureReport,
  EvidenceFile,
  FlowsFile,
  ProductOutputs,
  ReplayPlan,
  AssetPath,
  Timeline,
  jobPaths,
} from "@agentcast/shared";
import { evidenceOf } from "@agentcast/story";
import { audioShape } from "@agentcast/video";
import type { StageContext } from "./context.ts";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { artifactHash } from "./recovery.ts";
import type { z } from "zod";

export async function readOptional<S extends z.ZodType>(
  ctx: Pick<StageContext, "read">,
  file: string,
  schema: S,
): Promise<z.output<S> | undefined> {
  try {
    return await ctx.read(file, schema);
  } catch (error) {
    if (
      (error as { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}

async function fileHash(file: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal }))
    hash.update(chunk);
  return hash.digest("hex");
}

/** Rebuild on changed footage metadata or outputs; compatible with pre-evidence jobs. */
export async function collectEvidence(
  ctx: StageContext,
): Promise<EvidenceFile> {
  const [file, timeline, captures, outputs, replay] = await Promise.all([
    ctx.read(jobPaths.flows, FlowsFile),
    ctx.read(jobPaths.timeline("desktop"), Timeline),
    readOptional(ctx, jobPaths.captureReport, CaptureReport),
    readOptional(ctx, jobPaths.outputs, ProductOutputs),
    readOptional(ctx, jobPaths.replayPlan, ReplayPlan),
  ]);
  const footageHash = await fileHash(
    ctx.path(jobPaths.recording("desktop")),
    ctx.signal,
  );
  const outputHashes = await Promise.all(
    (outputs?.outputs ?? []).map(async (o) => ({
      file: o.file,
      hash: await fileHash(ctx.path(AssetPath.parse(o.file)), ctx.signal),
    })),
  );
  const inputHash = artifactHash({
    footageHash,
    outputHashes,
    timeline,
    flows: file.flows,
    captures,
    outputs,
    replay,
  });
  const saved = await readOptional(ctx, jobPaths.evidence, EvidenceFile);
  if (saved?.inputHash === inputHash) return saved;
  const verified: EvidenceFile["outputs"] = [];
  for (const output of outputs?.outputs ?? []) {
    const shape = await audioShape(
      ctx.path(AssetPath.parse(output.file)),
      ctx.signal,
    ).catch(() => undefined);
    ctx.signal.throwIfAborted();
    if (shape)
      verified.push({
        ...output,
        seconds: shape.seconds,
        audible: shape.audible,
      });
  }
  const evidence = evidenceOf({
    inputHash,
    flows: file.flows,
    timeline,
    ...(captures ? { captures } : {}),
    outputs: verified,
    replay,
  });
  if (!captures)
    evidence.limitations.push(
      "This older recording has no retained capture-quality report.",
    );
  return ctx.write(jobPaths.evidence, EvidenceFile, evidence);
}
