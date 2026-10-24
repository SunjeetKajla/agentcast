import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Script, Storyboard, Voiceover, jobPaths } from "@agentcast/shared";
import { FIXTURE_JOB_DIR, readArtifact } from "@agentcast/shared/node";
import { ElevenLabs, VoiceError, type SpeakRequest } from "./client";
import { renderNarration } from "./render";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-narration-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const audio = (request: SpeakRequest) => ({
  audio: Buffer.from("audio fixture"),
  alignment: {
    characters: [...request.text],
    character_start_times_seconds: [...request.text].map((_, i) => i * 0.04),
    character_end_times_seconds: [...request.text].map(
      (_, i) => (i + 1) * 0.04,
    ),
  },
  ms: 1,
});
async function setup() {
  const storyboard = await readArtifact(
    join(FIXTURE_JOB_DIR, jobPaths.storyboard),
    Storyboard,
  );
  const script = await readArtifact(
    join(FIXTURE_JOB_DIR, jobPaths.script("en")),
    Script,
  );
  const provider = {
    subscription: vi
      .fn()
      .mockResolvedValue({ tier: "free", used: 0, limit: 10000 }),
    voice: vi.fn().mockResolvedValue({ name: "Premade", category: "premade" }),
    speak: vi.fn(async (request: SpeakRequest) => audio(request)),
  };
  return {
    provider,
    options: {
      dir,
      storyboard,
      scripts: { en: script },
      client: provider as unknown as ElevenLabs,
      voices: { en: "voice-test" },
      concurrency: 1,
      duration: async () => 20,
    },
  };
}
describe("incremental narration", () => {
  it("uses the timing fallback when a successful speech response omits alignment, then reuses it", async () => {
    const { provider, options } = await setup();
    provider.speak.mockRejectedValueOnce(
      new VoiceError("No timings", 502, "no_alignment"),
    );
    const result = await renderNarration(options);
    expect(result.voices[0]?.clips[0]?.model).toBe("eleven_multilingual_v2");
    expect(provider.speak).toHaveBeenCalledTimes(
      options.storyboard.beats.length + 1,
    );
    provider.speak.mockClear();
    await renderNarration(options);
    expect(provider.speak).not.toHaveBeenCalled();
  });
  it("saves schema-valid manifests and reuses every unchanged clip without speaking", async () => {
    const { provider, options } = await setup();
    const first = await renderNarration(options);
    const manifest = await readArtifact(
      join(dir, jobPaths.voice("en")),
      Voiceover,
    );
    expect(manifest.clips).toHaveLength(options.storyboard.beats.length);
    provider.speak.mockClear();
    const second = await renderNarration(options);
    expect(second.reused).toBe(first.voices[0]!.clips.length);
    expect(second.characters).toBe(0);
    expect(provider.speak).not.toHaveBeenCalled();
  });
  it("stops before any charge when the character allowance is insufficient", async () => {
    const { provider, options } = await setup();
    provider.subscription.mockResolvedValue({
      tier: "free",
      used: 9999,
      limit: 10000,
    });
    await expect(renderNarration(options)).rejects.toThrow("plan has 1 left");
    expect(provider.speak).not.toHaveBeenCalled();
  });
  it("retains completed clips after a later failure and resumes only the missing lines", async () => {
    const { provider, options } = await setup();
    provider.speak
      .mockImplementationOnce(async (request) => audio(request))
      .mockRejectedValueOnce(new VoiceError("quota reached", 402));
    await expect(renderNarration(options)).rejects.toThrow("quota reached");
    expect(
      (await readArtifact(join(dir, jobPaths.voice("en")), Voiceover)).clips,
    ).toHaveLength(1);
    provider.speak
      .mockReset()
      .mockImplementation(async (request) => audio(request));
    const resumed = await renderNarration(options);
    expect(resumed.reused).toBe(1);
    expect(provider.speak).toHaveBeenCalledTimes(
      options.storyboard.beats.length - 1,
    );
  });
  it("invalidates neighbouring clips when an edited line changes speech context", async () => {
    const { provider, options } = await setup();
    await renderNarration(options);
    provider.speak.mockClear();
    options.scripts.en.segments[1]!.text = "A new line.";
    await renderNarration(options);
    expect(provider.speak).toHaveBeenCalledTimes(3);
  });
});
