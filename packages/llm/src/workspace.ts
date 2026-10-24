import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { LlmError } from "./errors.ts";

// What an agent with no shell gets to see of its workspace (Codex): the text files, and images to attach.
// Hidden files, node_modules and symlinks (which could point outside the workspace) are left out.

const TEXT = new Set([".json", ".md", ".txt", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".yaml", ".yml", ".toml", ".csv", ".srt", ".vtt", ".svg"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export const MAX_WORKSPACE_TEXT = 2 * 1024 * 1024;
const MAX_IMAGES = 20;

export type Snapshot = { files: { path: string; content: string }[]; images: string[] };

export async function snapshot(root: string): Promise<Snapshot> {
  const files: Snapshot["files"] = [];
  const images: string[] = [];
  let bytes = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (IMAGE.has(ext) && images.length < MAX_IMAGES) images.push(full);
      if (!TEXT.has(ext)) continue;
      bytes += (await stat(full)).size;
      if (bytes > MAX_WORKSPACE_TEXT) {
        throw new LlmError("llm.failed", `the workspace's text files are over ${MAX_WORKSPACE_TEXT / 1024 / 1024} MiB`);
      }
      files.push({ path: relative(root, full).split("\\").join("/"), content: await readFile(full, "utf8") });
    }
  };
  await walk(root);
  return { files, images };
}

/** The files as one JSON record per line, so file content can't break out of the block. */
export function renderSnapshot(snap: Snapshot): string {
  const records = snap.files.map((f) => JSON.stringify(f)).join("\n");
  return `<workspace_files>\n${records}\n</workspace_files>`;
}
