/** Decode SSE data events, including UTF-8 and CRLF split across transport chunks. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  signal?.throwIfAborted();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const abort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  let pending = "";
  let lines: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      pending += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (pending.length > 1_048_576)
        throw new Error("SSE event exceeded its size limit.");
      for (;;) {
        const match = /\r\n|\r|\n/.exec(pending);
        if (
          !match ||
          (!done && match[0] === "\r" && match.index === pending.length - 1)
        )
          break;
        const line = pending.slice(0, match.index);
        pending = pending.slice(match.index + match[0].length);
        if (line === "") {
          if (lines.length) yield lines.join("\n");
          lines = [];
          bytes = 0;
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).replace(/^ /, "");
          bytes += data.length;
          if (bytes > 1_048_576)
            throw new Error("SSE event exceeded its size limit.");
          lines.push(data);
        }
      }
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
