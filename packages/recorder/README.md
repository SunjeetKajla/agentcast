# Recorder browser launcher

`launchRecorderBrowser()` starts a separate full Chromium instance in modern
headless mode for each call. The desktop default is 1440×900 at DPR 2; mobile
is 390×844 at DPR 3 with touch and a Chromium mobile user agent. Viewport, DPR
and user agent can be overridden. Puppeteer Extra's stealth plugin is enabled
through `playwright-extra`, preserving Playwright's page, context and CDP APIs.

Worker stages should use `withRecorderBrowser()` to close the context and browser
in `finally`, including when their work fails:

```ts
import { withRecorderBrowser } from "@agentcast/recorder";

await withRecorderBrowser(
  { formFactor: "desktop", storageState, gpu: "auto", stealth: true },
  async ({ page, gpu }) => {
    console.info(gpu); // Actual renderer, acceleration status and fallback attempts.
    await page.goto(url);
    // Rehearse or record using this page.
  },
);
```

`storageState` is an in-memory Playwright state object containing `cookies` and
`origins`. The worker is responsible for loading and decrypting session artifacts.
Cookies are installed before page creation. An init script restores localStorage
before app scripts on matching origins, including navigations and new pages.
Restoration runs on each document load, so saved values overwrite the same keys
on reload. State and credentials are never logged or written by this module.

For manual lifecycle management, call the returned session's idempotent `close()`
in `finally`. Playwright's process exit cleanup and SIGINT, SIGTERM and SIGHUP
handlers remain enabled; no asynchronous Node `exit` handler is installed.

Install the matching bundled browser with
`pnpm --filter @agentcast/recorder exec playwright-core install chromium`.
The real browser tests run when that binary is installed. To run against an
existing local Chrome instead:

```sh
AGENTCAST_TEST_CHROMIUM=/usr/bin/google-chrome pnpm test
```

`launchOptions` supports an explicit executable for local checks; it cannot
disable headless mode or the signal handlers.

## GPU selection and fallback

The default `gpu: "auto"` tries dGPU → iGPU → CPU. `gpu: "dgpu"` uses the same
order; `gpu: "igpu"` starts at the integrated adapter; `gpu: "cpu"` skips GPU
detection. A failed browser is closed before another one is started. Selection
occurs before injecting saved credentials or navigating to the product. There
is no automatic replay of actions after a later driver crash.

The optional `vulkaninfo --summary` utility reports physical adapter types.
Without it, Linux sysfs identifies NVIDIA adapters and Intel chipset graphics.
Unknown adapters are skipped instead of being labelled as verified hardware.
NVIDIA uses PRIME offload, Mesa uses `DRI_PRIME` vendor/device routing, and
CPU uses SwiftShader. Child-specific environments remove inherited routing
selectors, so a forced NVIDIA setting cannot contaminate an Intel/CPU fallback.
The worker's environment remains unchanged. Hardware launch and probe timeouts
are bounded. Conflicting raw GPU flags are rejected; select the `gpu` option
instead.

Hardware selection requires a successful WebGL pixel readback, the expected
adapter's renderer, and CDP hardware compositing. CPU selection requires a
software renderer. `session.gpu` exposes the result and each failed/skipped
attempt, with no raw launch command lines or credentials. The library does not
write a diagnostics artifact or choose an FFmpeg hardware encoder.

Each launcher gets its own stealth plugin instance. WebGL vendor spoofing is
disabled so it cannot disguise CPU rendering as GPU acceleration. The plugin's
UA override is disabled for mobile/custom user agents. Use `stealth: false`
to opt out. These settings do not change the existing policy for explicit
access blocks.

Run the real browser tests with hardware required on a machine with both GPUs:

```sh
AGENTCAST_TEST_CHROMIUM=/usr/bin/google-chrome AGENTCAST_REQUIRE_GPU=1 pnpm test
```

Tests cover session restoration, viewport/touch/UA settings, stealth isolation,
CDP screencast frames, actual GPU/CPU renderers, fallback failures and shutdown.

## Live recording

`recordLive()` combines browser launch, CDP capture, stall checks, retakes and
validated CFR MP4 encoding. The action callback receives the existing browser
session plus `attempt`, `signal`, `now()` (scene milliseconds) and `motion()`.

