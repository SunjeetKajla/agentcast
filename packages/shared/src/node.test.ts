import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { MusicLibrary } from "./index.ts";
import { ArtifactError, readArtifact, writeArtifact } from "./node.ts";

const library = { schemaVersion: 1 as const, tracks: [] };

test("writeArtifact validates, creates dirs and leaves no temp files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-shared-"));
  const file = join(dir, "a", "b", "tags.json");
  await writeArtifact(file, MusicLibrary, library);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(library);
  expect(await readdir(join(dir, "a", "b"))).toEqual(["tags.json"]);
  expect(await readArtifact(file, MusicLibrary)).toEqual(library);
});

test("writeArtifact refuses invalid data and writes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-shared-"));
  const file = join(dir, "tags.json");
  // @ts-expect-error: wrong schemaVersion on purpose
  await expect(writeArtifact(file, MusicLibrary, { schemaVersion: 2, tracks: [] })).rejects.toThrow(ArtifactError);
  expect(await readdir(dir)).toEqual([]);
});

test("readArtifact names the file and the problem", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-shared-"));
  const file = join(dir, "tags.json");
  await writeFile(file, JSON.stringify({ schemaVersion: 1 }));
  await expect(readArtifact(file, MusicLibrary)).rejects.toThrow(/tags\.json: .*tracks/s);
  await writeFile(file, "{ nope");
  await expect(readArtifact(file, MusicLibrary)).rejects.toThrow(/unreadable JSON/);
});
