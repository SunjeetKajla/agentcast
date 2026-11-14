import { BrandKit, jobPaths, type Flow } from "@agentcast/shared";
import { brandKitOf, type ExploreOptions } from "@agentcast/explore";
import { readOptional } from "../material.ts";
import { artifactHash, recover } from "../recovery.ts";
import type { StageContext } from "../context.ts";
import { mkdir } from "node:fs/promises";

/** Relevant product surfaces, not hostname recipes. Keep acquisition assets separate from the home kit. */
export async function acquireBrand(
  ctx: StageContext,
  o: ExploreOptions,
  flows: Flow[],
) {
  let kit = await readOptional(ctx, jobPaths.brandKit, BrandKit);
  if (!kit || kit.imagery.length >= 2) return;
  const urls = [
    ...new Set(
      flows.filter((f) => f.selected && f.rehearsal?.ok).map((f) => f.startUrl),
    ),
  ]
    .filter(
      (u) =>
        new URL(u).origin + new URL(u).pathname !==
        new URL(ctx.config.url).origin + new URL(ctx.config.url).pathname,
    )
    .slice(0, 2);
  for (const url of urls) {
    const prefix = `acquisition/${artifactHash(url).slice(0, 12)}`;
    await recover(
      ctx,
      {
        kind: "explore",
        reason: "Collecting brand material from a demonstrated product page.",
      },
      { url, prefix },
      async () => {
        await mkdir(ctx.path(prefix), { recursive: true });
        const look = await o.browser.inspect(url, {
          ...o.browserOptions,
          dir: ctx.path(prefix),
          authorizedUrl: ctx.config.url,
          signal: ctx.signal,
          captureAssets: true,
          storageState: undefined,
          healing: undefined,
        });
        const extra = await brandKitOf({
          dir: ctx.path(prefix),
          hero: look.hero,
          captures: look.captures ?? [],
          cloud: [],
          signal: ctx.signal,
        });
        await ctx.write(`${prefix}/brief/brand-kit.json`, BrandKit, extra);
        return "Product page assets collected";
      },
    );
    const extra = await readOptional(
      ctx,
      `${prefix}/brief/brand-kit.json`,
      BrandKit,
    );
    if (!extra) continue;
    const rel = (f: string) => `${prefix}/${f}`;
    kit = BrandKit.parse({
      ...kit,
      imagery: [
        ...kit.imagery,
        ...extra.imagery.map((i) => ({ ...i, file: rel(i.file) })),
      ].filter((x, i, a) => a.findIndex((y) => y.file === x.file) === i),
      captures: [
        ...kit.captures,
        ...extra.captures.map((c) => ({ ...c, file: rel(c.file) })),
      ].filter((x, i, a) => a.findIndex((y) => y.file === x.file) === i),
      colours: [...new Set([...kit.colours, ...extra.colours])].slice(0, 4),
    });
    await ctx.write(jobPaths.brandKit, BrandKit, kit);
    for (const asset of [...kit.imagery, ...kit.captures])
      ctx.artifact(asset.file);
  }
}