```ts
import { recordLive } from "@agentcast/recorder";

const recording = await recordLive(
  {
    outputPath: ".agentcast/recordings/demo.mp4",
    browser: { formFactor: "desktop", gpu: "auto" },
    prepare: async ({ page }, attempt, signal) => {
      // Reset your demo data here when each take must start from the same state.
      signal.throwIfAborted();
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
    },
  },
  async ({ page, motion, signal }) => {
    // Your app's animation/scroll driver must be replayable.
    await motion(() => performAnimatedScene(page, signal));
  },
);

console.info(
  recording.path,
  recording.encoder,
  recording.stall,
  recording.takes,
);
```

Wrap expected continuous scrolling/animation in `motion()`. Exclude static holds,
locator resolution and loading waits. A maximum source-frame gap above 250 ms
or p95 above 60 ms in those windows retries the entire take, up to `maxTakes`
(default 3, maximum 3). Leading/trailing silence is measured too. No motion
windows means `stall.status: "not-applicable"`; it does not claim that animation
quality was checked. Capture is paint-driven, so a static page may need just one
JPEG for a long hold. The recorder cannot infer intended motion from silence
alone; the scene/flow driver must declare it.

The callback and `prepare` run again in a fresh browser after a quality failure.
Arrange app-state reset in `prepare` for flows that mutate server data. Action
errors, cancel and timeout do not automatically replay the callback. Cancel with
`signal`; each take is bounded by `timeoutMs` (default 120 seconds, including
launch/preparation/encoding). Temporary frames and partial videos are removed
after success/failure. Existing output files are never overwritten.

Frames are ACKed before disk writes and queued with a 64 MiB default byte limit.
`capture` accepts `quality`, `maxQueueBytes` and `firstFrameTimeoutMs`. Overflow
fails instead of silently dropping frames. The video preserves original timing
and the last-frame hold, rounds duration up to the next 30 fps frame, converts
full-range JPEG to limited-range H.264 `yuv420p`, and uses frequent keyframes
(`-g 15`) with fast-start metadata. Validation checks every decoded presentation
timestamp; advertised average frame rate alone is insufficient.

The browser's physical device scale factor matches the context DPR so screencast
frames contain actual viewport × DPR pixels without changing CSS coordinates or
breaking Playwright hit testing. Encoding validates the expected physical source
dimensions before publishing. The capture clock prefers CDP's monotonic frame
timestamps when available and falls back to epoch timestamps on older Chrome;
both are converted from seconds to milliseconds before alignment.

`encoding.encoder` defaults to `"auto"`: probe NVENC → Quick Sync → x264 with a
real encode. If encoding at the recording's actual dimensions fails, try the next
encoder using the same captured frames. Set `"libx264"` for deterministic CPU
encoding, or select `"h264_nvenc"`/`"h264_qsv"` explicitly to require one encoder.
`encoding` also accepts FFmpeg/ffprobe executable paths and an encoding timeout.
The capability probe uses 640×360 frames because a 128×128 sample is below the
minimum dimensions supported by some NVIDIA hardware; actual-size encoding is
still validated separately.

`startScreencast()` and `encodeCfrMp4()` expose the lower-level pieces for callers
that own their browser and temporary directory. Always stop capture in `finally`
and retain its JPEGs until encoding finishes. Same-target navigations continue
recording; opening a new page during `recordLive()` fails explicitly. Automatic
popup retargeting, flow resolution, timeline/event artifacts, and worker/CLI
wiring remain separate tasks. Studio mode is not implemented here.

Run all recorder checks, including strict hardware checks on this NVIDIA/Intel
machine, with the GPU suites serialized because they share physical devices:

```sh
AGENTCAST_TEST_CHROMIUM=/usr/bin/google-chrome AGENTCAST_REQUIRE_GPU=1 AGENTCAST_REQUIRE_NVENC=1 pnpm test --no-file-parallelism
pnpm typecheck
```

The referenced `spikes/s1-record/record.ts` is absent; the implementation lives
in `src/screencast.ts`, `src/timing.ts`, `src/encode.ts`, and `src/live.ts`.
