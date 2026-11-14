import { createHash } from "node:crypto";
import { RecoveryJournal, RecoveryRequest, jobPaths } from "@agentcast/shared";
import type { StageContext } from "./context.ts";

export const artifactHash = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const locks = new Map<string, Promise<unknown>>();

/** Only the orchestrator may rewind stages; stages never invoke each other recursively. */
export class PipelineRepair extends Error {
  constructor(
    readonly target: "record" | "direct",
    message: string,
  ) {
    super(message);
    this.name = "PipelineRepair";
  }
}

/** Serialize repairs per job and checkpoint before side effects. A restarted handler must be idempotent. */
export async function recover(
  ctx: StageContext,
  request: RecoveryRequest,
  input: unknown,
  run: (id: string) => Promise<string>,
  limit = 2,
): Promise<boolean> {
  const previous = locks.get(ctx.dir) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      ctx.signal.throwIfAborted();
      let journal: RecoveryJournal;
      try {
        journal = await ctx.read(jobPaths.recovery, RecoveryJournal);
      } catch (error) {
        if (
          (error as { cause?: NodeJS.ErrnoException }).cause?.code !==
            "ENOENT" &&
          (error as NodeJS.ErrnoException).code !== "ENOENT"
        )
          throw error;
        journal = { schemaVersion: 1, attempts: [] };
      }
      const parsed = RecoveryRequest.parse(request);
      const inputHash = artifactHash(input),
        id = artifactHash({ request: parsed, inputHash }).slice(0, 20);
      let attempt = journal.attempts.find((a) => a.id === id);
      if (attempt?.status === "done") return true;
      if (attempt?.status === "failed") return false;
      if (!attempt) {
        if (
          journal.attempts.filter((a) => a.request.kind === parsed.kind)
            .length >= limit
        )
          return false;
        attempt = { id, inputHash, request: parsed, status: "started" };
        journal.attempts.push(attempt);
        await ctx.write(jobPaths.recovery, RecoveryJournal, journal);
      }
      ctx.log(parsed.reason);
      try {
        const result = await run(id);
        ctx.signal.throwIfAborted();
        attempt.status = "done";
        attempt.result = result.slice(0, 1000);
        await ctx.write(jobPaths.recovery, RecoveryJournal, journal);
        return true;
      } catch (error) {
        ctx.signal.throwIfAborted();
        attempt.status = "failed";
        // Do not persist provider errors which can contain URLs or page text.
        attempt.result =
          "Recovery did not complete; the previous valid artifacts remain available.";
        await ctx.write(jobPaths.recovery, RecoveryJournal, journal);
        return false;
      }
    });
  locks.set(ctx.dir, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(ctx.dir) === operation) locks.delete(ctx.dir);
  }
}
