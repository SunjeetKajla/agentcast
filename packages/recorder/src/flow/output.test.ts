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

it("recognizes nested generated-audio envelopes without accepting arbitrary base64 text", () => {
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(600, 1)]).toString("base64");
  expect(audioInJson({ data: { result: { audio: wav } } })?.subarray(0, 4).toString()).toBe("RIFF");
  expect(audioInJson({ data: { output: { audio: Buffer.alloc(600, 5).toString("base64") } } })).toBeUndefined();
});

it("excludes preloads and drains action-initiated media before publishing its validated index", async () => {
  const { EventEmitter } = await import("node:events");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readArtifact } = await import("@agentcast/shared/node");
  const { OutputIndex } = await import("@agentcast/shared");
  const { watchOutputs } = await import("./output");
  const dir = await mkdtemp(join(tmpdir(), "agentcast-output-watch-"));
  try {
    const page = new EventEmitter();
    const watcher = await watchOutputs(page as unknown as import("playwright-core").Page, { dir, flowId: "f1", now: () => 1500 });
    const preloaded = { resourceType: () => "media" };
    page.emit("request", preloaded);
    watcher.beginAction("generate");
    const generated = { resourceType: () => "media" };
    page.emit("request", generated);
    watcher.endAction();
    const audio = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(3000, 1)]);
    const response = (request: typeof generated) => ({ request: () => request, headers: () => ({ "content-type": "audio/wav" }), body: async () => audio });
    page.emit("response", response(preloaded));
    const drained = watcher.stop();
    page.emit("response", response(generated));
    await drained;
    const index = await readArtifact(join(dir, "f1.json"), OutputIndex);
    expect(index.outputs).toEqual([{ file: "f1-01.wav", type: "audio/wav", t: 1.5, stepId: "generate" }]);
    expect(page.listenerCount("response")).toBe(0);
    expect(page.listenerCount("request")).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
