import { afterEach, describe, expect, it, vi } from "vitest";
import { googleFontAvailable } from "./brand";

afterEach(() => vi.unstubAllGlobals());
describe("matching the product font", () => {
  it("checks arbitrary families rather than a fixed shortlist, and reuses a successful check", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('@font-face { font-family: "A New Family"; }'),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await googleFontAvailable("A New Family")).toBe(true);
    expect(await googleFontAvailable("A New Family")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://fonts.googleapis.com/css2?family=A%20New%20Family&display=swap",
    );
  });
  it("falls back when a font is unavailable and rejects non-family input before HTTP", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("Not found", { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    expect(await googleFontAvailable("Unavailable Family")).toBe(false);
    expect(await googleFontAvailable("https://example.com/font")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
