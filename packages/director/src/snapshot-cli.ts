import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Edl } from "@agentcast/shared";
import { snapshotComposition } from "@agentcast/video";
import { COMPOSITION, recompile } from "./composition.ts";

// The director's look at its own work: rebuilds the composition from edl.json (keeping its scene
// files) and saves frames at the given seconds into stills/look/. Usage: snapshot <t1,t2,…>
const dir = process.cwd();
const times = (process.argv[2] ?? "")
  .split(",")
  .map(Number)
  .filter((t) => Number.isFinite(t) && t >= 0)
  .slice(0, 16);
const edl = Edl.parse(JSON.parse(await readFile(join(dir, "edl.json"), "utf8")));
const compiled = await recompile(dir, edl);
if (!compiled) throw new Error("This workspace has no composition.");
const at = times.length ? times : compiled.scenes.map((s) => s.start + s.duration * 0.6);
const files = await snapshotComposition({
  dir: join(dir, COMPOSITION),
  outDir: join(dir, "stills", "look"),
  times: at.map((t) => Math.min(t, compiled.duration - 0.05)),
});
console.log(compiled.scenes.map((s) => `${s.id} (${s.kind}${s.custom ? ", yours" : ""}): ${s.start.toFixed(2)}–${(s.start + s.duration).toFixed(2)} s`).join("\n"));
console.log(`\nFrames (open them with Read):\n${files.join("\n")}`);
