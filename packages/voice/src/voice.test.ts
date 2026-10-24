import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  alignmentToWords,
  charErrorRate,
  checkAlignment,
  ElevenLabs,
  PREMADE,
  pickVoice,
  spokenForm,
  usableOnPlan,
  withText,
  type Alignment,
} from "./index";

const align = (text: string, perChar = 0.06): Alignment => {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * perChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * perChar),
  };
};

describe("alignment", () => {
  it("turns character timings into words, punctuation attached", () => {
    const words = alignmentToWords(align("Start here,  then  go."));
    expect(words.map((w) => w.text)).toEqual(["Start", "here,", "then", "go."]);
    expect(words[0]).toEqual({ text: "Start", start: 0, end: 0.3 });
    expect(words[1]!.start).toBeCloseTo(0.36);
  });

  it("keeps Devanagari vowel signs and viramas inside their word", () => {
    const text = "टेम्पलेट से शुरू करें";
    const words = alignmentToWords(align(text));
    expect(words.map((w) => w.text)).toEqual([
      "टेम्पलेट",
      "से",
      "शुरू",
      "करें",
    ]);
    expect(checkAlignment(text, words, 2).ok).toBe(true);
  });

  it("flags timings that would break captions", () => {
    const a = align("one two three");
    a.character_start_times_seconds[8] = 0.1; // "three" starts before "two" (0.24 s)
    const words = alignmentToWords(a);
    const check = checkAlignment("one two three four", words, 0.3);
    expect(check.ok).toBe(false);
    expect(check.problems.join("\n")).toMatch(/3 timed words for 4/);
    expect(check.problems.join("\n")).toMatch(/starts before/);
    expect(check.problems.join("\n")).toMatch(/after the audio/);
  });

  it("reads identifiers as words and maps the timings back onto them", () => {
    const line = "Log in as standard_user, then _private stays.";
    expect(spokenForm(line)).toBe(
      "Log in as standard user, then _private stays.",
    );
    const words = alignmentToWords(withText(align(spokenForm(line)), line));
    expect(words.map((w) => w.text)).toEqual([
      "Log",
      "in",
      "as",
      "standard_user,",
      "then",
      "_private",
      "stays.",
    ]);
    expect(checkAlignment(line, words).ok).toBe(true);
  });

  it("measures how far a transcript is from the line", () => {
    expect(
      charErrorRate("Start from a template.", "start from a template"),
    ).toBe(0);
    expect(charErrorRate("abcd", "abxd")).toBe(0.25);
  });
});

let server: Server | undefined;
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((r) => server!.close(r));
  server = undefined;
});

describe("ElevenLabs client", () => {
  it("sends the key as a header and decodes audio and timings", async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        expect(req.headers["xi-api-key"]).toBe("k");
        expect(req.url).toBe(
          "/v1/text-to-speech/voice-1/with-timestamps?output_format=mp3_44100_128",
        );
        expect(JSON.parse(body)).toMatchObject({
          text: "Hi there",
          model_id: "eleven_multilingual_v2",
          previous_text: "Before",
        });
        res.setHeader("request-id", "req-9");
        res.end(
          JSON.stringify({
            audio_base64: Buffer.from("mp3").toString("base64"),
            alignment: align("Hi there"),
          }),
        );
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const el = new ElevenLabs({
      apiKey: "k",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    const s = await el.speak({
      voiceId: "voice-1",
      text: "Hi there",
      previousText: "Before",
    });
    expect(s.audio.toString()).toBe("mp3");
    expect(s.requestId).toBe("req-9");
    expect(alignmentToWords(s.alignment).map((w) => w.text)).toEqual([
      "Hi",
      "there",
    ]);
  });

  it("maps API errors without retrying bad input", async () => {
    let calls = 0;
    server = createServer((_req, res) => {
      calls++;
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          detail: { status: "invalid_voice", message: "Voice not found" },
        }),
      );
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const el = new ElevenLabs({
      apiKey: "k",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    await expect(el.speak({ voiceId: "nope", text: "x" })).rejects.toThrow(
      /400 invalid_voice: Voice not found/,
    );
    expect(calls).toBe(1);
  });
});

describe("picking a voice", () => {
  const serve = async (
    voices: Record<string, { name: string; category: string }>,
  ) => {
    server = createServer((req, res) => {
      const v = voices[decodeURIComponent(req.url!.split("/").pop()!)];
      res.writeHead(v ? 200 : 404, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          v ?? {
            detail: {
              status: "voice_not_found",
              message: "A voice with that ID was not found.",
            },
          },
        ),
      );
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return new ElevenLabs({
      apiKey: "k",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
  };

  it("keeps a voice the plan can use, and swaps a library voice for a premade one on the free plan", async () => {
    const el = await serve({
      lib: { name: "Reyaansh", category: "professional" },
      mine: { name: "Me", category: "cloned" },
    });
    expect(await pickVoice(el, "hi", "lib", "starter")).toEqual({
      id: "lib",
      name: "Reyaansh",
      category: "professional",
    });
    expect(await pickVoice(el, "en", "mine", "free")).toMatchObject({
      id: "mine",
      category: "cloned",
    });
    const hi = await pickVoice(el, "hi", "lib", "free");
    expect(hi).toMatchObject({ id: PREMADE.hi!.id, name: "Brian" });
    expect(hi.fellBack).toMatch(
      /professional voice, which the free plan can't use/,
    );
    expect((await pickVoice(el, "pt-BR", "gone", "free")).fellBack).toMatch(
      /wasn't found/,
    );
    expect((await pickVoice(el, "en", undefined, "free")).name).toBe("Bella");
    expect(usableOnPlan("free", "premade")).toBe(true);
  });
});
