import { spawn } from "node:child_process";
import { LlmError } from "./errors.ts";

export type RunResult = { code: number | null; stdout: string; stderr: string };

/**
 * Runs a CLI without blocking (AGENTS.md rule 4): prompt on stdin, stdout line by line to onLine,
 * the whole process group killed on timeout or abort.
 */
export function run(opts: {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  label: string;
}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new LlmError("llm.cancelled", `${opts.label} cancelled`));
    const child = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let stopped: LlmError | undefined;

    const kill = (reason: LlmError, immediate = false) => {
      stopped ??= reason;
      try {
        const signal = immediate ? "SIGKILL" : "SIGTERM";
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
      if (immediate) return;
      setTimeout(() => {
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 3000).unref();
    };
    const timer = setTimeout(
      () => kill(new LlmError("llm.timeout", `${opts.label} timed out after ${Math.round(opts.timeoutMs / 1000)} s`)),
      opts.timeoutMs,
    );
    const onAbort = () => kill(new LlmError("llm.cancelled", `${opts.label} cancelled`), true);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!opts.onLine) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) if (line.trim()) opts.onLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-64_000);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(
        err.code === "ENOENT"
          ? new LlmError("llm.unavailable", `${opts.cmd} isn't installed or isn't on PATH`)
          : new LlmError("llm.failed", `${opts.label}: ${err.message}`),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.onLine && pending.trim()) opts.onLine(pending);
      if (stopped) reject(stopped);
      else resolve({ code, stdout, stderr });
    });

    child.stdin.on("error", () => {}); // the CLI may exit before reading all of stdin
    child.stdin.end(opts.input ?? "");
  });
}
