import { z } from "zod";
import { HexColor, Personality, Seconds } from "./common.ts";

// brief/product-brief.json (FR-11), brief/creative.json (FR-5, §9.4), brief/brand.json (FR-12, §9.7.3)

export const ProductBrief = z.object({
  schemaVersion: z.literal(1),
  url: z.url(),
  name: z.string(),
  oneLiner: z.string(),
  valueProps: z.array(z.string()),
  audience: z.string(),
  tone: z.array(z.string()),
  keyTerms: z.array(z.string()),
  /** The pages the brief was written from. */
  pages: z.array(z.object({ url: z.url(), title: z.string() })),
});
export type ProductBrief = z.infer<typeof ProductBrief>;

export const CreativeBrief = z.object({
  schemaVersion: z.literal(1),
  /** The user's words, if any. */
  prompt: z.string().optional(),
  audience: z.string(),
  goal: z.string(),
  targetSeconds: Seconds,
  /** e.g. ["calm", "premium"] */
  tone: z.array(z.string()),
  personality: Personality,
  cta: z.string(),
  mustShow: z.array(z.string()),
  avoid: z.array(z.string()),
  /** True when there was no prompt. */
  inferred: z.boolean(),
  /** One-sentence read-back shown on the job page. */
  summary: z.string(),
});
export type CreativeBrief = z.infer<typeof CreativeBrief>;

export const FontChoice = z.object({
  /** Google Fonts family. */
  family: z.string(),
  /** The site's own family name, e.g. "__Inter_d65c78". */
  source: z.string(),
  exact: z.boolean(),
  category: z.enum(["sans-serif", "serif", "monospace", "display", "handwriting"]),
});
export type FontChoice = z.infer<typeof FontChoice>;

export const Brand = z.object({
  schemaVersion: z.literal(2),
  url: z.url(),
  theme: z.enum(["light", "dark"]),
  palette: z.object({
    bg: HexColor,
    fg: HexColor,
    accent: HexColor,
    surface: HexColor,
    accent2: HexColor.optional(),
  }),
  /** "text" means a greyscale brand. */
  accentFrom: z.enum(["theme-color", "buttons", "links", "screenshot", "text", "default"]),
  /** Screenshot colours, most prominent first. */
  found: z.array(HexColor),
  gradient: z.array(z.string()).optional(),
  fonts: z.object({ display: FontChoice, text: FontChoice }),
  /** Button corners in CSS px; 999 = pill. */
  radius: z.number().nonnegative(),
  logo: z
    .object({
      file: z.string(),
      width: z.number().positive(),
      height: z.number().positive(),
      plate: z.boolean(),
      from: z.enum(["inline-svg", "img", "background", "apple-touch-icon", "icon"]),
    })
    .optional(),
  /** brief/hero.jpg, the first screen. */
  hero: z.object({ file: z.string() }).optional(),
});
export type Brand = z.infer<typeof Brand>;
