/** Colour helpers for the composition: readable text on any brand colour (WCAG luminance). */

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full =
    h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [
    number,
    number,
    number,
  ];
};

const toHex = (c: number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

export function luminanceOf(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export const contrastOf = (a: string, b: string) => {
  const [x, y] = [luminanceOf(a), luminanceOf(b)].sort((p, q) => q - p) as [
    number,
    number,
  ];
  return (x + 0.05) / (y + 0.05);
};

/** Text that reads on `bg`: near-black on light colours, near-white on dark ones. */
export const ink = (bg: string) =>
  luminanceOf(bg) > 0.4 ? "#0d0f0e" : "#f7f6f1";

/** `color`, pushed toward black or white until it reaches `ratio` against `bg`. */
export function readableOn(color: string, bg: string, ratio = 3): string {
  const toward = luminanceOf(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  let c = rgb(color);
  for (let i = 0; i < 12 && contrastOf(toHex(c), bg) < ratio; i++)
    c = c.map((v, k) => v + (toward[k]! - v) * 0.15) as [
      number,
      number,
      number,
    ];
  return toHex(c);
}

/** `a` mixed toward `b` by `t` (0–1), as a hex colour. */
export const mixHex = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * t));
};
