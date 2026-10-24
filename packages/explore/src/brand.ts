import type { Brand, FontChoice } from "@agentcast/shared";

export type Rgb = [number, number, number];

/** A CSS colour (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`) as RGB; mostly transparent colours are none. */
export function parseColor(css: string | undefined | null): Rgb | undefined {
  if (!css) return undefined;
  const s = css.trim().toLowerCase();
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)?.[1];
  if (h) {
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const m =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
      s,
    );
  if (!m) return undefined;
  const alpha =
    m[4] === undefined
      ? 1
      : m[4].endsWith("%")
        ? Number(m[4].slice(0, -1)) / 100
        : Number(m[4]);
  if (alpha < 0.5) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) =>
    Math.max(0, Math.min(255, Math.round(v))),
  ) as Rgb;
}

export const hex = (c: Rgb) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [
    number,
    number,
  ];
  return (x + 0.05) / (y + 0.05);
};

/** How colourful, 0 (grey) to 1. */
export const chroma = ([r, g, b]: Rgb) =>
  (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

/** `a` moved toward `b` by `t` (0–1). */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  a.map((v, i) => v + (b[i]! - v) * t) as Rgb;

/** Unstyled links: the browser's colours, not the brand's. */
const UA_LINKS = ["#0000ee", "#551a8b"];

const near = (a: Rgb, b: Rgb) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 48;

export type ColorSample = {
  color: string;
  weight: number;
  from: "theme-color" | "buttons" | "links" | "screenshot";
};

/** What the page itself says about its colours (computed styles). */
export type PageColors = { background?: string; text?: string };

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** `c` pushed away from `bg` (toward black or white) until it reaches `ratio`. */
function readable(c: Rgb, bg: Rgb, ratio: number): Rgb {
  const toward = luminance(bg) > 0.4 ? BLACK : WHITE;
  let x = c;
  for (let i = 0; i < 12 && contrast(x, bg) < ratio; i++)
    x = mix(x, toward, 0.15);
  return x;
}

/**
 * The video's colours from the landing page (FR-12, PRD §9.7.3), so the video looks like the
 * product: the page's own background (its computed background, else the screenshot's commonest
 * colour) sets the theme; its text colour is the foreground (pushed to 13:1, as crisp as its headings); the accent is the
 * most prominent colourful colour (similar shades pooled; theme-color, then buttons, count most;
 * the browser's default link colours don't), or, for a greyscale brand, its text colour, so a black
 * and white product stays black and white. A second colourful colour becomes `accent2`. The accent
 * is pushed until it reads on the background (3:1, as large UI). Undefined when the page gave no
 * colours at all.
 */
export function brandPalette(
  samples: ColorSample[],
  page: PageColors = {},
):
  | {
      theme: Brand["theme"];
      palette: Brand["palette"];
      accentFrom: Brand["accentFrom"];
      found: string[];
    }
  | undefined {
  const pools: Array<{
    color: Rgb;
    weight: number;
    from: ColorSample["from"];
  }> = [];
  const all: Array<{ color: Rgb; weight: number }> = [];
  for (const s of samples) {
    const c = parseColor(s.color);
    if (!c || !(s.weight > 0)) continue;
    if (s.from === "links" && UA_LINKS.includes(hex(c))) continue;
    if (s.from === "screenshot") {
      const seen = all.find((p) => near(p.color, c));
      if (seen) seen.weight += s.weight;
      else all.push({ color: c, weight: s.weight });
    }
    const l = luminance(c);
    if (chroma(c) < 0.22 || l < 0.02 || l > 0.85) continue;
    const pool = pools.find((p) => near(p.color, c));
    if (pool) pool.weight += s.weight;
    else pools.push({ color: c, weight: s.weight, from: s.from });
  }
  all.sort((a, b) => b.weight - a.weight);
  const found = all.slice(0, 8).map((p) => hex(p.color));
  const bg = parseColor(page.background) ?? all[0]?.color;
  if (!bg) return undefined;
  const theme: Brand["theme"] = luminance(bg) > 0.4 ? "light" : "dark";
  // Video text is set larger and briefer than a page's body copy, like its headings: keep it crisp (13:1).
  const fg = readable(
    parseColor(page.text) ??
      (theme === "light" ? [17, 17, 17] : [240, 240, 240]),
    bg,
    13,
  );
  // An accent needs presence: about one real button, or 2.5% of the screen (not a speck of a photo).
  const ranked = pools
    .sort((a, b) => b.weight - a.weight)
    .filter((p) => p.weight >= 1);
  const best = ranked[0];
  const second =
    best &&
    ranked.find(
      (p) =>
        Math.hypot(
          ...([0, 1, 2].map((i) => p.color[i]! - best.color[i]!) as [
            number,
            number,
            number,
          ]),
        ) > 90,
    );
  const accent = best ? readable(best.color, bg, 3) : fg;
  return {
    theme,
    palette: {
      bg: hex(bg),
      fg: hex(fg),
      accent: hex(accent),
      surface: hex(mix(bg, fg, theme === "light" ? 0.05 : 0.07)),
      ...(second ? { accent2: hex(readable(second.color, bg, 3)) } : {}),
    },
    accentFrom: best ? best.from : "text",
    found,
  };
}

const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|segoe ui|helvetica neue|helvetica|arial|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|inherit|initial)$/i;

