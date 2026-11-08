import { describe, expect, it } from "vitest";
import { inkSpans, splitLogo, svgProblems } from "./logokit";
import { pagesToCapture } from "./captures";

/** A white RGBA image with dark blocks at the given column ranges. */
const image = (w: number, h: number, blocks: [number, number][]) => {
  const px = new Uint8Array(w * h * 4).fill(255);
  for (const [a, b] of blocks) for (let y = 2; y < h - 2; y++) for (let x = a; x < b; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
  return px;
};

describe("the logo kit", () => {
  it("finds the ink's column runs against the background it was captured on", () => {
    expect(inkSpans(image(100, 20, [[10, 20], [30, 45]]), 100, 20)).toEqual([[10, 20], [30, 45]]);
  });

  it("reads the background from the border, even when the letters are the commonest colour", () => {
    const w = 60;
    const h = 20;
    const px = new Uint8Array(w * h * 4);
    // A peach gradient, mostly covered by two heavy letters.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([250 - (x >> 2), 225 - (y >> 1), 210, 255], (y * w + x) * 4);
    for (const [a, b] of [[4, 28], [32, 56]]) for (let y = 1; y < h - 1; y++) for (let x = a!; x < b!; x++) px.set([0, 0, 0, 255], (y * w + x) * 4);
    expect(inkSpans(px, w, h)).toEqual([[4, 28], [32, 56]]);
  });

  it("keys out only a background the crop shows evenly", async () => {
    const { cutOut } = await import("./logokit");
    const { mkdtemp, writeFile: write } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: at } = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const dir = await mkdtemp(at(tmpdir(), "agentcast-cut-"));
    const make = (name: string, filter: string) => promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", filter, "-frames:v", "1", at(dir, name)]);
    // White letters on dark with a margin: keyed. A tight crop whose border is half ink: left alone.
    await make("margin.png", "color=c=0x08090a:s=120x40,drawbox=x=20:y=10:w=80:h=20:color=white:t=fill");
    await make("tight.png", "color=c=0x08090a:s=120x40,drawbox=x=0:y=0:w=60:h=40:color=white:t=fill");
    expect(await cutOut(at(dir, "margin.png"), at(dir, "margin-cut.png"))).toBe(true);
    expect(await cutOut(at(dir, "tight.png"), at(dir, "tight-cut.png"))).toBe(false);
    void write;
  });

  it("tells a symbol from a name by the gap after it", () => {
    // A 100×100 symbol, a wide gap, then six letters 7 px apart (Linear, at the scale of its viewBox).
    const linear = splitLogo([[0, 100], [146, 189], [195, 208], [217, 262], [269, 316], [321, 364], [373, 400]], 400, 100);
    expect(linear.kind).toBe("mark+wordmark");
    expect(linear.mark).toEqual([0, 0.25]);
    expect(linear.letters).toHaveLength(6);
    // Letters only, evenly spaced (Sarvam).
    const sarvam = splitLogo([[0, 60], [64, 127], [136, 174], [177, 302], [310, 403]], 404, 64);
    expect(sarvam).toMatchObject({ kind: "wordmark", letters: { length: 5 } });
    expect(splitLogo([[10, 90]], 100, 100)).toMatchObject({ kind: "mark", letters: [] });
  });

  it("keeps an SVG only when it has nothing active or external in it", () => {
    expect(svgProblems('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="url(#g)"></path></svg>')).toEqual([]);
    expect(svgProblems('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>')).not.toEqual([]);
    expect(svgProblems('<svg viewBox="0 0 1 1"><path onload="x()"></path></svg>')).not.toEqual([]);
    expect(svgProblems('<svg viewBox="0 0 1 1"><image href="https://x.example/a.png"></image></svg>')).not.toEqual([]);
  });

  it("captures only the site's own pages, without accounts, legal pages or repeats", () => {
    const links = ["/pricing", "/pricing/", "https://other.example/x", "/login", "/privacy", "/customers", "/docs/a.pdf", "/contact", "/docs", "/help/center", "#top"];
    expect(pagesToCapture(links, "https://x.example/")).toEqual(["https://x.example/pricing", "https://x.example/customers"]);
  });
});
