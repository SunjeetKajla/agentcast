import { loadDotEnv } from "../../../apps/worker/src/env.ts";
import { doctor } from "./doctor.ts";
import { runMusic } from "./music.ts";
const overridden = await loadDotEnv();
if (overridden.length)
  console.log(`.env overrode your shell's ${overridden.join(", ")}`);
if (process.argv[2] === "music") {
  await runMusic(process.argv.slice(2));
} else if (process.argv[2] !== "doctor") {
  console.error(
    "Usage: agentcast doctor [--probe] | music list | music analyze [id...] | music add <files...> [options]",
  );
  process.exitCode = 1;
} else {
  const checks = await doctor(process.argv.includes("--probe"));
  for (const check of checks)
    console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`);
  const optional = new Set(["codex", "claude-code"]);
  if (checks.some((check) => !check.ok && !optional.has(check.name)))
    process.exitCode = 1;
}
