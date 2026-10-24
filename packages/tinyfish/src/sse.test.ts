import { describe, expect, it } from "vitest";
import { readSse } from "./sse";

describe("SSE transport boundaries", () => {
  it("decodes UTF-8 and CRLF split byte by byte, preserving multiline event data", async () => {
    const bytes = new TextEncoder().encode(
      ": comment\r\ndata: नमस्ते\r\ndata: second line\r\n\r\ndata: final\n\n",
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const data of readSse(stream)) events.push(data);
    expect(events).toEqual(["नमस्ते\nsecond line", "final"]);
  });
  it("cancels a stalled reader when the job is aborted", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const pending = readSse(stream, controller.signal).next();
    controller.abort(new Error("fixture abort"));
    await expect(pending).rejects.toThrow("fixture abort");
    expect(cancelled).toBe(true);
  });
  it("bounds event size even when data is split into many short lines", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const line = new TextEncoder().encode(
          "data: " + "x".repeat(1024) + "\n",
        );
        for (let i = 0; i < 1025; i++) controller.enqueue(line);
        controller.close();
      },
    });
    await expect(readSse(stream).next()).rejects.toThrow("size limit");
  });
});
