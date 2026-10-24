import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReplayPlan } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { cachedLocator, replayKey, saveLocator } from "./replay.ts";

let directory: string;
let path: string;
const entry = {
  strategy: "role" as const,
  locator: 'getByRole("button", { name: "Save", exact: true })',
  lastOk: "2026-10-24T00:00:00.000Z",
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "agentcast-replay-test-"));
  path = join(directory, "replay-plan.json");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("replay cache", () => {
  it("starts from an absent file and writes a schema-validated plan", async () => {
    expect(await cachedLocator(path, "desktop", "s1")).toBeUndefined();
    await saveLocator(path, "desktop", "s1", entry);
    expect(await cachedLocator(path, "desktop", "s1")).toEqual(entry);
    expect((await readArtifact(path, ReplayPlan)).schemaVersion).toBe(1);
  });

  it("retains learned expectations, other steps and the mobile plan", async () => {
    const learned = { ...entry, learnedExpect: [{ type: "changed" as const }] };
    await writeArtifact(path, ReplayPlan, {
      schemaVersion: 1,
      byFormFactor: {
        desktop: { s1: learned, s2: entry },
        mobile: { s1: entry },
      },
    });
    await saveLocator(path, "desktop", "s1", { ...entry, strategy: "llm" });
    const plan = await readArtifact(path, ReplayPlan);
    expect(plan.byFormFactor.desktop!.s1!.learnedExpect).toEqual(
      learned.learnedExpect,
    );
    expect(plan.byFormFactor.desktop!.s2).toEqual(entry);
    expect(plan.byFormFactor.mobile!.s1).toEqual(entry);
  });

  it("serializes concurrent updates without dropping entries", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveLocator(path, i % 2 ? "desktop" : "mobile", `s${i}`, entry),
      ),
    );
    const plan = await readArtifact(path, ReplayPlan);
    expect(Object.keys(plan.byFormFactor.desktop!)).toHaveLength(5);
    expect(Object.keys(plan.byFormFactor.mobile!)).toHaveLength(5);
  });

  it("refuses corrupt or unsupported artifact versions", async () => {
    await writeFile(path, '{"schemaVersion":2,"byFormFactor":{}}');
    await expect(cachedLocator(path, "desktop", "s1")).rejects.toThrow();
    expect(await readFile(path, "utf8")).toContain('"schemaVersion":2');
  });

  it("does not read inherited properties and avoids flow/step key collisions", async () => {
    await saveLocator(path, "desktop", "s1", entry);
    expect(await cachedLocator(path, "desktop", "toString")).toBeUndefined();
    expect(replayKey("s1", "flow-a")).not.toBe(replayKey("s1", "flow-b"));
    expect(replayKey("b/c", "a")).not.toBe(replayKey("c", "a/b"));
  });

  it("does not write when cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      saveLocator(path, "desktop", "s1", entry, controller.signal),
    ).rejects.toThrow("cancelled");
  });
});
