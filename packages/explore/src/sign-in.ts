import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { SessionState } from "./artifacts";
import { productEntry } from "./access";

export type SignInOptions = {
  url: string;
  profileDir: string;
  signal?: AbortSignal;
  done?: Promise<void>;
  onOpen?: (window: { pid: number | undefined }) => void;
  timeoutMs?: number;
  executable?: string;
  /** Only for the local fixture test; real sign-in always opens a visible, ordinary window. */
  headless?: boolean;
  flushMs?: number;
};
const openProfiles = new Set<string>();

async function chromeExecutable(override?: string) {
  const candidates = [
    override,
    process.env.AGENTCAST_CHROME,
    "/opt/google/chrome/chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    chromium.executablePath(),
  ].filter((value): value is string => Boolean(value));
  for (const file of candidates)
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      return file;
  throw new Error(
    "Chrome is unavailable. Install Chrome or set AGENTCAST_CHROME to its executable path.",
  );
}
async function profileBusy(dir: string) {
  const lock = await readlink(join(dir, "SingletonLock")).catch(() => "");
  const pid = Number(lock.split("-").pop());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Nothing controls the sign-in window. Automation starts only after the user closes it. */
export async function signInLocally(
  options: SignInOptions,
): Promise<SessionState> {
  options.signal?.throwIfAborted();
  productEntry(options.url, options.url);
  if (openProfiles.has(options.profileDir))
    throw new Error("A sign-in window for this site is already open.");
  openProfiles.add(options.profileDir);
  try {
    return await signIn(options);
  } finally {
    openProfiles.delete(options.profileDir);
  }
}

async function signIn(options: SignInOptions): Promise<SessionState> {
  const executable = await chromeExecutable(options.executable);
  if (await profileBusy(options.profileDir))
    throw new Error(
      "Close the existing AgentCast sign-in window for this site before retrying.",
    );
  const profile = join(options.profileDir, "Default");
  await mkdir(profile, { recursive: true, mode: 0o700 });
  // Chrome otherwise discards session-only cookies when its window closes.
  const preferences = join(profile, "Preferences");
  const prefs = JSON.parse(
    await readFile(preferences, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "{}";
    }),
  ) as { session?: Record<string, unknown> };
  prefs.session = { ...prefs.session, restore_on_startup: 1 };
  await writeFile(preferences, JSON.stringify(prefs), { mode: 0o600 });
  await rm(join(profile, "Sessions"), { recursive: true, force: true });
  options.signal?.throwIfAborted();
  const child = spawn(
    executable,
    [
      `--user-data-dir=${options.profileDir}`,
      "--password-store=basic",
      "--no-first-run",
      "--no-default-browser-check",
      ...(options.headless ? ["--headless=new"] : []),
      options.url,
    ],
    { stdio: "ignore" },
  );
  let gone = false;
  let failed = false;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      gone = true;
      resolve();
    });
    child.once("error", () => {
      gone = true;
      failed = true;
      resolve();
    });
  });
  const quit = async () => {
    if (gone) return;
    child.kill("SIGTERM");
    await Promise.race([exited, delay(10_000, undefined, { ref: false })]);
    if (!gone) child.kill("SIGKILL");
    await exited;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (reason: "done" | "cancelled" | "timeout") => void = () => {};
  const abort = () => stop("cancelled");
  try {
    const stopped = new Promise<"done" | "cancelled" | "timeout">((resolve) => {
      stop = resolve;
      timer = setTimeout(
        () => resolve("timeout"),
        options.timeoutMs ?? 15 * 60_000,
      );
      timer.unref();
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      void options.done?.then(
        () => resolve("done"),
        () => resolve("cancelled"),
      );
    });
    await options.onOpen?.({ pid: child.pid });
    const why = await Promise.race([
      stopped,
      exited.then(() => "closed" as const),
    ]);
    if (why === "done" && !gone) {
      const since = Date.now();
      // Cookie writes are batched for up to 30 seconds. Observe disk flush or user closure.
      const deadline = since + (options.flushMs ?? 31_000);
      while (!gone && Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const times = await Promise.all(
          [
            "Cookies",
            "Cookies-journal",
            "Network/Cookies",
            "Network/Cookies-journal",
          ].map((file) =>
            stat(join(profile, file)).then(
              (info) => info.mtimeMs,
              () => 0,
            ),
          ),
        );
        if (Math.max(...times) > since) break;
        await delay(250, undefined, { signal: options.signal });
      }
    }
    await quit();
    options.signal?.throwIfAborted();
    if (why === "timeout")
      throw new Error(
        "Sign-in timed out. Open a new sign-in window and try again.",
      );
    if (why === "cancelled") throw new Error("Sign-in was cancelled.");
    if (failed) throw new Error("Chrome could not open the sign-in window.");
    if (await profileBusy(options.profileDir))
      throw new Error(
        "The sign-in profile is still open in another Chrome process.",
      );
    await rm(join(profile, "Sessions"), { recursive: true, force: true });
    const context = await chromium.launchPersistentContext(options.profileDir, {
      executablePath: executable,
      headless: true,
      args: ["--password-store=basic"],
    });
    const close = () => void context.close().catch(() => {});
    options.signal?.addEventListener("abort", close, { once: true });
    try {
      options.signal?.throwIfAborted();
      // Read localStorage without running the real site, which could invalidate a fresh session.
      await context.route("**/*", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>AgentCast session capture</title>",
        }),
      );
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(new URL(options.url).origin + "/", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      const state = SessionState.parse(await context.storageState());
      if (
        !state.cookies.length &&
        !state.origins.some((origin) => origin.localStorage.length)
      )
        throw new Error(
          "Chrome did not save a product session. Wait for your dashboard before finishing sign-in.",
        );
      return state;
    } finally {
      options.signal?.removeEventListener("abort", close);
      await context.close();
    }
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    await quit();
  }
}
