import { tmpdir } from "node:os";
import { run } from "./spawn.ts";
import type { Detection } from "./types.ts";

/** The binary to run: AGENTCAST_CLAUDE_BIN / AGENTCAST_CODEX_BIN, else the name on PATH. A .mjs/.js path runs with node (the tests' fake CLIs). */
export function command(bin: string, args: string[]): { cmd: string; args: string[] } {
  return /\.m?js$/.test(bin) ? { cmd: process.execPath, args: [bin, ...args] } : { cmd: bin, args };
}

const parseVersion = (text: string) => /(\d+)\.(\d+)\.(\d+)/.exec(text);

/** `<bin> --version`, optionally with a minimum version. */
export async function detectCli(opts: {
  bin: string;
  env: NodeJS.ProcessEnv;
  label: string;
  min?: [number, number, number];
}): Promise<Detection> {
  try {
    const { cmd, args } = command(opts.bin, ["--version"]);
    const r = await run({ cmd, args, cwd: tmpdir(), env: opts.env, timeoutMs: 15_000, label: opts.label });
    const m = parseVersion(r.stdout + r.stderr);
    if (r.code !== 0 || !m) return { ok: false, reason: `${opts.bin} --version failed` };
    const version = m.slice(1, 4).map(Number) as [number, number, number];
    if (opts.min && compare(version, opts.min) < 0) {
      return { ok: false, reason: `${opts.label} ${version.join(".")} is too old; need ${opts.min.join(".")}+` };
    }
    return { ok: true, version: version.join(".") };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
