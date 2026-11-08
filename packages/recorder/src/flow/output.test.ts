import { describe, expect, it } from "vitest";
import { audioInJson } from "./output.ts";

describe("the product's output", () => {
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(600, 1)]);
  it("finds base64 audio in the usual API shapes, and only real audio", () => {
    expect(audioInJson({ audios: [wav.toString("base64")] })?.subarray(0, 4).toString()).toBe("RIFF");
    expect(audioInJson({ audio: `data:audio/wav;base64,${wav.toString("base64")}` })?.length).toBe(wav.length);
    expect(audioInJson({ audioContent: Buffer.alloc(600, 7).toString("base64") })).toBeUndefined();
    expect(audioInJson({ text: "hello" })).toBeUndefined();
  });
});
