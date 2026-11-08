// The render input for a job's edit, read from its artifacts the way the preview stage builds it.
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { ArtDirection, Brand, BrandKit, ProductOutputs, CreativeBrief, Edl, ProductBrief, Script, Storyboard, Timeline, Voiceover, jobPaths, musicLed, voiced, type Aspect, type JobConfig } from "@agentcast/shared";
import { brandKitOf, recorderAdapter, withRecordingImagery } from "@agentcast/explore";
import { sharedLlm } from "@agentcast/llm";
import { checkDirection, directArt, productTypeOf, rulesDirection, scriptLinesOf, shotBriefsOf, siteTextOf, workspaceLlm } from "@agentcast/story";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assignNarration,
  baselineEdl,
  beatsOf,
  ensureSfx,
  audioShape,
  chooseSkeleton,
  extractLayers,
  filmSeconds,
  inventoryOf,
  ledPlan,
  ledStyle,
  loadMusicLibrary,
  loadReferenceLibrary,
  productShape,
  musicDir,
  musicStyle,
  pickTrack,
  planMusic,
  planLedFilm,
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
/**
 * Art direction on a job copy, as the script stage makes it, by the rules table (no LLM): the brand kit's logo
 * parts from brief/logo.png, the recording's layers, the inventory, the call and its check. Writes
 * brief/brand-kit.json, render/layers.json and brief/art-direction.json into the copy.
 */
async function artOf(
  root: string,
  o: { timeline: Timeline; storyboard: Storyboard; product?: ProductBrief; creative: CreativeBrief; scripts: Script[]; brand?: Brand; content: Awaited<ReturnType<typeof shotContent>>; url: string; live: boolean; director: boolean },
) {
  const exec = promisify(execFile);
  const recording = join(root, jobPaths.recording("desktop"));
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", recording]);
  const width = Number(stdout.trim()) || o.timeline.viewport.w;
  const layers = await extractLayers({ recording, timeline: o.timeline, width, dir: join(root, "render", "layers"), rel: "render/layers" });
  let brand = o.brand;
  let kit: BrandKit;
  if (o.live) {
    // As understand captures it for a new job: the site inspected in local Chrome, its kit built from that.
    const look = await (await recorderAdapter()).inspect(o.url, { dir: root, authorizedUrl: o.url });
    if (brand && look.logo) brand = { ...brand, logo: look.logo };
    if (brand && look.hero) brand = { ...brand, hero: { file: look.hero } };
    if (brand) await writeFile(join(root, jobPaths.brand), JSON.stringify(brand, null, 2));
    kit = await brandKitOf({
      dir: root,
      ...(brand?.logo ? { logo: { file: brand.logo.file, ...(brand.logo.plate ? { plate: true } : {}) } } : {}),
      ...(brand?.hero ? { hero: brand.hero.file } : {}),
      captures: look.captures ?? [],
      cloud: look.cloud ?? [],
    });
    console.log(`kit captured live: ${kit.captures.length} page(s), ${kit.imagery.length} object(s) from pages, colours ${kit.colours.join(" ") || "none"}`);
  } else {
    // The job's own captures and logo, as they are.
    const captures = (await readdir(join(root, "brief", "captures")).catch(() => [] as string[])).filter((f) => /\.jpe?g$/.test(f)).sort().map((f) => ({ file: `brief/captures/${f}`, url: o.url }));
    kit = await brandKitOf({ dir: root, ...(brand?.logo ? { logo: { file: brand.logo.file, ...(brand.logo.plate ? { plate: true } : {}) } } : {}), ...(brand?.hero ? { hero: brand.hero.file } : {}), captures, cloud: [] });
  }
  kit = (await withRecordingImagery({ kit, dir: root, recording, timeline: o.timeline })) ?? kit;
  console.log(`kit: ${kit.imagery.length} brand object(s) (${kit.imagery.filter((i) => i.from === "recording").length} from the recording), colours ${kit.colours.join(" ") || "none"}`);
  const outputs = await readFile(join(root, jobPaths.outputs), "utf8").then((t) => ProductOutputs.parse(JSON.parse(t)), () => undefined);
  const accent = brand?.palette.accent ?? "#888888";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16) / 255);
  const sat = Math.max(r!, g!, b!) ? (Math.max(r!, g!, b!) - Math.min(r!, g!, b!)) / Math.max(r!, g!, b!) : 0;
  const inventory = inventoryOf({ timeline: o.timeline, layers, kit, theme: brand?.theme ?? "dark", colourful: brand?.accentFrom !== "text" && sat > 0.3, hero: Boolean(brand?.hero), density: width / o.timeline.viewport.w, content: o.content, outputs: outputs?.outputs.length ?? 0 });
  const library = await loadReferenceLibrary();
  const skeletons = (library?.skeletons ?? []).map((s) => ({ id: s.id, name: s.name, feel: s.feel, suits: s.suits }));
  const shape = productShape(o.storyboard, o.timeline, o.content);
  const input = { inventory, skeletons, shape, seed: o.url };
  // The director's call (the user's Claude Code login, fast tier), as the script stage makes it; else the rules table.
  const direction =
    o.director && o.product
      ? await directArt(workspaceLlm(sharedLlm()), { product: o.product, creative: o.creative, ...input, shots: shotBriefsOf(o.storyboard, o.timeline, outputs), siteText: await siteTextOf(join(root, "brief", "pages")), scriptLines: scriptLinesOf(o.scripts) })
      : checkDirection(rulesDirection({ productType: o.product ? productTypeOf(o.product) : "other", ...input }), input);
  await writeFile(join(root, jobPaths.brandKit), JSON.stringify(kit, null, 2));
  await writeFile(join(root, jobPaths.layers), JSON.stringify(layers, null, 2));
  await writeFile(join(root, jobPaths.artDirection), JSON.stringify(direction, null, 2));
  return { direction, kit, ...(outputs ? { outputs } : {}), ...(brand ? { brand } : {}) };
}

