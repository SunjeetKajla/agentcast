import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { RecoveryJournal, jobPaths } from "@agentcast/shared";
import type { StageContext } from "./context";
import { recover } from "./recovery";
let ctx: StageContext;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-recovery-"));
  const io: Pick<StageContext, "read" | "write"> = {
    read: (f, s) => readArtifact(join(dir, f), s),
    write: (f, s, d) => writeArtifact(join(dir, f), s, d),
  };
  ctx = {
    ...io,
    dir,
    signal: new AbortController().signal,
    log: vi.fn(),
  } as unknown as StageContext;
});
afterEach(async () => {
  await rm(ctx.dir, { recursive: true, force: true });
});
it("serializes same-job requests and checkpoints before invoking effects, reusing completed work", async () => {
  const work = vi.fn(async () => {
    const journal = await ctx.read(jobPaths.recovery, RecoveryJournal);
    expect(journal.attempts[0]!.status).toBe("started");
    return "done";
  });
  const request = { kind: "edit" as const, reason: "Reframe" };
  await Promise.all([
    recover(ctx, request, { version: 1 }, work),
    recover(ctx, request, { version: 1 }, work),
  ]);
  expect(work).toHaveBeenCalledTimes(1);
  await recover(ctx, request, { version: 2 }, work);
  expect(await recover(ctx, request, { version: 3 }, work)).toBe(false);
  expect(work).toHaveBeenCalledTimes(2);
});
it("leaves cancelled work resumable and does not count a failed attempt as success", async () => {
  const request = { kind: "capture" as const, reason: "Recapture" };
  const controller = new AbortController();
  const cancelled = { ...ctx, signal: controller.signal };
  await expect(
    recover(cancelled, request, "input", async () => {
      controller.abort(new Error("cancelled"));
      throw new Error("provider secret");
    }),
  ).rejects.toThrow("cancelled");
  expect(
    (await ctx.read(jobPaths.recovery, RecoveryJournal)).attempts[0]!.status,
  ).toBe("started");
  expect(await recover(ctx, request, "input", async () => "resumed")).toBe(
    true,
  );
  expect(
    await recover(ctx, request, "different", async () => {
      throw new Error("private");
    }),
  ).toBe(false);
  const journal = await ctx.read(jobPaths.recovery, RecoveryJournal);
  expect(JSON.stringify(journal)).not.toContain("private");
});
