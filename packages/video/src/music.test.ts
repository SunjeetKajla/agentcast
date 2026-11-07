import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MusicLibrary } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { loadMusicLibrary, pickTrack } from "./music";

it("only selects locally available audio from the committed music metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-music-library-"));
  try {
    const source = fileURLToPath(
      new URL("../../../assets/music/tags.json", import.meta.url),
    );
    const library = await readArtifact(source, MusicLibrary);
    await writeArtifact(join(dir, "tags.json"), MusicLibrary, library);
    const empty = await loadMusicLibrary(dir);
    expect(empty?.tracks).toEqual([]);
    expect(
      pickTrack(empty, {
        personality: "premium",
        edit: "trailer",
        seconds: 10,
        seed: "fixture",
      }),
    ).toBeUndefined();
    const track = library.tracks[0]!;
    await writeFile(
      join(dir, track.file),
      "fixture audio path (decoding belongs to the render tests)",
    );
    const available = await loadMusicLibrary(dir);
    expect(available?.tracks.map((t) => t.id)).toEqual([track.id]);
    expect(
      pickTrack(available, {
        personality: "premium",
        edit: "trailer",
        seconds: 10,
        seed: "fixture",
      })?.id,
    ).toBe(track.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
