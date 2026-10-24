import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { JobConfig } from "@agentcast/shared";
import { FIXTURE_JOB_DIR } from "@agentcast/shared/node";
import type { StageContext } from "../context.ts";

// Stub stages copy their outputs from the fixture job (packages/shared/fixtures/job) so the whole
// pipeline runs before any stage is real. Delete the stub call when you make your stage real.

/** AGENTCAST_STUB_DELAY_MS (default 2000) is how long each stub pretends to work. */
export function stubDelay(): number {
  const ms = Number(process.env.AGENTCAST_STUB_DELAY_MS);
  return Number.isFinite(ms) && ms >= 0 ? ms : 2000;
}

/** Wait, then copy fixture files to the same job-relative paths and announce them. */
export async function stub(ctx: StageContext, files: string[]): Promise<void> {
  await pretend(ctx);
  for (const rel of files) await copyFixture(ctx, rel, rel);
}

export async function pretend(ctx: StageContext, fraction = 1): Promise<void> {
  await sleep(stubDelay() * fraction, undefined, { signal: ctx.signal });
}

export async function copyFixture(ctx: StageContext, from: string, to: string): Promise<void> {
  await mkdir(dirname(ctx.path(to)), { recursive: true });
  await copyFile(join(FIXTURE_JOB_DIR, from), ctx.path(to));
  ctx.artifact(to);
}

/** The fixture has EN and HI only. */
export function fixtureLangs(ctx: StageContext, config: JobConfig): string[] {
  const langs: string[] = config.variants.langs.filter((l) => l === "en" || l === "hi");
  const missing = config.variants.langs.filter((l) => !langs.includes(l));
  if (missing.length) ctx.log(`Stub: no fixture for ${missing.join(", ")}; skipped`, "warn");
  return langs;
}
