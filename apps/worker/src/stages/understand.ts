import { mkdir } from "node:fs/promises";
import {
  Brand,
  ProductBrief,
  CreativeBrief,
  jobPaths,
} from "@agentcast/shared";
import {
  brandPalette,
  pickFont,
  googleFontAvailable,
  recorderAdapter,
  understand as readProduct,
  workspaceLlm,
  fixtureStages,
  type BrowserAdapter,
} from "@agentcast/explore";
import { creativeBrief } from "@agentcast/story";
import { TinyFish } from "@agentcast/tinyfish";
import type { StageFn } from "./types.ts";
import { stub } from "./stub.ts";

/** Fetch + a real browser brand inspection. Provider failures never become fixture successes. */
export function makeUnderstand(
  deps: {
    tf?: TinyFish;
    browser?: BrowserAdapter;
    hasFont?: typeof googleFontAvailable;
  } = {},
): StageFn {
  return async (ctx) => {
    if (fixtureStages()) {
      await stub(ctx, [
        jobPaths.productBrief,
        jobPaths.creativeBrief,
        jobPaths.brand,
      ]);
      return;
    }
    const browser = deps.browser ?? (await recorderAdapter());
    const tf = deps.tf ?? new TinyFish();
    const llm = workspaceLlm(ctx.llm, ctx.llmProgress);
    const options = {
      dir: ctx.dir,
      authorizedUrl: ctx.config.url,
      signal: ctx.signal,
    };
    await mkdir(ctx.path("brief"), { recursive: true });
    const [product, inspection] = await Promise.allSettled([
      readProduct({
        tf,
        llm,
        url: ctx.config.url,
        dir: ctx.path("brief"),
        signal: ctx.signal,
        log: (message) => ctx.log(message),
        readPage: (url) => browser.readPage(url, options),
      }),
      browser.inspect(ctx.config.url, options),
    ]);
    ctx.signal.throwIfAborted();
    if (product.status === "rejected") throw product.reason;
    await ctx.write(jobPaths.productBrief, ProductBrief, product.value.brief);
    const creative = await creativeBrief(
      llm,
      {
        prompt: ctx.config.stylePrompt,
        focus: ctx.config.focusPrompt,
        mode: ctx.config.mode,
        product: product.value.brief,
      },
      ctx.signal,
    );
    await ctx.write(jobPaths.creativeBrief, CreativeBrief, creative.brief);
    ctx.log(creative.brief.summary);
    const look =
      inspection.status === "fulfilled" ? inspection.value : undefined;
    if (!look)
      ctx.log(
        "The browser brand inspection was unavailable; using an explicitly default brand palette.",
        "warn",
      );
    const colors = look && brandPalette(look.samples ?? [], look.colors);
    const hasFont = deps.hasFont ?? googleFontAvailable;
    const [display, text] = await Promise.all([
      pickFont(look?.fonts?.display ?? "Inter, sans-serif", async (family) =>
        hasFont(family, ctx.signal),
      ),
      pickFont(look?.fonts?.text ?? "Inter, sans-serif", async (family) =>
        hasFont(family, ctx.signal),
      ),
    ]);
    ctx.signal.throwIfAborted();
    const brand = Brand.parse({
      schemaVersion: 2,
      url: ctx.config.url,
      ...(colors ?? {
        theme: "dark",
        palette: {
          bg: "#111111",
          fg: "#f4f4f4",
          accent: "#a4c7b5",
          surface: "#202020",
        },
        accentFrom: "default",
        found: [],
      }),
      fonts: { display, text },
      radius: look?.radius ?? 8,
      ...(look?.gradient?.length ? { gradient: look.gradient } : {}),
      ...(look?.hero ? { hero: { file: look.hero } } : {}),
      ...(look?.logo ? { logo: look.logo } : {}),
    });
    await ctx.write(jobPaths.brand, Brand, brand);
    if (brand.hero) ctx.artifact(brand.hero.file);
    if (brand.logo) ctx.artifact(brand.logo.file);
    ctx.progress(1, "Product and creative brief ready");
  };
}
export const understand = makeUnderstand();
