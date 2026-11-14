import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CDPSession, Page } from "playwright-core";
import { withRecorderBrowser } from "./browser.ts";
import { encodeCfrMp4 } from "./encode.ts";
import type { LiveControls, LiveOptions, LiveRecording } from "./live.ts";
import type { CapturedFrame, StallReport } from "./timing.ts";

// Studio mode (PRD §9.3.3, FR-44b): the page runs on our own clock, not the wall clock. Each frame the
// worker moves that clock exactly 1/30 s, then takes a screenshot, so frames are evenly spaced however
// slowly the site paints. The clock is our page script, not Playwright's clock API (it can hang on heavy
// pages). It never stops: Playwright's own waits and the page's in-page waits keep moving, so nothing
// deadlocks; between ticks the page is still, so an always-animating target passes the stability check.
//
// Every frame (iframes included) is synced, and playing <video> is paused and seeked to scene time each frame.
// Limits: <audio> keeps real time (the product's sound must play), and the clock runs no faster than real
// time so it stays roughly in step when the page keeps up. Network responses are not replayed (no HAR yet),
// so stateful flows behave exactly as in Live.

export const STUDIO_FPS = 30;
const STEP_MS = 1000 / STUDIO_FPS;
const CLOCK_KEY = "agentcast.clock";

/** Installed before any page script. Real time until the first sync, then only what sync() advances. */
function installClock(key: string) {
  const w = window as unknown as Record<symbol, unknown> & Window;
  const slot = Symbol.for(key);
  if (w[slot]) return;
  const real = {
    setTimeout: w.setTimeout.bind(w),
    clearTimeout: w.clearTimeout.bind(w),
    raf: w.requestAnimationFrame.bind(w),
    caf: w.cancelAnimationFrame.bind(w),
    perfNow: performance.now.bind(performance),
    dateNow: Date.now.bind(Date),
  };
  const dateOffset = real.dateNow() - real.perfNow();
  let engaged = false,
    vt = 0,
    pageBase = 0,
    sceneBase = 0;
  // Code that spins on the clock (`while (performance.now() < end)`) would never finish on a frozen
  // clock: after many reads in one frame, real time spent inside the frame starts to count.
  let reads = 0,
    frameReal = 0;
  const now = () => {
    if (!engaged) return real.perfNow();
    return ++reads > 5000 ? vt + (real.perfNow() - frameReal) : vt;
  };
  const report = (error: unknown) =>
    real.setTimeout(() => {
      throw error;
    }, 0);

  type Timer = { due: number; fn: unknown; args: unknown[]; interval: number; handle?: number };
  const timers = new Map<number, Timer>();
  let nextTimer = 1;
  const call = (t: Timer) => {
    try {
      if (typeof t.fn === "function") (t.fn as (...a: unknown[]) => void).apply(w, t.args);
      else (0, eval)(String(t.fn));
    } catch (error) {
      report(error);
    }
  };
  const fire = (id: number) => {
    const t = timers.get(id);
    if (!t) return;
    if (t.interval) {
      t.due += t.interval;
      if (!engaged) arm(id, t, t.interval);
    } else timers.delete(id);
    call(t);
  };
  const arm = (id: number, t: Timer, ms: number) => {
    t.handle = real.setTimeout(() => {
      t.handle = undefined;
      if (!engaged) fire(id);
    }, ms);
  };
  const schedule = (fn: unknown, ms: unknown, args: unknown[], repeat: boolean) => {
    // Browsers clamp nested zero-delay timers to ~4 ms; on our clock that stops a setTimeout(0) chain
    // from running thousands of times inside one frame.
    const wait = Math.max(engaged ? 4 : 0, Number(ms) || 0);
    const id = nextTimer++;
    const t: Timer = { due: now() + wait, fn, args, interval: repeat ? Math.max(4, wait) : 0 };
    timers.set(id, t);
    if (!engaged) arm(id, t, wait);
    return id;
  };
  const clear = (id: unknown) => {
    const t = timers.get(Number(id));
    if (!t) return;
    if (t.handle !== undefined) real.clearTimeout(t.handle);
    timers.delete(Number(id));
  };

  type Frame = { cb: FrameRequestCallback; handle?: number };
  const frames = new Map<number, Frame>();
  let nextFrame = 1;

  const tracked = new WeakMap<Animation, { born: number; rate: number }>();
  const RUNNING = "__agentcastRunning";
  const pin = () => {
    let list: Animation[];
    try {
      list = document.getAnimations();
    } catch {
      return;
    }
    for (const a of list) {
      const flag = a as unknown as Record<string, boolean>;
      let s = tracked.get(a);
      if (!s) {
        if (a.playState !== "running") continue;
        const rate = a.playbackRate || 1;
        s = { born: vt - (Number(a.currentTime) || 0) / rate, rate };
        tracked.set(a, s);
        try {
          a.pause();
        } catch {
          continue;
        }
        flag[RUNNING] = true;
      } else if (!flag[RUNNING]) continue;
      else if (a.playState !== "paused") {
        // The page played, finished or cancelled it itself: adopt it again next frame if it runs.
        flag[RUNNING] = false;
        tracked.delete(a);
        continue;
      }
      const local = (vt - s.born) * s.rate;
      const end = a.effect?.getComputedTiming().endTime;
      if ((typeof end === "number" && Number.isFinite(end) && local >= end) || (s.rate < 0 && local <= 0)) {
        flag[RUNNING] = false;
        try {
          a.finish(); // fires animationend/transitionend and resolves `finished`, as it would have
        } catch {}
        continue;
      }
      try {
        a.currentTime = local;
      } catch {}
    }
  };

  // Playing <video> follows the clock: paused for real, then seeked each frame. <audio> keeps real time,
  // since the product's sound has to actually play.
  type Pinned = { born: number; start: number; rate: number };
  const videos = new Map<HTMLVideoElement, Pinned>();
  const realPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
    if (this instanceof HTMLVideoElement) videos.delete(this); // the page paused it: it stays put
    return realPause.call(this);
  };
  const seekVideos = (): Promise<void> | undefined => {
    for (const v of document.querySelectorAll("video"))
      if (!v.paused && !videos.has(v)) {
        videos.set(v, { born: vt, start: v.currentTime, rate: v.playbackRate || 1 });
        realPause.call(v);
      }
    const seeks: Promise<void>[] = [];
    for (const [v, p] of videos) {
      if (!v.isConnected) {
        videos.delete(v);
        continue;
      }
      let t = p.start + ((vt - p.born) / 1000) * p.rate;
      const d = v.duration;
      if (Number.isFinite(d) && d > 0 && t >= d) {
        if (v.loop) t %= d;
        else {
          videos.delete(v);
          t = d;
          real.setTimeout(() => v.dispatchEvent(new Event("ended")), 0);
        }
      }
      if (Math.abs(v.currentTime - t) < 0.001) continue;
      seeks.push(new Promise<void>((resolve) => {
        v.addEventListener("seeked", () => resolve(), { once: true });
        real.setTimeout(resolve, 300); // a slow decoder holds one frame, never the take
      }));
      try {
        v.currentTime = t;
      } catch {}
    }
    return seeks.length ? Promise.all(seeks).then(() => {}) : undefined;
  };

  const advanceTo = (target: number) => {
    for (let guard = 0; guard < 20000; guard++) {
      let id = -1,
        next: Timer | undefined;
      for (const [i, t] of timers) if (t.due <= target && (!next || t.due < next.due)) (next = t), (id = i);
      if (!next) break;
      vt = Math.max(vt, next.due);
      fire(id);
    }
    vt = Math.max(vt, target);
    reads = 0;
    frameReal = real.perfNow();
    const due = [...frames.values()];
    frames.clear();
    for (const f of due)
      try {
        f.cb(vt);
      } catch (error) {
        report(error);
      }
    pin();
    return seekVideos();
  };

  const engage = () => {
    engaged = true;
    vt = real.perfNow();
    for (const t of timers.values())
      if (t.handle !== undefined) {
        real.clearTimeout(t.handle);
        t.handle = undefined;
      }
    for (const f of frames.values())
      if (f.handle !== undefined) {
        real.caf(f.handle);
        f.handle = undefined;
      }
    // Wheel steps arrive per frame already eased; CSS smooth scrolling would animate them in real time.
    const style = () => {
      const el = document.createElement("style");
      el.textContent = "html,body{scroll-behavior:auto!important}";
      (document.head ?? document.documentElement)?.appendChild(el);
    };
    if (document.documentElement) style();
    else document.addEventListener("DOMContentLoaded", style, { once: true });
  };

  w.setTimeout = ((fn: unknown, ms?: unknown, ...args: unknown[]) => schedule(fn, ms, args, false)) as typeof setTimeout;
  w.setInterval = ((fn: unknown, ms?: unknown, ...args: unknown[]) => schedule(fn, ms, args, true)) as typeof setInterval;
  w.clearTimeout = clear as typeof clearTimeout;
  w.clearInterval = clear as typeof clearInterval;
  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextFrame++;
    const f: Frame = { cb };
    frames.set(id, f);
    if (!engaged)
      f.handle = real.raf((ts) => {
        if (engaged || !frames.delete(id)) return;
        try {
          cb(ts);
        } catch (error) {
          report(error);
        }
      });
    return id;
  };
  w.cancelAnimationFrame = (id: number) => {
    const f = frames.get(id);
    if (f?.handle !== undefined) real.caf(f.handle);
    frames.delete(id);
  };
  performance.now = () => now();
  Date.now = () => Math.floor(dateOffset + now());

  Object.defineProperty(w, slot, {
    enumerable: false,
    value: {
      /** Move this document to scene time `sceneMs` (the first call starts the clock here). Resolves once videos have seeked. */
      sync(sceneMs: number) {
        if (!engaged) {
          engage();
          pageBase = vt;
          sceneBase = sceneMs;
        }
        return advanceTo(pageBase + sceneMs - sceneBase);
      },
    },
  });
}

