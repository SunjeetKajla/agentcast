// The render input for a job's edit, read from its artifacts the way the preview stage builds it.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Brand, Edl, ProductBrief, Script, Storyboard, Timeline, Voiceover, jobPaths, type Aspect } from "@agentcast/shared";
import { assignNarration, planParts, scriptCaptions, voiceCaptions, type VideoInput } from "@agentcast/video";

export async function jobInput(root: string, aspect: Aspect, lang: string, height: number, edit?: Edl): Promise<VideoInput> {
  const read = async <T>(rel: string, schema: { parse(v: unknown): T }) =>
    schema.parse(JSON.parse(await readFile(join(root, rel), "utf8")));
  const maybe = <T>(p: Promise<T>) => p.catch(() => undefined);
  const state = JSON.parse(await readFile(join(root, "state.json"), "utf8")) as { config: { url: string; voiceover?: boolean } };
  const [edl, timeline, storyboard, script, product, voice, brand] = await Promise.all([
    edit ?? read(jobPaths.edl, Edl),
    read(jobPaths.timeline("desktop"), Timeline),
    read(jobPaths.storyboard, Storyboard),
    read(jobPaths.script(lang), Script),
    read(jobPaths.productBrief, ProductBrief),
    state.config.voiceover ? maybe(read(jobPaths.voice(lang), Voiceover)) : undefined,
    maybe(read(jobPaths.brand, Brand)),
  ]);
  const narration = voice ? assignNarration(storyboard, voice, edl) : [];
  const plan = planParts(edl, narration);
  const kinds = ["whoosh", "click", "pop", "riser", "hit"] as const;
  return {
    edl,
    aspect,
    lang,
    footage: { src: jobPaths.recording("desktop"), timeline },
    narration,
    captions: voice ? voiceCaptions(plan.clips) : scriptCaptions(plan.parts, edl, storyboard, script),
    brand: {
      name: product.name,
      tagline: product.oneLiner,
      site: new URL(state.config.url).host.replace(/^www\./, ""),
      ...(brand?.hero ? { hero: brand.hero.file } : {}),
      ...(brand?.logo ? { logo: { src: brand.logo.file, width: brand.logo.width, height: brand.logo.height, plate: brand.logo.plate } } : {}),
    },
    copy: { title: script.titleCard, cta: script.cta },
    height,
    audio: { sfx: Object.fromEntries(kinds.map((k) => [k, `render/audio/sfx/${k}.wav`])) },
  };
}
