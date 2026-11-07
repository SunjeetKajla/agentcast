import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobConfig } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import {
  AuthState,
  type BrowserAdapter,
  type SessionState,
} from "@agentcast/explore";
import type { StageContext } from "../context";
import { makeAuth, sessionFor } from "./auth";

let dir: string;
let ctx: StageContext;
const state: SessionState = {
  cookies: ["product.example", "accounts.google.com"].map((domain) => ({
    name: "session",
    value: "private-cookie",
    domain,
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  })),
  origins: [
    {
      origin: "https://product.example",
      localStorage: [{ name: "session", value: "private-token" }],
    },
  ],
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-auth-"));
  vi.stubEnv("AGENTCAST_STAGE_MODE", "real");
  vi.stubEnv("AGENTCAST_SECRET", "fixture-secret-key");
  vi.stubEnv("AGENTCAST_HOME", join(dir, "home"));
  const io: Pick<StageContext, "path" | "read" | "write"> = {
    path: (rel) => join(dir, rel),
    read: (rel, schema) => readArtifact(join(dir, rel), schema),
    write: (rel, schema, value) => writeArtifact(join(dir, rel), schema, value),
  };
  ctx = {
    dir,
    config: JobConfig.parse({
      url: "https://product.example/",
      auth: { mode: "sign-in-once" },
    }),
    signal: new AbortController().signal,
    ...io,
    log: vi.fn(),
    progress: vi.fn(),
    when: vi.fn(() => new Promise<void>(() => {})),
  } as unknown as StageContext;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const deps = () => ({
  browser: { signIn: vi.fn(async () => state) } as unknown as BrowserAdapter,
});

describe("real auth stage", () => {
  it("waits for the stage's completion signal while the ordinary Chrome window is open", async () => {
    const services = deps();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(ctx.when).mockReturnValue(done);
    let opened!: () => void;
    const ready = new Promise<void>((resolve) => {
      opened = resolve;
    });
    vi.mocked(services.browser.signIn!).mockImplementation(async (options) => {
      options.onOpen?.();
      opened();
      await options.done;
      return state;
    });
    const run = makeAuth(services)(ctx);
    await ready;
    expect(ctx.when).toHaveBeenCalledWith("signed-in");
    finish();
    await run;
    expect(ctx.progress).toHaveBeenCalledWith(
      0.5,
      "Saving your signed-in session",
    );
  });
  it("seals only the authorized product state", async () => {
    const services = deps();
    await makeAuth(services)(ctx);
    const saved = await sessionFor(ctx);
    expect(saved?.cookies).toHaveLength(1);
    expect(saved?.cookies[0]?.domain).toBe("product.example");
    expect(saved?.origins[0]?.localStorage[0]?.value).toBe("private-token");
    const encrypted = await readFile(ctx.path("auth/session.enc"));
    expect(encrypted.includes(Buffer.from("private-cookie"))).toBe(false);
    expect(encrypted.includes(Buffer.from("private-token"))).toBe(false);
    expect((await stat(ctx.path("auth/session.enc"))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(vi.mocked(ctx.log).mock.calls)).not.toContain(
      "private-",
    );
    expect((await ctx.read("auth/state.json", AuthState)).schemaVersion).toBe(
      2,
    );
  });
  it("reuses a sealed session without opening another sign-in window", async () => {
    const services = deps();
    await makeAuth(services)(ctx);
    await makeAuth(services)(ctx);
    expect(services.browser.signIn).toHaveBeenCalledTimes(1);
  });
  it("rejects tampered sessions rather than silently exploring signed out", async () => {
    await makeAuth(deps())(ctx);
    const file = ctx.path("auth/session.enc");
    const bytes = await readFile(file);
    bytes[bytes.length - 1]! ^= 1;
    await writeFile(file, bytes);
    await expect(sessionFor(ctx)).rejects.toThrow("could not be decrypted");
  });
  it("skips all sign-in and provider work for public jobs", async () => {
    ctx.config.auth = { mode: "public" };
    const services = deps();
    expect(await makeAuth(services)(ctx)).toMatchObject({ skipped: true });
    expect(services.browser.signIn).not.toHaveBeenCalled();
    expect(ctx.when).not.toHaveBeenCalled();
  });
  it("rejects legacy Vault jobs without a local session", async () => {
    ctx.config.auth = { mode: "vault", credentialItemIds: ["old"] };
    const services = deps();
    await expect(makeAuth(services)(ctx)).rejects.toThrow("sign-in-once");
    expect(services.browser.signIn).not.toHaveBeenCalled();
  });
});