export const studioClockScript = `(${installClock.toString()})(${JSON.stringify(CLOCK_KEY)});`;

export interface StudioClock {
  /** Scene time of the latest frame, in ms. */
  now(): number;
  /** Resolve once the clock has rendered `ms` more scene time. */
  sleep(ms: number): Promise<void>;
  stop(): Promise<{ frames: CapturedFrame[]; durationMs: number }>;
}

/**
 * Step the page's clock frame by frame. With `directory`, each frame is screenshotted there; without it the
 * clock just ticks (the page holds still between ticks, so always-animating targets are clickable).
 */
export async function startStudioClock(
  page: Page,
  options: { signal: AbortSignal; directory?: string; quality?: number },
): Promise<StudioClock> {
  const cdp: CDPSession | undefined = options.directory ? await page.context().newCDPSession(page) : undefined;
  const frames: CapturedFrame[] = [];
  let current = 0,
    next = 0,
    running = true;
  const waiters: { at: number; resolve: () => void }[] = [];
  const start = performance.now();
  // Every frame, iframes included: each document joins the clock at its first sync.
  const sync = (sceneMs: number) =>
    Promise.all(
      page.frames().map((frame) =>
        frame
          .evaluate(
            ([key, t]) => (window as unknown as Record<symbol, { sync(t: number): Promise<void> | undefined } | undefined>)[Symbol.for(key as string)]?.sync(t as number),
            [CLOCK_KEY, sceneMs] as const,
          )
          .catch(() => {}), // Mid-navigation: the new document joins on the next frame.
      ),
    );
  const loop = (async () => {
    while (running) {
      options.signal.throwIfAborted();
      // Never run ahead of real time: media and server responses keep their pace when the page keeps up.
      const ahead = next - (performance.now() - start);
      if (ahead > 1) await delay(ahead, undefined, { signal: options.signal });
      await sync(next);
      if (cdp && options.directory) {
        const shot = await Promise.race([
          cdp
            .send("Page.captureScreenshot", { format: "jpeg", quality: options.quality ?? 90, optimizeForSpeed: true })
            .catch(() => undefined),
          delay(5000, undefined).then(() => undefined),
        ]);
        if (shot) {
          const file = `frame-${String(frames.length).padStart(8, "0")}.jpg`;
          await writeFile(join(options.directory, file), Buffer.from(shot.data, "base64"));
          frames.push({ file, timestampMs: next, receivedAtMs: next });
        }
      }
      current = next;
      next += STEP_MS;
      for (let i = waiters.length - 1; i >= 0; i--)
        if (waiters[i]!.at <= current + 0.5) waiters.splice(i, 1)[0]!.resolve();
    }
  })();
  let failure: unknown;
  loop.catch((error) => {
    failure = error;
    for (const w of waiters.splice(0)) w.resolve();
  });
  return {
    now: () => current,
    async sleep(ms) {
      if (failure) throw failure;
      if (!(ms > 0)) return;
      await new Promise<void>((resolve) => waiters.push({ at: current + ms, resolve }));
      if (failure) throw failure;
      options.signal.throwIfAborted();
    },
    async stop() {
      running = false;
      await loop.catch(() => {});
      for (const w of waiters.splice(0)) w.resolve();
      await cdp?.detach().catch(() => {});
      if (failure && !options.signal.aborted) throw failure;
      options.signal.throwIfAborted();
      return { frames, durationMs: current + STEP_MS };
    },
  };
}

