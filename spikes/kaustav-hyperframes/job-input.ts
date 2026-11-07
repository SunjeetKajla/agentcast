// The render input for a job's edit, read from its artifacts the way the preview stage builds it.
import { access, copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { Brand, CreativeBrief, Edl, ProductBrief, Script, Storyboard, Timeline, Voiceover, jobPaths, musicLed, voiced, type Aspect, type JobConfig } from "@agentcast/shared";
import {
  assignNarration,
  baselineEdl,
  beatsOf,
  ensureSfx,
  filmSeconds,
  ledEdl,
  ledStyle,
  loadMusicLibrary,
  musicDir,
  musicStyle,
  pickTrack,
  planMusic,
  planParts,
  premixMusic,
  scriptCaptions,
  shotContent,
  voiceCaptions,
  type SfxKind,
  type VideoInput,
} from "@agentcast/video";

const MUSIC_FILE = "render/audio/music.mp3";
const home = () => process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast");

type SavedConfig = Pick<JobConfig, "url" | "voiceover" | "mode"> & { variants?: { langs?: string[] } };

/**
 * The job's baseline edit made afresh from its saved artifacts, with the music and sound effects the
 * direct stage would use copied into the job's render/audio/. No LLM, no provider quota.
 */
export async function rebuiltEdl(root: string, seed: string): Promise<Edl> {
  const read = async <T>(rel: string, schema: { parse(v: unknown): T }) =>
    schema.parse(JSON.parse(await readFile(join(root, rel), "utf8")));
  const maybe = <T>(p: Promise<T>) => p.catch(() => undefined);
  const { config } = JSON.parse(await readFile(join(root, "state.json"), "utf8")) as { config: SavedConfig };
  const langs = config.variants?.langs ?? ["en"];
  const [timeline, storyboard, creative, brand] = await Promise.all([
    read(jobPaths.timeline("desktop"), Timeline),
    read(jobPaths.storyboard, Storyboard),
    read(jobPaths.creativeBrief, CreativeBrief),
    maybe(read(jobPaths.brand, Brand)),
  ]);
  const scripts = await Promise.all(langs.map((lang) => read(jobPaths.script(lang), Script)));
  const product = await maybe(read(jobPaths.productBrief, ProductBrief));
  const library = await maybe(loadMusicLibrary());
  await mkdir(join(root, "render", "audio", "sfx"), { recursive: true });
  const made = await ensureSfx(join(home(), "sfx"));
  for (const [kind, takes] of Object.entries(made))
    for (const [i, file] of takes.entries())
      await copyFile(file, join(root, "render", "audio", "sfx", `${kind}-${i + 1}${extname(file)}`));
  if (musicLed(config)) {
    const track = pickTrack(library, { personality: creative.personality, edit: "trailer", seconds: creative.targetSeconds, seed, led: true });
    const content = await shotContent(join(root, jobPaths.recording("desktop")), storyboard, timeline);
    const edl = ledEdl({
      content,
      timeline,
      storyboard,
      scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])),
      personality: creative.personality,
      targetSeconds: creative.targetSeconds,
      ...(track ? { music: ledStyle(track), grid: beatsOf(track) } : {}),
      ...(product?.keyTerms ? { terms: product.keyTerms } : {}),
      ...(brand ? { brand } : {}),
    });
    if (track) await premixMusic(planMusic(track, filmSeconds(edl), edl.outro.seconds), join(musicDir(), track.file), join(root, MUSIC_FILE));
    return edl;
  }
  const voices = voiced(config)
    ? (await Promise.all(langs.map((lang) => maybe(read(jobPaths.voice(lang), Voiceover))))).filter((v) => v !== undefined)
    : [];
  const edl = baselineEdl({
    timeline,
    storyboard,
    scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])),
    voices,
    personality: creative.personality,
    ...(brand ? { brand } : {}),
  });
  const track = pickTrack(library, {
    personality: creative.personality,
    edit: edl.style.edit,
    seconds: creative.targetSeconds,
    seed,
  });
  if (track) {
    await copyFile(join(musicDir(), track.file), join(root, MUSIC_FILE));
    edl.style.music = musicStyle(track, edl.style.edit);
  }
  return edl;
}

export async function jobInput(root: string, aspect: Aspect, lang: string, height: number, edit?: Edl): Promise<VideoInput> {
  const read = async <T>(rel: string, schema: { parse(v: unknown): T }) =>
    schema.parse(JSON.parse(await readFile(join(root, rel), "utf8")));
  const maybe = <T>(p: Promise<T>) => p.catch(() => undefined);
  const state = JSON.parse(await readFile(join(root, "state.json"), "utf8")) as { config: SavedConfig };
  const [edl, timeline, storyboard, script, product, voice, brand] = await Promise.all([
    edit ?? read(jobPaths.edl, Edl),
    read(jobPaths.timeline("desktop"), Timeline),
    read(jobPaths.storyboard, Storyboard),
    read(jobPaths.script(lang), Script),
    read(jobPaths.productBrief, ProductBrief),
    voiced(state.config) ? maybe(read(jobPaths.voice(lang), Voiceover)) : undefined,
    maybe(read(jobPaths.brand, Brand)),
  ]);
  const narration = voice ? assignNarration(storyboard, voice, edl) : [];
  const plan = planParts(edl, narration);
  const made = await readdir(join(root, "render", "audio", "sfx")).catch(() => [] as string[]);
  const sfx: Partial<Record<SfxKind, string[]>> = {};
  for (const name of made.sort()) (sfx[name.split("-")[0] as SfxKind] ??= []).push(`render/audio/sfx/${name}`);
  const music = edl.style.music.trackId && (await access(join(root, MUSIC_FILE)).then(() => true, () => false));
  return {
    edl,
    aspect,
    lang,
    footage: { src: jobPaths.recording("desktop"), timeline },
    narration,
    captions: musicLed(state.config) ? [] : voice ? voiceCaptions(plan.clips) : scriptCaptions(plan.parts, edl, storyboard, script),
    brand: {
      name: product.name,
      tagline: product.oneLiner,
      site: new URL(state.config.url).host.replace(/^www\./, ""),
      ...(brand?.hero ? { hero: brand.hero.file } : {}),
      ...(brand?.logo ? { logo: { src: brand.logo.file, width: brand.logo.width, height: brand.logo.height, plate: brand.logo.plate } } : {}),
    },
    copy: { title: script.titleCard, cta: script.cta },
    height,
    audio: {
      sfx,
      ...(music ? { music: MUSIC_FILE } : {}),
    },
  };
}
