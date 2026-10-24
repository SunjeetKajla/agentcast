import { Storyboard, Script, Voiceover, jobPaths } from "@agentcast/shared";
import { fixtureStages } from "@agentcast/explore";
import { renderNarration, type NarrationOptions } from "@agentcast/voice";
import type { StageFn } from "./types.ts";
import { copyFixture, fixtureLangs, pretend } from "./stub.ts";

export function makeVoice(
  deps: Pick<NarrationOptions, "client" | "duration"> = {},
): StageFn {
  return async (ctx) => {
    if (!ctx.config.voiceover)
      return {
        skipped: true,
        message: "No voiceover: the script becomes captions",
      };
    if (fixtureStages()) {
      await pretend(ctx);
      for (const lang of fixtureLangs(ctx, ctx.config)) {
        await copyFixture(ctx, jobPaths.voice(lang), jobPaths.voice(lang));
        const { clips } = await ctx.read(jobPaths.voice(lang), Voiceover);
        for (const clip of clips) await copyFixture(ctx, clip.file, clip.file);
      }
      return;
    }
    const storyboard = await ctx.read(jobPaths.storyboard, Storyboard);
    const scripts: Record<string, Script> = {};
    for (const lang of ctx.config.variants.langs)
      scripts[lang] = await ctx.read(jobPaths.script(lang), Script);
    const result = await renderNarration({
      ...deps,
      dir: ctx.dir,
      storyboard,
      scripts,
      signal: ctx.signal,
      log: (message) => ctx.log(message),
      progress: (value, message) => ctx.progress(value, message),
      artifact: (file) => ctx.artifact(file),
    });
    ctx.log(
      `Narration ready: ${result.voices.length} language(s), ${result.characters} new characters, ${result.reused} cached clips.`,
    );
  };
}
export const voice = makeVoice();
