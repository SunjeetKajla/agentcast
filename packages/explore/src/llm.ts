import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { z } from "zod";
import {
  sharedLlm,
  untrusted,
  UNTRUSTED_RULE,
  type Llm as Runner,
  type OnEvent,
} from "@agentcast/llm";

/** Input files are an implementation detail of these pure package functions. */
export interface Llm {
  json<T>(task: {
    prompt: string;
    schema: z.ZodType<T>;
    tier: "fast" | "smart";
    cwd: string;
    files?: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<T>;
}

/** Adapt the old file-oriented calls to the new runner's prompt/images contract. */
export function workspaceLlm(
  runner: Pick<Runner, "json">,
  onEvent?: OnEvent,
): Llm {
  return {
    async json(task) {
      const root = await realpath(task.cwd);
      const data: string[] = [];
      const images: string[] = [];
      let bytes = 0;
      for (const name of task.files ?? []) {
        task.signal?.throwIfAborted();
        const file = await realpath(resolve(root, name));
        if (!file.startsWith(root + sep))
          throw new Error("LLM input must stay inside its task directory.");
        const info = await stat(file);
        if (!info.isFile()) throw new Error("LLM input is not a regular file.");
        if (/\.(png|jpe?g|webp)$/i.test(extname(file))) {
          images.push(file);
          continue;
        }
        bytes += info.size;
        if (bytes > 1_000_000)
          throw new Error("LLM task inputs exceed the 1 MB text budget.");
        data.push(untrusted(name, await readFile(file, "utf8")));
      }
      const result = await runner.json(
        {
          prompt: [UNTRUSTED_RULE, task.prompt, ...data].join("\n\n"),
          schema: task.schema,
          tier: task.tier,
          images,
          timeoutMs: task.timeoutMs,
          signal: task.signal,
        },
        onEvent,
      );
      return task.schema.parse(result);
    },
  };
}
export async function availableLlm(): Promise<Llm> {
  return workspaceLlm(sharedLlm());
}
