import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signInLocally } from "./sign-in";

// Adapted from ../AgentCast/packages/recorder/src/session.test.ts.
describe.skipIf(process.env.AGENTCAST_BROWSER_TESTS !== "1")(
  "ordinary Chrome sign-in session capture",
  () => {
    let server: Server;
    let url: string;
    let dir: string;
    let seen: Promise<void>;
    let reported: () => void;
    let hits: number;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "agentcast-sign-in-"));
      hits = 0;
      seen = new Promise((resolve) => {
        reported = resolve;
      });
      server = createServer((req, res) => {
        if (req.url === "/report") {
          reported();
          return res.end();
        }
        if (req.url === "/") hits++;
        res.setHeader("set-cookie", "sid=session-secret; Path=/; HttpOnly");
        res.setHeader("content-type", "text/html");
        res.end(
          '<h1>Fixture dashboard</h1><script>document.cookie="pref=dark; max-age=86400; path=/"; localStorage.setItem("token","local-token"); setTimeout(() => fetch("/report"), 300);</script>',
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    });
    afterEach(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    });
    it("captures cookies and localStorage without loading the real site during extraction", async () => {
      let done!: () => void;
      const state = await signInLocally({
        url,
        profileDir: join(dir, "profile"),
        headless: true,
        done: new Promise((resolve) => {
          done = resolve;
        }),
        onOpen: () => {
          void seen.then(() => setTimeout(done, 1200));
        },
        timeoutMs: 50_000,
      });
      expect(
        state.cookies.find((cookie) => cookie.name === "sid"),
      ).toMatchObject({ value: "session-secret", httpOnly: true });
      expect(
        state.cookies.find((cookie) => cookie.name === "pref")?.value,
      ).toBe("dark");
      expect(
        state.origins.find((origin) => origin.origin === new URL(url).origin)
          ?.localStorage,
      ).toEqual([{ name: "token", value: "local-token" }]);
      expect(hits).toBe(1);
    }, 60_000);
    it("refuses competing windows and captures state when the user closes the window", async () => {
      const profileDir = join(dir, "profile");
      let opened!: () => void;
      const ready = new Promise<void>((resolve) => {
        opened = resolve;
      });
      const first = signInLocally({
        url,
        profileDir,
        headless: true,
        timeoutMs: 50_000,
        onOpen: (window) => {
          opened();
          void seen.then(() =>
            // SIGTERM is a stand-in for closing the window in this headless test.
            // Unlike an orderly UI close it may discard Chrome's current cookie batch.
            setTimeout(() => process.kill(window.pid!, "SIGTERM"), 31_000),
          );
        },
      });
      await ready;
      await expect(
        signInLocally({ url, profileDir, headless: true }),
      ).rejects.toThrow("already open");
      const state = await first;
      expect(
        state.cookies.find((cookie) => cookie.name === "pref")?.value,
      ).toBe("dark");
      expect(hits).toBe(1);
    }, 60_000);
    it("cancels the process and releases the profile reservation", async () => {
      const controller = new AbortController();
      const profileDir = join(dir, "profile");
      const first = signInLocally({
        url,
        profileDir,
        headless: true,
        signal: controller.signal,
        onOpen: () => controller.abort(new Error("fixture cancellation")),
      });
      await expect(first).rejects.toThrow("fixture cancellation");
      await expect(
        signInLocally({
          url,
          profileDir,
          executable: "/missing/chrome",
          headless: true,
          timeoutMs: 100,
        }),
      ).rejects.not.toThrow("already open");
    }, 30_000);
  },
);
