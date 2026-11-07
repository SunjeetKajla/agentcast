// @agentcast/cli: `agentcast` CLI: music. Owner: Kaustav.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { MusicLibrary, type MusicTrack } from "@agentcast/shared";
import { analyzeTrack, musicDir } from "@agentcast/video";

const libraryFile = () => join(musicDir(), "tags.json");

/** tags.json as it stands: measured fields may be out of date or missing, so it isn't validated here. */
async function loadRaw(): Promise<{
  schemaVersion: number;
  tracks: Partial<MusicTrack>[];
}> {
  return JSON.parse(
    await readFile(libraryFile(), "utf8").catch(
      () => '{"schemaVersion":3,"tracks":[]}',
    ),
  );
}

/** Validates against the current schema before anything is written. */
const save = (raw: { tracks: Partial<MusicTrack>[] }) =>
  writeFile(
    libraryFile(),
    `${JSON.stringify(MusicLibrary.parse({ schemaVersion: 3, tracks: raw.tracks }), null, 2)}\n`,
  );

async function analyze(ids: string[]) {
  const raw = await loadRaw();
  for (const track of raw.tracks) {
    if (ids.length && !ids.includes(track.id!)) continue;
    const measured = await analyzeTrack(join(musicDir(), track.file!));
    Object.assign(track, measured);
    console.log(
      `${track.id}: ${measured.bpm} BPM, ${measured.analysis.confidence} confidence, ${measured.lufs} LUFS, enter at ${measured.analysis.entries.slice(0, 4).join(", ")}`,
    );
  }
  await save(raw);
}

async function add(files: string[], args: string[]) {
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      mood: { type: "string" },
      energy: { type: "string" },
      source: { type: "string" },
      license: { type: "string" },
      title: { type: "string" },
      artist: { type: "string" },
    },
  });
  if (!values.mood || !values.energy || !values.source || !values.license)
    throw new Error(
      "music add needs --mood <a,b> --energy <1-5> --source <url> --license <text>",
    );
  const raw = await loadRaw();
  for (const file of files) {
    const name = basename(file);
    const id = basename(name, extname(name))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    await copyFile(file, join(musicDir(), name));
    const track: Partial<MusicTrack> = {
      id,
      file: name,
      title: values.title ?? id,
      ...(values.artist ? { artist: values.artist } : {}),
      source: values.source,
      license: values.license,
      mood: values.mood.split(","),
      energy: Number(values.energy),
      ...(await analyzeTrack(join(musicDir(), name))),
    };
    raw.tracks = [...raw.tracks.filter((t) => t.id !== id), track];
    console.log(`${id}: added`);
  }
  await save(raw);
}

async function list() {
  for (const t of (await loadRaw()).tracks)
    console.log(
      `${t.id}  ${t.bpm} BPM  energy ${t.energy}  ${t.analysis?.confidence ?? "not analysed"}  ${t.license}`,
    );
}

const USAGE = `agentcast music list
agentcast music analyze [id...]
agentcast music add <file...> --mood <a,b> --energy <1-5> --source <url> --license <text> [--title t] [--artist a]`;

export async function runMusic(args: string[]) {
  const [command, sub, ...rest] = args;
  if (command !== "music") throw new Error(USAGE);
  const positionals = rest.filter(
    (a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"),
  );
  if (sub === "list") await list();
  else if (sub === "analyze") await analyze(positionals);
  else if (sub === "add") await add(positionals, rest);
  else throw new Error(USAGE);
}
