import { resolve } from "node:path";
import { ReplayEntry, ReplayPlan, type FormFactor } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";

const writes = new Map<string, Promise<unknown>>();

async function load(path: string): Promise<ReplayPlan> {
  try {
    return await readArtifact(path, ReplayPlan);
  } catch (error) {
    if (
      ((error as Error).cause as NodeJS.ErrnoException | undefined)?.code ===
      "ENOENT"
    )
      return { schemaVersion: 1, byFormFactor: {} };
    throw error;
  }
}

export function replayKey(stepId: string, flowId?: string): string {
  return flowId === undefined
    ? stepId
    : `${encodeURIComponent(flowId)}/${encodeURIComponent(stepId)}`;
}

export async function cachedLocator(
  path: string,
  formFactor: FormFactor,
  key: string,
): Promise<ReplayEntry | undefined> {
  await writes.get(resolve(path))?.catch(() => {});
  const steps = (await load(path)).byFormFactor[formFactor];
  return steps && Object.hasOwn(steps, key) ? steps[key] : undefined;
}

/** Serialize read-modify-write per path, retaining other flows, devices and learned expectations. */
export async function saveLocator(
  path: string,
  formFactor: FormFactor,
  key: string,
  entry: ReplayEntry,
  signal?: AbortSignal,
): Promise<void> {
  return saveReplayEntries(path, formFactor, { [key]: entry }, signal);
}

/** Commit learning for a complete clean take in one validated atomic update. */
export async function saveReplayEntries(
  path: string,
  formFactor: FormFactor,
  entries: Record<string, ReplayEntry>,
  signal?: AbortSignal,
): Promise<void> {
  const file = resolve(path);
  const previous = writes.get(file) ?? Promise.resolve();
  const update = previous
    .catch(() => {})
    .then(async () => {
      signal?.throwIfAborted();
      const plan = await load(file);
      const steps = plan.byFormFactor[formFactor] ?? {};
      let updated = { ...steps };
      for (const [key, entry] of Object.entries(entries)) {
        const old = Object.hasOwn(steps, key) ? steps[key] : undefined;
        // Object spread also handles __proto__ as a data key.
        updated = {
          ...updated,
          [key]: ReplayEntry.parse({ ...old, ...entry }),
        };
      }
      plan.byFormFactor[formFactor] = updated;
      signal?.throwIfAborted();
      await writeArtifact(file, ReplayPlan, plan);
    });
  writes.set(file, update);
  try {
    await update;
  } finally {
    if (writes.get(file) === update) writes.delete(file);
  }
}
