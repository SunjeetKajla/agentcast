import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// The pinned HyperFrames CLI as a child process (PRD §9.8): telemetry, update checks and skill installs
// off, frames described by no model, chrome-headless-shell for deterministic BeginFrame capture.

const require = createRequire(import.meta.url);

/** The CLI entry of the installed (pinned) `hyperframes` package. */
function cliPath(): string {
  const pkg = require.resolve("hyperframes/package.json");
  const { bin } = require(pkg) as { bin: string | Record<string, string> };
  return join(dirname(pkg), typeof bin === "string" ? bin : bin.hyperframes!);
}

export const agentcastHome = () => process.env.AGENTCAST_HOME ?? join(homedir(), ".agentcast");

/** chrome-headless-shell under ~/.agentcast/browsers (`agentcast doctor` installs it), newest first. */
async function headlessShell(): Promise<string | undefined> {
  if (process.env.HYPERFRAMES_BROWSER_PATH) return process.env.HYPERFRAMES_BROWSER_PATH;
  const root = join(agentcastHome(), "browsers", "chrome-headless-shell");
  const versions = await readdir(root).catch(() => [] as string[]);
  const newest = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  return newest ? join(root, newest, "chrome-headless-shell-linux64", "chrome-headless-shell") : undefined;
}

async function env(): Promise<NodeJS.ProcessEnv> {
  const browser = await headlessShell();
  const out: NodeJS.ProcessEnv = {
    ...process.env,
    HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_NO_CAPTURE_DOTENV: "1",
    NO_COLOR: "1",
    ...(browser ? { HYPERFRAMES_BROWSER_PATH: browser } : {}),
  };
  // Frames are never sent to another model (rule 1).
  delete out.GEMINI_API_KEY;
  delete out.HYPERFRAMES_API_KEY;
  return out;
}

export class HyperframesError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
  }
}

/**
 * Runs `hyperframes <args>` in `cwd`. Resolves with stdout; rejects with the tail of the output when it
 * exits non-zero (unless `allowFailure`), and kills it when `signal` aborts.
 */
export async function hyperframes(
  args: string[],
  o: { cwd: string; signal?: AbortSignal; onLine?: (line: string) => void; allowFailure?: boolean },
): Promise<{ stdout: string; stderr: string; code: number }> {
  o.signal?.throwIfAborted();
  const child = spawn(process.execPath, [cliPath(), ...args], {
    cwd: o.cwd,
    env: await env(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const kill = () => child.kill("SIGTERM");
  o.signal?.addEventListener("abort", kill, { once: true });
  let stdout = "";
  let stderr = "";
  let partial = "";
  const lines = (chunk: string) => {
    partial += chunk;
    const parts = partial.split(/\r|\n/);
    partial = parts.pop() ?? "";
    for (const line of parts) if (line.trim()) o.onLine?.(line);
  };
  child.stdout.setEncoding("utf8").on("data", (c: string) => ((stdout += c), lines(c)));
  child.stderr.setEncoding("utf8").on("data", (c: string) => ((stderr += c), lines(c)));
  try {
    const code = await new Promise<number>((done, fail) => {
      child.on("error", fail);
      child.on("close", (c) => done(c ?? 1));
    });
    o.signal?.throwIfAborted();
    if (code !== 0 && !o.allowFailure)
      throw new HyperframesError(
        `hyperframes ${args[0]} failed (${code}): ${(stderr || stdout).trim().split("\n").slice(-6).join(" | ")}`,
        stdout + stderr,
      );
    return { stdout, stderr, code };
  } finally {
    o.signal?.removeEventListener("abort", kill);
  }
}
