import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { run } from "./spawn";

it.skipIf(process.platform === "win32")(
  "force-kills an uncooperative CLI and its descendants immediately on cancellation",
  async () => {
    const abort = new AbortController();
    const pids = new Set<number>();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const descendant = `process.on('SIGTERM', () => {}); console.log(JSON.stringify({pid:process.pid})); setInterval(() => {}, 1000);`;
    const parent = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); console.log(JSON.stringify({pid:process.pid})); spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'}); setInterval(()=>{},1000);`;
    const work = run({
      cmd: process.execPath,
      args: ["-e", parent],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10_000,
      signal: abort.signal,
      label: "fixture CLI",
      onLine: (line) => {
        pids.add(JSON.parse(line).pid);
        if (pids.size === 2) ready();
      },
    });
    // Attach a rejection handler before delivering the abort.
    const result = work.then(
      () => null,
      (error) => error,
    );
    try {
      await Promise.race([
        started,
        delay(3000).then(() => {
          throw new Error("Fixture process did not start");
        }),
      ]);
      const start = performance.now();
      abort.abort();
      expect(await result).toMatchObject({ code: "llm.cancelled" });
      expect(performance.now() - start).toBeLessThan(500);
      for (const pid of pids) {
        const state = await readFile(`/proc/${pid}/stat`, "utf8").then(
          (text) => text.slice(text.lastIndexOf(")") + 2).split(" ")[0],
          () => undefined,
        );
        expect(state === undefined || state === "Z" || state === "X").toBe(
          true,
        );
      }
    } finally {
      abort.abort();
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      await result;
    }
  },
  10_000,
);
