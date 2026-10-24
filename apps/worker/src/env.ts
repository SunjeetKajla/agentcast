import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const REPO_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));

/**
 * Loads the repo's .env into process.env. Its values win over the shell's (AGENTS.md, Environment);
 * empty values count as unset. Returns the names it overrode so the caller can say so.
 */
export async function loadDotEnv(file = REPO_ENV): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const overrode: string[] = [];
  for (const [name, value] of Object.entries(parseEnv(text))) {
    if (value === "") continue;
    const current = process.env[name];
    if (current !== undefined && current !== value) overrode.push(name);
    process.env[name] = value;
  }
  return overrode;
}

/** $AGENTCAST_HOME with a leading ~ expanded; ~/.agentcast by default. */
export function agentcastHome(): string {
  const raw = process.env.AGENTCAST_HOME || "~/.agentcast";
  return raw === "~" || raw.startsWith("~/") ? join(homedir(), raw.slice(1)) : raw;
}

/** Where the worker listens, from WORKER_URL (default http://127.0.0.1:4000). */
export function workerAddress(): { host: string; port: number } {
  const url = new URL(process.env.WORKER_URL || "http://127.0.0.1:4000");
  return { host: url.hostname, port: Number(url.port) || 4000 };
}