export async function rebuiltEdl(root: string, seed: string, skeletonId = "auto", art = false, options: { liveKit?: boolean; director?: boolean } = {}): Promise<Edl> {
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
    const made = art ? await artOf(root, { timeline, storyboard, creative, scripts, ...(product ? { product } : {}), ...(brand ? { brand } : {}), content, url: config.url, live: options.liveKit === true, director: options.director === true }) : undefined;
    const direction = made?.direction;
    if (direction) console.log(`${seed}: art direction ${JSON.stringify({ by: direction.by, type: direction.productType, skeleton: direction.skeletonId, brand: direction.brand, featured: direction.featured, shots: direction.shots, changed: direction.changed })}`);
    if (made && direction) {
      // The film as the script and direct stages plan it: planLedFilm with the kit, the outputs and the flows' own words.
      const film = await planLedFilm({
        recording: join(root, jobPaths.recording("desktop")),
        timeline,
        storyboard,
        scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])),
        creative,
        ...(product ? { product } : {}),
        ...(made.brand ? { brand: made.brand } : {}),
        seed,
        site: config.url,
        direction,
        content,
        root,
        kit: made.kit,
        ...(made.outputs ? { outputs: made.outputs } : {}),
      });
      const { edl, dropped } = film.plan;
      console.log(`${seed}: skeleton ${film.plan.skeleton.id}, ${filmSeconds(edl).toFixed(1)} s${dropped.length ? `, left out ${dropped.map((d) => `${d.beatId} (${d.reason})`).join(", ")}` : ""}`);
      if (film.track) await premixMusic(planMusic(film.track, filmSeconds(edl), edl.outro.seconds), join(musicDir(), film.track.file), join(root, MUSIC_FILE));
      return edl;
    }
    // The skeleton: art direction's, one named on the command line, or the one the worker would pick for this product.
    const references = await loadReferenceLibrary();
    const skeleton =
      skeletonId === "auto"
        ? references && chooseSkeleton(references, productShape(storyboard, timeline, content), config.url)
        : references?.skeletons.find((s) => s.id === skeletonId);
    if (skeletonId !== "auto" && !skeleton) throw new Error(`No skeleton "${skeletonId}" in the reference library`);
    const { edl, dropped } = ledPlan({
      content,
      seed: config.url,
      ...(skeleton ? { skeleton } : {}),
      timeline,
      storyboard,
      scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])),
      personality: creative.personality,
      targetSeconds: creative.targetSeconds,
      ...(track ? { music: ledStyle(track), grid: beatsOf(track) } : {}),
      ...(product?.keyTerms ? { terms: product.keyTerms } : {}),
      ...(brand ? { brand } : {}),
    });
    console.log(`${seed}: skeleton ${skeleton?.id ?? "default"}, ${filmSeconds(edl).toFixed(1)} s${dropped.length ? `, left out ${dropped.map((d) => `${d.beatId} (${d.reason})`).join(", ")}` : ""}`);
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
  const kit = await maybe(read(jobPaths.brandKit, BrandKit));
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
      ...(brand?.logo
        ? { logo: { src: brand.logo.file, width: brand.logo.width, height: brand.logo.height, plate: brand.logo.plate, ...(kit?.logo ? { parts: { kind: kit.logo.kind, ...(kit.logo.mark ? { mark: kit.logo.mark } : {}), letters: kit.logo.letters }, ...(kit.logo.svg || kit.logo.cut ? { art: kit.logo.svg ?? kit.logo.cut } : {}) } : {}) } }
        : {}),
    },
    copy: { title: script.titleCard, cta: script.cta },
    height,
    audio: {
      sfx,
      ...(music ? { music: MUSIC_FILE } : {}),
    },
  };
}