/**
 * Names to look up on Google Fonts for a CSS font stack, most likely first: each declared family
 * with framework mangling removed (Next.js `__Inter_d65c78`, `__GeistSans_Fallback_…`) and
 * camel-case split ("GeistSans" → "Geist Sans", "Geist"). System and generic families are skipped.
 */
export function fontCandidates(stack: string): string[] {
  const out: string[] = [];
  for (const raw of stack.split(",")) {
    let f = raw.trim().replace(/^["']|["']$/g, "");
    if (!f || GENERIC.test(f) || /fallback/i.test(f)) continue;
    f = f
      .replace(/^__/, "")
      .replace(/_[0-9a-f]{5,}$/i, "")
      .replace(/_/g, " ")
      .trim();
    const spaced = f
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+(Variable|VF|Web|Font)$/i, "");
    for (const name of [
      spaced,
      spaced.replace(/\s+(Sans|Serif|Mono|Text|Display)$/i, ""),
      f,
    ])
      if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** What kind of typeface a stack is, for a stand-in when the site's own isn't on Google Fonts. */
export function fontCategory(stack: string): FontChoice["category"] {
  // The site's own (first) family, plus the generic family the stack falls back to: system fonts
  // later in the stack ("SF Pro Display") say nothing about the brand's.
  const families = stack.split(",").map((f) =>
    f
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase(),
  );
  const generic =
    families.find((f) => ["serif", "monospace", "sans-serif"].includes(f)) ??
    "";
  const s = `${families[0] ?? ""} ${generic}`;
  if (/mono|code|consol|courier|menlo/.test(s)) return "monospace";
  if (/grotesk|display|clash|cabinet|syne|druk|unbounded|bricolage/.test(s))
    return "display";
  if (
    /(^|[\s,"'])serif|georgia|times|garamond|playfair|merriweather|lora|fraunces|instrument serif|tiempos|newsreader/.test(
      s.replace(/sans-serif/g, ""),
    )
  )
    return "serif";
  return "sans-serif";
}

/** Google Fonts stand-ins by category, when the site's own font isn't available there. */
export const FONT_STAND_INS: Record<FontChoice["category"], string> = {
  "sans-serif": "Inter",
  serif: "Source Serif 4",
  monospace: "JetBrains Mono",
  display: "Space Grotesk",
  handwriting: "Caveat",
};

/** The first family in `stack` that Google Fonts has (`has` checks one name), else the category's stand-in. */
export async function pickFont(
  stack: string,
  has: (family: string) => Promise<boolean>,
): Promise<FontChoice> {
  const names = fontCandidates(stack);
  const category = fontCategory(stack);
  for (const name of names.slice(0, 4))
    if (await has(name).catch(() => false))
      return { family: name, source: names[0] ?? name, exact: true, category };
  return {
    family: FONT_STAND_INS[category],
    source: names[0] ?? stack.split(",")[0]?.trim() ?? "",
    exact: false,
    category,
  };
}

const fontAvailability = new Map<
  string,
  { until: number; result: Promise<boolean> }
>();
/** Public stylesheet lookup only; no font assets or account credentials are downloaded here. */
export function googleFontAvailable(
  family: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} -]{0,90}$/u.test(family))
    return Promise.resolve(false);
  const cached = fontAvailability.get(family);
  if (cached && cached.until > Date.now()) return cached.result;
  const result = fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`,
    {
      signal: AbortSignal.any([
        AbortSignal.timeout(6000),
        ...(signal ? [signal] : []),
      ]),
    },
  )
    .then(
      async (response) =>
        response.ok && (await response.text()).includes("@font-face"),
      () => false,
    )
    .catch(() => false);
  fontAvailability.set(family, { result, until: Date.now() + 5 * 60_000 });
  return result;
}

export type LogoCandidate = {
  from: NonNullable<Brand["logo"]>["from"];
  /** Absolute URL of the image, or the inline SVG's markup. */
  src: string;
  width: number;
  height: number;
  /** Its src, alt, class, id or aria-label mentions "logo" or the product's name. */
  named: boolean;
  /** Inside the page's header or nav, or in the top 160 px. */
  top: boolean;
};

/**
 * The best logo among the page's candidates: a named mark in the header beats a favicon, vectors
 * beat bitmaps, and bitmaps under 64 px (favicons) or huge images (hero shots) are left out.
 */
export function pickLogo(
  candidates: LogoCandidate[],
): LogoCandidate | undefined {
  const score = (c: LogoCandidate) => {
    const vector = c.from === "inline-svg" || /\.svg(\?|$)/i.test(c.src);
    if (!vector && Math.max(c.width, c.height) < 64) return -1;
    if (c.width > 900 || c.height > 400) return -1;
    if (c.from === "icon" || c.from === "apple-touch-icon")
      return c.from === "apple-touch-icon" ? 1.5 : 1;
    return (
      (c.named ? 3 : 0) +
      (c.top ? 2 : 0) +
      (vector ? 1 : 0) -
      (c.named || c.top ? 0 : 3)
    );
  };
  const ranked = candidates
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s > 0);
  ranked.sort((a, b) => b.s - a.s);
  return ranked[0]?.c;
}
