import { z } from "zod";

export const FormFactor = z.enum(["desktop", "mobile"]);
export type FormFactor = z.infer<typeof FormFactor>;

/** Output aspect. "x" rather than ":" because it ends up in file names (out/16x9-en.mp4). */
export const Aspect = z.enum(["16x9", "9x16"]);
export type Aspect = z.infer<typeof Aspect>;

/** Narration language, BCP 47-ish ("en", "hi"). */
export const Lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/);
export type Lang = z.infer<typeof Lang>;

export const VideoMode = z.enum(["launch", "tutorial", "sales"]);
export type VideoMode = z.infer<typeof VideoMode>;

/** Motion personality from the motion design skill (PRD §9.7.1). */
export const Personality = z.enum(["playful", "premium", "corporate", "energetic"]);
export type Personality = z.infer<typeof Personality>;

/** x, y, w, h in CSS px of the recording's viewport. */
export const Rect = z.tuple([z.number(), z.number(), z.number().nonnegative(), z.number().nonnegative()]);
export type Rect = z.infer<typeof Rect>;

export const Point = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof Point>;

/** On-screen text in every language: { en: "…", hi: "…" }. */
export const TextByLang = z.record(Lang, z.string());
export type TextByLang = z.infer<typeof TextByLang>;

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A typed value marked secret is stored like this, never in clear (AGENTS.md rule 5). */
export const Redacted = z.object({ redacted: z.literal(true) });

export const Seconds = z.number().nonnegative();

export const IsoTime = z.iso.datetime();

export const LocatorStrategy = z.enum(["role", "label", "placeholder", "text", "llm"]);
export type LocatorStrategy = z.infer<typeof LocatorStrategy>;
