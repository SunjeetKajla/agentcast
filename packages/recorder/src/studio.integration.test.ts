import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMediaCommand } from "./encode.ts";
import { recordStudio } from "./studio.ts";

const executablePath = process.env.AGENTCAST_TEST_CHROMIUM;
const ready = await Promise.all([
  chromium
    .launch({ channel: "chrome" })
    .then((b) => b.close().then(() => true))
    .catch(() => access(executablePath ?? chromium.executablePath()).then(() => true, () => false)),
  ...["ffmpeg", "ffprobe"].map((tool) => runMediaCommand(tool, ["-version"]).then(() => true, () => false)),
]);

// A slow-painting page: every frame blocks the main thread for tens of ms (Live would stutter), plus a CSS
// animation, a rAF animation and a timer, all of which must follow Studio's clock exactly.
const PAGE = `<!doctype html><style>
body{margin:0;background:#123}
@keyframes slide{from{transform:translateX(0)}to{transform:translateX(200px)}}
#css{width:20px;height:20px;background:#f80;animation:slide 2s linear infinite}
#js{width:20px;height:20px;background:#0af}
</style><div id="css"></div><div id="js"></div><button id="go">Go</button><script>
window.rafTimes = [];
const loop = (t) => {
  rafTimes.push(t);
  let x = 0; for (let i = 0; i < 4e7; i++) x += i % 7; window.sink = x;
  document.getElementById("js").style.transform = "translateX(" + (t % 1000) / 5 + "px)";
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
document.getElementById("go").onclick = () => {
  window.clickedAt = performance.now();
  setTimeout(() => { window.timerAt = performance.now(); document.body.dataset.done = "1"; }, 500);
};
</script>`;

// A looping video and an iframe with its own rAF counter: both must follow the clock too.
const MEDIA_PAGE = `<!doctype html><video id="v" src="/v.webm" muted loop autoplay playsinline width="64"></video>
<iframe id="f" src="/frame.html" width="80" height="40"></iframe>`;
const FRAME = `<!doctype html><script>window.ticks = [];const l = (t) => { ticks.push(t); requestAnimationFrame(l); }; requestAnimationFrame(l);</script>`;

let server: Server, url: string, video: Buffer;
const directories: string[] = [];
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentcast-studio-video-"));
  directories.push(dir);
  await runMediaCommand("ffmpeg", [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=64x64:rate=30"],
    ...["-c:v", "libvpx", "-b:v", "200k", join(dir, "v.webm")],
  ]).catch(() => {});
  video = await readFile(join(dir, "v.webm")).catch(() => Buffer.alloc(0));
  server = createServer((req, res) => {
    if (req.url === "/v.webm") {
      // Byte ranges, as real sites serve video: without them Chrome can't seek.
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      if (!range) return res.writeHead(200, { "content-type": "video/webm", "content-length": video.length, "accept-ranges": "bytes" }).end(video);
      const from = Number(range[1]), to = range[2] ? Number(range[2]) : video.length - 1;
      res.writeHead(206, { "content-type": "video/webm", "content-range": `bytes ${from}-${to}/${video.length}`, "content-length": to - from + 1, "accept-ranges": "bytes" }).end(video.subarray(from, to + 1));
    }
    else if (req.url === "/frame.html") res.writeHead(200, { "content-type": "text/html" }).end(FRAME);
    else if (req.url === "/media") res.writeHead(200, { "content-type": "text/html" }).end(MEDIA_PAGE);
    else res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
});
afterAll(async () => {
  server?.close();
  await Promise.all(directories.map((d) => rm(d, { recursive: true, force: true })));
});

