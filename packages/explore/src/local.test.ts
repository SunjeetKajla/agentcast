import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Flow } from "@agentcast/shared";
import { localBrowserAdapter } from "./local";

// Ported from the old worker's exploration regressions. No paid services are used.
// Opt in because Chrome and a local listener aren't available in every CI sandbox.
describe.skipIf(process.env.AGENTCAST_BROWSER_TESTS !== "1")(
  "independent local Chrome rehearsal",
  () => {
    let server: Server;
    let url: string;
    let dir: string;
    const browser = localBrowserAdapter({ gpu: "cpu", stealth: false });
    const options = () => ({ dir, authorizedUrl: url });
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "agentcast-local-"));
      server = createServer((req, res) => {
        res.setHeader("content-type", "text/html");
        if (req.url === "/mark.svg") {
          res.setHeader("content-type", "image/svg+xml");
          return res.end(
            '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#6842dd"/></svg>',
          );
        }
        if (req.url === "/svg-brand")
          return res.end(
            '<header><svg aria-label="Product logo" width="120" height="40"><rect width="120" height="40" fill="#6842dd"/></svg></header><main style="min-height:900px;background:linear-gradient(90deg, rgb(104,66,221), rgb(221,66,144))"><h1>Build wonderful products</h1></main>',
          );
        if (req.url === "/touch-brand")
          return res.end(
            '<link rel="apple-touch-icon" href="/mark.svg"><h1>A public product with a touch icon</h1>',
          );
        if (req.url === "/challenge") {
          res.statusCode = 403;
          return res.end(
            "<h1>Performing security verification</h1><p>This website verifies you are not a bot.</p>",
          );
        }
        if (req.url === "/signin")
          return res.end(
            "<h1>Welcome to your account</h1><button>Continue with Google</button>",
          );
        if (req.url === "/password")
          return res.end(
            '<h1>Member workspace</h1><label>Password<input type="password" value="private-password"></label>',
          );
        if (req.url === "/hydrated")
          return res.end(
            "<script>setTimeout(() => { document.body.innerHTML=\"<h1>Hydrated component library</h1><a href='/'>Examples</a>\" }, 200)</script>",
          );
        if (req.url === "/duplicate")
          return res.end(
            "<h1>Two visible buttons</h1><button>Continue</button><button>Continue</button>",
          );
        if (req.url === "/public")
          return res.end(
            '<h1>Public component library</h1><p>No need to sign in: everything is free.</p><div style="opacity:0"><input type="password"><p>Access denied</p></div>',
          );
        res.end(
          '<h1>Public product workspace</h1><label>Project name<input placeholder="Name"></label><button onclick="this.hidden=true; document.querySelector(\'#show\').hidden=false">Continue</button><button id="show" hidden onclick="document.querySelector(\'#result\').hidden=false">Show result</button><h2 id="result" hidden>Done</h2>',
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      server?.closeAllConnections();
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    const flow = (steps: Flow["steps"], path = "/") =>
      Flow.parse({
        id: "fixture",
        title: "Reveal the result",
        whyItMatters: "Show the outcome",
        startUrl: url + path,
        requiresAuth: false,
        rank: 1,
        selected: false,
        steps,
      });

    it("waits for hydration and ignores hidden sign-in/challenge copy on public pages", async () => {
      expect(
        (await browser.readPage(url + "/hydrated", options())).text,
      ).toContain("Hydrated component library");
      expect(
        (await browser.inspect(url + "/public", options())).facts.heading,
      ).toBe("Public component library");
      expect(
        (await browser.readPage(url + "/public", options())).text,
      ).not.toContain("Access denied");
    }, 30_000);
    it("captures styled SVG and touch-icon logos plus hero gradients as safe image assets", async () => {
      const svg = await browser.inspect(url + "/svg-brand", options());
      expect(svg.logo?.from).toBe("inline-svg");
      expect(svg.gradient).toEqual(["rgb(104, 66, 221)", "rgb(221, 66, 144)"]);
      expect(
        (await readFile(join(dir, svg.logo!.file))).subarray(0, 8),
      ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const touch = await browser.inspect(url + "/touch-brand", options());
      expect(touch.logo?.from).toBe("apple-touch-icon");
      expect(touch.logo?.plate).toBe(true);
    }, 30_000);
    it.each(["/challenge", "/signin", "/password"])(
      "stops at a real access barrier: %s",
      async (path) => {
        await expect(
          browser.inspect(url + path, options()),
        ).rejects.toMatchObject({
          kind: path === "/challenge" ? "blocked" : "sign-in-required",
        });
      },
      30_000,
    );
    it("replays prerequisites in a fresh browser and produces review frames", async () => {
      const result = await browser.rehearse(
        flow([
          {
            id: "s1",
            action: "click",
            target: { role: "button", text: "Continue" },
          },
          {
            id: "s2",
            action: "click",
            target: { role: "button", text: "Show result" },
            expect: [{ type: "text", text: "Done", match: "exact" }],
          },
        ]),
        options(),
      );
      expect(result.flow.rehearsal?.ok).toBe(true);
      expect(
        result.replay?.byFormFactor.desktop?.["fixture.s1"]?.strategy,
      ).toBe("role");
      expect(
        (await stat(join(dir, result.flow.steps[1]!.frame!))).size,
      ).toBeGreaterThan(100);
      const missing = await browser.rehearse(
        flow([
          {
            id: "s1",
            action: "click",
            target: { role: "button", text: "Show result" },
          },
        ]),
        options(),
      );
      expect(missing.flow.rehearsal?.ok).toBe(false);
    }, 30_000);
    it("rejects ambiguous targets and checks the named field rather than the action target", async () => {
      const duplicate = await browser.rehearse(
        flow(
          [
            {
              id: "s1",
              action: "click",
              target: { role: "button", text: "Continue" },
            },
          ],
          "/duplicate",
        ),
        options(),
      );
      expect(duplicate.flow.rehearsal?.ok).toBe(false);
      const wrongValue = await browser.rehearse(
        flow([
          {
            id: "s1",
            action: "click",
            target: { role: "button", text: "Continue" },
            expect: [{ type: "value", target: "Project name", value: "Wrong" }],
          },
        ]),
        options(),
      );
      expect(wrongValue.flow.rehearsal?.ok).toBe(false);
    }, 30_000);
  },
);
