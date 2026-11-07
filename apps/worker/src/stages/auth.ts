import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AuthState,
  SessionState,
  siteOf,
  recorderAdapter,
  fixtureStages,
  type BrowserAdapter,
} from "@agentcast/explore";
import type { StageContext } from "../context.ts";
import type { StageFn } from "./types.ts";
import { pretend } from "./stub.ts";

const localHome = () => {
  const value = process.env.AGENTCAST_HOME || "~/.agentcast";
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
};
async function key() {
  if (process.env.AGENTCAST_SECRET)
    return createHash("sha256").update(process.env.AGENTCAST_SECRET).digest();
  const file = join(localHome(), "secret.key");
  await mkdir(localHome(), { recursive: true, mode: 0o700 });
  await writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 }).catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    },
  );
  const value = await readFile(file);
  if (value.length !== 32) throw new Error("The local session key is invalid.");
  return value;
}
export async function sessionFor(
  ctx: Pick<StageContext, "dir" | "config">,
): Promise<SessionState | undefined> {
  if (ctx.config.auth.mode === "public") return undefined;
  let sealed: Buffer;
  try {
    sealed = await readFile(join(ctx.dir, "auth/session.enc"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (sealed.length < 32 || sealed.subarray(0, 4).toString() !== "AC01")
    throw new Error("The saved sign-in session is invalid. Sign in again.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await key(),
    sealed.subarray(4, 16),
  );
  decipher.setAuthTag(sealed.subarray(16, 32));
  try {
    return SessionState.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(sealed.subarray(32)),
          decipher.final(),
        ]).toString(),
      ),
    );
  } catch {
    throw new Error(
      "The saved sign-in session could not be decrypted. Sign in again.",
    );
  }
}
export function makeAuth(
  deps: { browser?: BrowserAdapter; done?: Promise<void> } = {},
): StageFn {
  return async (ctx) => {
    if (ctx.config.auth.mode === "public")
      return { skipped: true, message: "Public site: no sign-in needed" };
    if (fixtureStages()) {
      await pretend(ctx);
      return;
    }
    const site = siteOf(new URL(ctx.config.url).hostname);
    let captured = await sessionFor(ctx);
    if (!captured && ctx.config.auth.mode === "vault")
      throw new Error(
        "This legacy job has no local session. Create a new job using sign-in-once.",
      );
    if (!captured) {
      const browser = deps.browser ?? (await recorderAdapter());
      if (!browser.signIn)
        throw new Error(
          "The configured browser adapter does not support ordinary Chrome sign-in.",
        );
      ctx.log(
        "Sign in in the Chrome window on the worker's machine. When the product dashboard is visible, press I'm signed in on the job page or close the window.",
      );
      const done = deps.done ?? ctx.when("signed-in");
      ctx.progress(0.05, "Opening the sign-in window on the worker's machine");
      captured = SessionState.parse(
        await browser.signIn({
          url: ctx.config.url,
          profileDir: join(
            localHome(),
            "profiles",
            site.replace(/[^a-z0-9.-]/gi, "_"),
          ),
          signal: ctx.signal,
          done,
          onOpen: () =>
            ctx.progress(
              0.1,
              "Sign in in Chrome, then press I'm signed in or close the window",
            ),
        }),
      );
    } else ctx.log("Reusing the encrypted session saved by this job.");
    ctx.signal.throwIfAborted();
    ctx.progress(0.5, "Saving your signed-in session");
    // Only the authorized site's state is exported; identity-provider cookies stay in Chrome.
    const state = SessionState.parse({
      cookies: captured.cookies.filter(
        (cookie) => siteOf(cookie.domain.replace(/^\./, "")) === site,
      ),
      origins: captured.origins.filter(
        (origin) => siteOf(new URL(origin.origin).hostname) === site,
      ),
    });
    if (
      !state.cookies.length &&
      !state.origins.some((origin) => origin.localStorage.length)
    )
      throw new Error(
        "No session state for this product was captured. Sign in again.",
      );
    await mkdir(ctx.path("auth"), { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await key(), iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(state)),
      cipher.final(),
    ]);
    const file = ctx.path("auth/session.enc");
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(
      temp,
      Buffer.concat([Buffer.from("AC01"), iv, cipher.getAuthTag(), body]),
      { mode: 0o600 },
    );
    await rename(temp, file);
    await ctx.write("auth/state.json", AuthState, {
      schemaVersion: 2,
      mode: "sign-in-once",
      sessionFile: "auth/session.enc",
    });
    ctx.progress(1, "Signed-in session saved");
    // Private auth files are deliberately not announced as downloadable artifacts.
  };
}
export const auth = makeAuth();
