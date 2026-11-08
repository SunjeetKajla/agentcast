import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ReferenceLibrary } from "@agentcast/shared";

// The reference library (assets/references/, PRD §9.7.7): film skeletons learned from the reference films.

/** The library's folder: assets/references/ in the repo, or AGENTCAST_REFERENCES_DIR. */
export const referencesDir = () => process.env.AGENTCAST_REFERENCES_DIR ?? fileURLToPath(new URL("../../../assets/references/", import.meta.url));

/** assets/references/skeletons.json, validated; undefined when there's no library. */
export async function loadReferenceLibrary(dir = referencesDir()): Promise<ReferenceLibrary | undefined> {
  const text = await readFile(`${dir.replace(/\/$/, "")}/skeletons.json`, "utf8").catch(() => undefined);
  return text ? ReferenceLibrary.parse(JSON.parse(text)) : undefined;
}
