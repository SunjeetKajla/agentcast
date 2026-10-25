import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Flow, FlowsFile, JobConfig, Timeline, jobPaths } from "@agentcast/shared";
import { readArtifact, writeArtifact } from "@agentcast/shared/node";
import { localBrowserAdapter, signInLocally, type BrowserAdapter } from "@agentcast/explore";
import { recordFlow } from "@agentcast/recorder";
import type { TinyFish } from "@agentcast/tinyfish";
import type { StageContext } from "../context";
import { makeAuth, authRequest, sessionFor } from "./auth";
import { makeRecord } from "./record";

it.skipIf(process.env.AGENTCAST_BROWSER_TESTS !== "1")(
  "captures a login, encrypts it, shares its profile, and restores it for fresh rehearsal and recording",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentcast-auth-handoff-"));
    let seen!: () => void;
    const loaded = new Promise<void>((resolve) => { seen = resolve; });
    let signedInRequests = 0;
    const server = createServer((req, res) => {
      if (req.url === "/ready") { seen(); return res.end(); }
      res.setHeader("content-type", "text/html");
      if (req.url === "/login") {
        res.setHeader("set-cookie", "sid=fixture-session; HttpOnly; Path=/");
        return res.end('<h1>Fixture signed-in account</h1><script>localStorage.setItem("token","fixture-token"); fetch("/ready");</script>');
      }
      if (!req.headers.cookie?.includes("sid=fixture-session")) {
        return res.end('<h1>Sign in required</h1><input type="password">');
      }
      signedInRequests++;
      res.end('<h1>Fixture workspace</h1><button id="create" hidden onclick="document.querySelector(\'p\').textContent=\'Project created\'">Create project</button><p>Ready</p><script>if(localStorage.getItem("token")==="fixture-token")document.getElementById("create").hidden=false;</script>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const signal = AbortSignal.timeout(80_000);
    const ctx = {
      jobId: "fixture-auth", dir, stage: "auth", attempt: 1,
      config: JobConfig.parse({ url: `${origin}/login`, auth: { mode: "sign-in-once" } }),
      signal, when: () => loaded,
      path: (file: string) => join(dir, file),
      read: (file: string, schema: Parameters<typeof readArtifact>[1]) => readArtifact(join(dir, file), schema),
      write: (file: string, schema: Parameters<typeof writeArtifact>[1], data: unknown) => writeArtifact(join(dir, file), schema, data),
      log: vi.fn(), progress: vi.fn(), artifact: vi.fn(),
    } as unknown as StageContext;
    const tf = {
      createProfile: vi.fn(async () => ({ id: "fixture-profile" })),
      uploadProfile: vi.fn(async () => ({ domains_updated: ["127.0.0.1"], domains_failed: [] })),
    } as unknown as TinyFish;
    const executablePath = process.env.AGENTCAST_TEST_CHROMIUM ?? "/opt/google/chrome/chrome";
    const launch = { gpu: "cpu" as const, launchOptions: { executablePath } };
    vi.stubEnv("AGENTCAST_STAGE_MODE", "real");
    vi.stubEnv("AGENTCAST_HOME", join(dir, "home"));
    vi.stubEnv("AGENTCAST_SECRET", "fixture-key");
    try {
      await makeAuth({ tf, browser: {
        signIn: (options) => signInLocally({ ...options, headless: true, executable: executablePath }),
      } as BrowserAdapter })(ctx);
      const state = (await sessionFor(ctx))!;
      expect(state.cookies.find((cookie) => cookie.name === "sid")).toMatchObject({ value: "fixture-session", httpOnly: true });
      expect(state.origins[0]?.localStorage).toContainEqual({ name: "token", value: "fixture-token" });
      expect(await authRequest(ctx)).toEqual({ use_profile: true, profile_id: "fixture-profile" });
      expect(vi.mocked(tf.uploadProfile).mock.calls[0]?.[1]).toMatchObject({
        cookies: [expect.objectContaining({ name: "sid", value: "fixture-session" })],
        localStorage: [{ origin, items: [{ name: "token", value: "fixture-token" }] }],
      });
      const browser = localBrowserAdapter(launch);
      const flow = Flow.parse({
        id: "private-project", title: "Create a project", whyItMatters: "Show a signed-in outcome",
        startUrl: `${origin}/`, requiresAuth: true, rank: 1, selected: true, source: "user",
        steps: [{ id: "create", action: "click", target: { role: "button", text: "Create project" },
          expect: [{ type: "text", text: "Project created", match: "exact" }] }],
      });
      const replay = await browser.rehearse(flow, { dir, authorizedUrl: ctx.config.url, signal, storageState: state });
      expect(replay.flow.rehearsal?.ok).toBe(true);
      await ctx.write(jobPaths.flows, FlowsFile, { schemaVersion: 1, flows: [replay.flow] });
      await makeRecord({ recordFlow: (recordedFlow, options) => recordFlow(recordedFlow, {
        ...options, browser: { ...options.browser, ...launch }, encoding: { encoder: "libx264" },
      }) })(ctx);
      const timeline = await ctx.read(jobPaths.timeline("desktop"), Timeline);
      expect(timeline.flows.map((entry) => entry.flowId)).toEqual([flow.id]);
      expect(timeline.events.some((event) => event.kind === "click")).toBe(true);
      expect((await stat(ctx.path(jobPaths.recording("desktop")))).size).toBeGreaterThan(1000);
      expect(signedInRequests).toBeGreaterThanOrEqual(2);
      const encrypted = await readFile(ctx.path("auth/session.enc"));
      for (const secret of ["fixture-session", "fixture-token"]) {
        expect(encrypted.includes(Buffer.from(secret))).toBe(false);
        expect(JSON.stringify(vi.mocked(ctx.log).mock.calls)).not.toContain(secret);
      }
    } finally {
      vi.unstubAllEnvs();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  },
  90_000,
);
