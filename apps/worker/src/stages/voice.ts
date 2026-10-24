import { Voiceover, jobPaths } from "@agentcast/shared";
import type { StageFn } from "./types.ts";
import { copyFixture, fixtureLangs, pretend } from "./stub.ts";

// voice: ElevenLabs, a clip per beat per language with word timings (PRD §9.5). Owner: Sunjeet. Stub for now.
export const voice: StageFn = async (ctx) => {
  await pretend(ctx);
  for (const lang of fixtureLangs(ctx, ctx.config)) {
    await copyFixture(ctx, jobPaths.voice(lang), jobPaths.voice(lang));
    const { clips } = await ctx.read(jobPaths.voice(lang), Voiceover);
    for (const clip of clips) await copyFixture(ctx, clip.file, clip.file);
  }
};