describe.skipIf(ready.includes(false))("Studio virtual clock", () => {
  it("films a slow-painting page at an even 30 fps with timers and animations on scene time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentcast-studio-"));
    directories.push(directory);
    let observed: { raf: number[]; css: number; clickedAt: number; timerAt: number; scene: [number, number] } | undefined;
    const result = await recordStudio(
      {
        outputPath: join(directory, "studio.mp4"),
        browser: {
          viewport: { width: 320, height: 180 },
          deviceScaleFactor: 1,
          launchOptions: executablePath ? { executablePath } : undefined,
        },
        prepare: async ({ page }) => {
          await page.goto(url);
        },
      },
      async ({ page, now, sleep }) => {
        await sleep!(300);
        const before = now();
        await page.click("#go");
        await page.waitForFunction(() => document.body.dataset.done === "1", undefined, { timeout: 30_000 });
        await sleep!(200);
        // Code that spins on the clock still finishes: the clock is frozen within a frame, but not forever.
        const spun = await page.evaluate(() => {
          const end = performance.now() + 20;
          while (performance.now() < end) {}
          return true;
        });
        expect(spun).toBe(true);
        observed = await page.evaluate(() => ({
          raf: (window as unknown as { rafTimes: number[] }).rafTimes.slice(-10),
          css: Number(document.getAnimations()[0]!.currentTime),
          clickedAt: (window as unknown as { clickedAt: number }).clickedAt,
          timerAt: (window as unknown as { timerAt: number }).timerAt,
          scene: [0, 0] as [number, number],
        }));
        observed.scene = [before, now()];
      },
    );
    expect(result.mode).toBe("studio");
    // Every rAF after the clock starts is exactly one frame apart, though each frame took 60 ms to paint.
    const deltas = observed!.raf.slice(1).map((t, i) => t - observed!.raf[i]!);
    for (const d of deltas) expect(d).toBeCloseTo(1000 / 30, 3);
    // The page's 500 ms timer fired 500 ms of scene time after the click (to within one frame).
    expect(observed!.timerAt - observed!.clickedAt).toBeGreaterThanOrEqual(500 - 1e-6);
    expect(observed!.timerAt - observed!.clickedAt).toBeLessThan(500 + 1000 / 30 + 1);
    // The CSS animation is pinned to the clock and kept moving.
    expect(observed!.css).toBeGreaterThan(500);
    // The video is constant 30 fps and as long as the scene, not the wall-clock time it took.
    const probe = await runMediaCommand("ffprobe", [
      ...["-v", "error", "-select_streams", "v:0"],
      ...["-show_entries", "stream=avg_frame_rate,nb_frames", "-of", "json", result.path],
    ]);
    const stream = JSON.parse(probe.stdout).streams[0];
    expect(stream.avg_frame_rate).toBe("30/1");
    expect(Number(stream.nb_frames)).toBeGreaterThanOrEqual(Math.floor((observed!.scene[1] / 1000) * 30));
  }, 120_000);

  it("keeps playing videos and iframes on the clock", async () => {
    expect(video.length).toBeGreaterThan(0);
    const directory = await mkdtemp(join(tmpdir(), "agentcast-studio-"));
    directories.push(directory);
    let seen: { videoMs: number; frameDeltas: number[]; scene: number } | undefined;
    await recordStudio(
      {
        outputPath: join(directory, "media.mp4"),
        browser: {
          viewport: { width: 320, height: 180 },
          deviceScaleFactor: 1,
          launchOptions: executablePath ? { executablePath } : undefined,
        },
        prepare: async ({ page }) => {
          await page.goto(`${url}media`);
          await page.waitForFunction(() => {
            const v = document.querySelector("video")!;
            return !v.paused && v.currentTime > 0;
          });
        },
      },
      async ({ page, now, sleep }) => {
        const v = page.locator("#v");
        const before = await v.evaluate((el: HTMLVideoElement) => el.currentTime);
        const start = now();
        await sleep!(1000);
        const after = await v.evaluate((el: HTMLVideoElement) => el.currentTime);
        const ticks = await page.frame({ url: /frame\.html$/ })!.evaluate(() => (window as unknown as { ticks: number[] }).ticks.slice(-6));
        seen = { videoMs: (after - before) * 1000, frameDeltas: ticks.slice(1).map((t, i) => t - ticks[i]!), scene: now() - start };
      },
    );
    // The video moved as far as the scene did (it plays 4.5x too fast on the wall clock otherwise).
    expect(Math.abs(seen!.videoMs - seen!.scene)).toBeLessThan(100);
    // The iframe's animation frames arrive one scene frame apart.
    for (const d of seen!.frameDeltas) expect(d).toBeCloseTo(1000 / 30, 3);
  }, 120_000);
});