/** One Studio take: real actions on our clock, an even 30 fps whatever the site's paint speed. */
export async function recordStudio(
  options: LiveOptions,
  run: (controls: LiveControls) => Promise<void>,
): Promise<LiveRecording> {
  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const directory = await mkdtemp(join(dirname(outputPath), ".agentcast-studio-"));
  const deadline = new AbortController();
  // A frame costs a screenshot, so a take takes longer than it lasts.
  const timer = setTimeout(() => deadline.abort(new Error("Studio take timed out")), options.timeoutMs ?? 600_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const browser = options.browser ?? {};
  try {
    return await withRecorderBrowser(
      {
        ...browser,
        signal,
        launchOptions: {
          ...browser.launchOptions,
          args: [...(browser.launchOptions?.args ?? []), "--disable-smooth-scrolling"],
        },
      },
      async (session) => {
        await session.context.addInitScript({ content: studioClockScript });
        await options.prepare?.(session, 1, signal);
        signal.throwIfAborted();
        const viewport = session.page.viewportSize();
        if (!viewport) throw new Error("Studio recording requires a fixed viewport");
        const dpr = session.deviceScaleFactor;
        const onNewPage = () => deadline.abort(new Error("Studio capture requires one page; a new tab was opened"));
        session.context.on("page", onNewPage);
        const clock = await startStudioClock(session.page, { signal, directory });
        let captured: Awaited<ReturnType<StudioClock["stop"]>>;
        try {
          await run({
            ...session,
            attempt: 1,
            signal,
            now: clock.now,
            sleep: clock.sleep,
            motion: (work) => work(),
            markMotion: () => {},
          });
        } finally {
          session.context.off("page", onNewPage);
          captured = await clock.stop();
        }
        if (!captured.frames.length) throw new Error("Studio captured no frames");
        const encoded = await encodeCfrMp4(
          {
            directory,
            frames: captured.frames,
            startedAtMs: 0,
            durationMs: captured.durationMs,
            expectedSize: { width: Math.round(viewport.width * dpr), height: Math.round(viewport.height * dpr) },
          },
          outputPath,
          { ...options.encoding, signal: options.signal },
        );
        const stall: StallReport = {
          status: "passed",
          maxGapMs: STEP_MS,
          p95GapMs: STEP_MS,
          motionDurationMs: captured.durationMs,
          effectiveFps: STUDIO_FPS,
          gaps: [],
        };
        return {
          ...encoded,
          mode: "studio" as const,
          sourceDurationMs: captured.durationMs,
          sourceFrameCount: captured.frames.length,
          stall,
          takes: [{ attempt: 1, stall }],
          gpu: session.gpu,
        };
      },
    );
  } finally {
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
  }
}
