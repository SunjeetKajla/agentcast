import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browserPython } from "@agentcast/browser";
import { sharedLlm } from "@agentcast/llm";
import { z } from "zod";
const exec = promisify(execFile);
export async function doctor(probe = false) {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({
    name: "Node",
    ok: Number(process.versions.node.split(".")[0]) >= 22,
    detail: process.versions.node,
  });
  for (const [name, command, args] of [
    [
      "Browser Harness",
      browserPython(),
      [
        "-c",
        'import sys; from importlib.metadata import version; assert sys.version_info[:2] == (3,12); assert version("browser-harness") == "0.1.13"; print("Python 3.12 / Browser Harness 0.1.13")',
      ],
    ],
    ["ffmpeg", "ffmpeg", ["-version"]],
  ] as const) {
    try {
      const r = await exec(command, [...args], { timeout: 15000 });
      checks.push({
        name,
        ok: true,
        detail: r.stdout.split("\n")[0] ?? "available",
      });
    } catch {
      checks.push({
        name,
        ok: false,
        detail:
          name === "Browser Harness"
            ? "Run pnpm --filter @agentcast/browser setup."
            : `${command} unavailable`,
      });
    }
  }
  let chrome: { name: string; ok: boolean; detail: string } = {
    name: "Chrome",
    ok: false,
    detail: "Install Google Chrome or set CHROME_PATH.",
  };
  for (const binary of process.env.CHROME_PATH
    ? [process.env.CHROME_PATH]
    : [
        "google-chrome",
        "google-chrome-stable",
        "/opt/google/chrome/chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ]) {
    try {
      const result = await exec(binary, ["--version"], { timeout: 5000 });
      chrome = { name: "Chrome", ok: true, detail: result.stdout.trim() };
      break;
    } catch {}
  }
  checks.push(chrome);
  const llm = sharedLlm();
  const backends = await llm.detectAll();
  for (const [name, state] of Object.entries(backends))
    checks.push({
      name,
      ok: state.ok,
      detail: state.ok ? state.version : state.reason,
    });
  try {
    const resolved = await llm.resolve("smart");
    checks.push({ name: "Selected LLM", ok: true, detail: resolved.backend });
    if (probe) {
      await llm.json({
        prompt: 'Return {"ok":true}.',
        schema: z.object({ ok: z.literal(true) }),
        tier: "smart",
      });
      checks.push({
        name: "Login probe",
        ok: true,
        detail: "Structured response validated",
      });
    }
  } catch (error) {
    checks.push({
      name: "Selected LLM",
      ok: false,
      detail: (error as Error).message,
    });
  }
  return checks;
}
