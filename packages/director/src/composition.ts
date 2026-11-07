import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Edl } from "@agentcast/shared";
import { checkComposition, compileComposition, type VideoInput } from "@agentcast/video";

// The director's composition (PRD §9.7.5): render/composition/ is the HyperFrames project compiled
// from edl.json, and the director may rewrite any scene file in it. These recompile it from the
// current edit (keeping the scene files the director changed) and check the scene contract.

export type Issue = { severity: "error" | "warn"; at: string; message: string };

export const COMPOSITION = "composition";
const INPUT = "composition/input.json";

/** The render input without its edit, saved by prepareWorkspace (paths relative to the job folder). */
export type SavedInput = Omit<VideoInput, "edl">;

export async function savedInput(dir: string): Promise<SavedInput | undefined> {
  return readFile(join(dir, INPUT), "utf8").then(
    (text) => JSON.parse(text) as SavedInput,
    () => undefined,
  );
}

/** Rebuilds composition/ from `edl`, keeping the director's scene files. The job folder is the workspace's parent. */
export async function recompile(dir: string, edl: Edl, signal?: AbortSignal) {
  const input = await savedInput(dir);
  if (!input) return undefined;
  const out = join(dir, COMPOSITION);
  return compileComposition({
    input: { ...input, edl },
    root: dirname(dir),
    out,
    scenes: join(out, "compositions"),
    ...(signal ? { signal } : {}),
  });
}

const sha = (text: string) => createHash("sha1").update(text).digest("hex");

/** The scene files the director wrote or changed (their hash isn't the catalogue's). */
export async function customScenes(dir: string): Promise<Map<string, string>> {
  const scenes = join(dir, COMPOSITION, "compositions");
  const compiled = await readFile(join(dir, COMPOSITION, "compiled.json"), "utf8").then(
    (text) => JSON.parse(text) as Record<string, string>,
    () => ({}) as Record<string, string>,
  );
  const out = new Map<string, string>();
  for (const name of (await readdir(scenes).catch(() => [] as string[])).filter((n) => n.endsWith(".html"))) {
    const text = await readFile(join(scenes, name), "utf8");
    const id = name.slice(0, -".html".length);
    if (compiled[id] !== sha(text)) out.set(id, text);
  }
  return out;
}

/** Ways out of the sandbox a scene must never take (FR-79). */
const NETWORK = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|import\s*\()/;
/** Anything that makes a frame depend on more than time. */
const CLOCKS = /\b(Date\.now|new Date\s*\(|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame)\b|repeat\s*:\s*-1/;
/** A URL that leaves the composition (the SVG namespace is the one exception). */
const REMOTE = /(?:https?:)?\/\/(?!www\.w3\.org\/)[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * The scene contract for one file the director wrote (PRD §9.7.5): a sub-composition under its own id,
 * one registered timeline, no network, no clocks or randomness, local files only, no secrets.
 */
export function sceneIssues(id: string, text: string, secrets: string[] = []): Issue[] {
  const at = `composition/compositions/${id}.html`;
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ severity: "error", at, message });
  if (!/^\s*<template>/.test(text)) err("a scene file starts with <template> and keeps everything inside it");
  if (!text.includes(`data-composition-id="${id}"`)) err(`its root needs data-composition-id="${id}" (the file's name)`);
  if (!new RegExp(`__timelines\\[\\s*["']${id}["']\\s*\\]\\s*=|AC\\.scene\\(\\s*["']${id}["']`).test(text))
    err(`register one paused timeline as window.__timelines["${id}"] (or use AC.scene("${id}") and S.done())`);
  const net = NETWORK.exec(text);
  if (net) err(`no network access in a scene (found "${net[1]}")`);
  const clock = CLOCKS.exec(text);
  if (clock) err(`no clocks, timers or randomness: everything is a tween on the timeline (found "${clock[0]}")`);
  const remote = REMOTE.exec(text);
  if (remote) err(`only files in assets/ (found "${remote[0]}")`);
  for (const m of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g))
    if (!/^(assets\/|#|data:image\/)/.test(m[1]!)) err(`"${m[1]}" isn't in assets/`);
  for (const secret of secrets) if (secret.length >= 4 && text.includes(secret)) err("contains a secret value: remove it");
  return issues;
}

/** The contract over every scene the director wrote, plus a file for each `scene` segment. */
export async function checkScenes(dir: string, edl: Edl, secrets: string[] = []): Promise<Issue[]> {
  const custom = await customScenes(dir);
  const issues = [...custom].flatMap(([id, text]) => sceneIssues(id, text, secrets));
  edl.segments.forEach((s, i) => {
    if (s.kind === "scene" && !custom.has(s.id))
      issues.push({
        severity: "error",
        at: `segments[${i}] (${s.id})`,
        message: `a scene segment needs its file: composition/compositions/${s.id}.html`,
      });
  });
  return issues;
}

/** Recompiles and runs `hyperframes check`; its errors (and the director's scenes' warnings) as issues. */
export async function checkRender(dir: string, edl: Edl, signal?: AbortSignal): Promise<Issue[]> {
  const compiled = await recompile(dir, edl, signal);
  if (!compiled) return [];
  const custom = new Set(compiled.scenes.filter((s) => s.custom).map((s) => s.id));
  const { findings } = await checkComposition(join(dir, COMPOSITION), signal);
  return findings
    .filter((f) => f.severity === "error" || [...custom].some((id) => f.file?.includes(`${id}.html`) || f.selector?.includes(id)))
    .map((f) => ({
      severity: f.severity === "error" ? ("error" as const) : ("warn" as const),
      at: f.file ? `composition/${f.file.replace(/^.*?compositions\//, "compositions/")}` : `composition (${f.section})`,
      message: `${f.code}: ${f.message}${f.selector ? ` [${f.selector}]` : ""}${f.at !== undefined ? ` at ${f.at}s` : ""}`,
    }));
}
