import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Node-only helpers (import from "@agentcast/shared/node"; the web app's client code can't use them).

/** A fixture job dir laid out like a real one (jobPaths). Stub stages copy from it. */
export const FIXTURE_JOB_DIR = fileURLToPath(new URL("../fixtures/job/", import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export class ArtifactError extends Error {
  constructor(
    readonly file: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${file}: ${message}`, options);
    this.name = "ArtifactError";
  }
}

/** Read and validate a JSON artifact (AGENTS.md rule 3). */
export async function readArtifact<S extends z.ZodType>(file: string, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new ArtifactError(file, "unreadable JSON", { cause: err });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ArtifactError(file, z.prettifyError(parsed.error));
  return parsed.data;
}

/** Validate, then write atomically (temp file + rename), creating parent dirs. Returns what was written. */
export async function writeArtifact<S extends z.ZodType>(file: string, schema: S, data: z.input<S>): Promise<z.output<S>> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ArtifactError(file, z.prettifyError(parsed.error));
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(parsed.data, null, 2) + "\n");
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return parsed.data;
}
