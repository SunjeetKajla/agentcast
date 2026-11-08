import { describe, expect, it } from "vitest";
import { brandColours, mergeColours, objectsIn, sameObject } from "./imagery";

/** A white picture with discs painted on it (later discs on top), then boxes over them. */
function picture(w: number, h: number, discs: { x: number; y: number; r: number; c: [number, number, number] }[], boxes: { x: number; y: number; w: number; h: number; c: [number, number, number] }[] = []) {
  const rgba = new Uint8Array(w * h * 4).fill(255);
  const paint = (x: number, y: number, c: [number, number, number]) => rgba.set([...c, 255], (y * w + x) * 4);
  for (const d of discs)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r ** 2) paint(x, y, d.c);
  for (const b of boxes) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) paint(x, y, b.c);
  return { rgba, w, h };
}

describe("brand imagery", () => {
  it("finds a free-standing orb and calls it round", () => {
    const found = objectsIn(picture(400, 300, [{ x: 200, y: 150, r: 40, c: [200, 40, 120] }]));
    expect(found).toHaveLength(1);
    expect(found[0]!.round).toBe(true);
    expect(found[0]!.colour).toBe("#c82878");
  });

  it("splits orbs that touch, even in the same colour", () => {
    const found = objectsIn(
      picture(400, 300, [
        { x: 140, y: 150, r: 50, c: [200, 40, 120] },
        { x: 225, y: 150, r: 40, c: [200, 40, 120] },
        { x: 290, y: 150, r: 30, c: [200, 40, 120] },
      ]),
    );
    expect(found.length).toBe(3);
  });

  it("leaves out a glow on the edge, a clipped orb and a coloured bar of type", () => {
    const found = objectsIn(
      picture(
        400,
        300,
        [
          { x: 0, y: 0, r: 60, c: [240, 150, 80] }, // glow in the corner
          { x: 300, y: 200, r: 40, c: [60, 60, 200] }, // clipped by the card below
        ],
        [
          { x: 320, y: 140, w: 80, h: 160, c: [255, 255, 255] },
          { x: 40, y: 250, w: 200, h: 8, c: [40, 160, 80] },
        ],
      ),
    );
    expect(found).toEqual([]);
  });

  it("reads a brand's colours and none from a grey page", () => {
    const pic = picture(400, 300, [
      { x: 100, y: 150, r: 50, c: [200, 40, 120] },
      { x: 300, y: 150, r: 50, c: [150, 200, 80] },
    ]);
    expect(brandColours(pic)).toHaveLength(2);
    expect(brandColours(picture(400, 300, [{ x: 200, y: 150, r: 60, c: [120, 120, 120] }]))).toEqual([]);
  });

  it("knows the same object seen twice and merges colour lists", () => {
    expect(sameObject({ colour: "#c82878", w: 80, h: 80 }, { colour: "#c52a7a", w: 90, h: 88 })).toBe(true);
    expect(sameObject({ colour: "#c82878", w: 80, h: 80 }, { colour: "#98c854", w: 80, h: 80 })).toBe(false);
    expect(mergeColours([["#c82878", "#98c854"], ["#ca2a7a"], ["#3040c0"]])).toEqual(["#c82878", "#98c854", "#3040c0"]);
  });
});
