import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storageOrigins } from "./sign-in";

describe("signed-in session capture", () => {
  it("reads local storage for every origin of the product's site, not just the one signed in on", async () => {
    const profile = await mkdtemp(join(tmpdir(), "agentcast-profile-"));
    const db = join(profile, "Default", "Local Storage", "leveldb");
    await mkdir(db, { recursive: true });
    // Chrome's Local Storage keys: META:<origin> and _<origin>\0\1<key>.
    await writeFile(join(db, "000005.ldb"), Buffer.from("x\0META:https://indus.sarvam.ai\0y_https://indus.sarvam.ai\0\u0001sarvam:selected_workspace_id"));
    await writeFile(join(db, "000006.log"), Buffer.from("_https://www.sarvam.ai\0\u0001k META:https://accounts.google.com _https://evil.example\0"));
    expect(await storageOrigins(profile, "https://www.sarvam.ai/")).toEqual(["https://www.sarvam.ai", "https://indus.sarvam.ai"]);
    // No database yet: the product's own origin.
    expect(await storageOrigins(join(profile, "missing"), "https://app.example.com/x")).toEqual(["https://app.example.com"]);
  });
});
