# Recorder browser launcher

`launchRecorderBrowser()` starts a separate browser in modern headless mode for
each call: Google Chrome stable by default (it has the H.264/AAC codecs product
videos need), or Playwright's bundled Chromium when Chrome isn't installed. The
first one that launches is kept for the rest of the process; `session.gpu.channel`
says which ran. The desktop default is 1440×900 at DPR 2; mobile
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
It is passed to `browser.newContext`, so Playwright sets the cookies and each
origin's localStorage once, before any page loads. What the app writes afterwards
(a refreshed token, new data) survives reloads and navigations. State and
credentials are never logged or written by this module.

For manual lifecycle management, call the returned session's idempotent `close()`
in `finally`. Playwright's process exit cleanup and SIGINT, SIGTERM and SIGHUP
handlers remain enabled; no asynchronous Node `exit` handler is installed.

Without Google Chrome, install the matching bundled browser with
`pnpm --filter @agentcast/recorder exec playwright-core install chromium`.
The real browser tests run when either is available. To pin a specific
executable instead:

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
adapter's renderer, and CDP hardware compositing. ANGLE's OpenGL renderer has no
PCI IDs, so a Vulkan-detected adapter is matched by its model name (without the
driver suffix in parentheses, which differs between Vulkan and OpenGL), and a
sysfs-detected adapter by its vendor (sysfs only reports NVIDIA dGPUs and Intel
chipset graphics; an Arc renderer is rejected for the iGPU). CPU selection
requires a software renderer, or no WebGL at all with software compositing: a
page only has to paint to be recorded. Adapters are detected once per process,
and a browser that won't close after a failed probe is abandoned after 5 s so
the fallback still runs. `session.gpu` exposes the result and each failed/skipped
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
`signal`; each take's launch, preparation and recorded flow are bounded by
`timeoutMs` (default 120 seconds). Encoding is not: it has its own limit
(`encoding.timeoutMs`, default 120 s or 10 s per second of video, whichever is
longer). Retakes reuse the GPU backend the first take selected. Temporary frames and partial videos are removed
after success/failure. Existing output files are never overwritten.

Frames are ACKed before disk writes and queued with a 64 MiB default byte limit.
`capture` accepts `quality`, `maxQueueBytes` and `firstFrameTimeoutMs`. Overflow
fails instead of silently dropping frames. The video preserves original timing
and the last-frame hold, rounds duration up to the next 30 fps frame, converts
full-range JPEG to limited-range H.264 `yuv420p`, and uses frequent keyframes
(`-g 15`) with fast-start metadata. Validation checks every packet's timestamp
and keyframe flag (`ffprobe -show_packets`, no decoding); advertised average frame
rate alone is insufficient.

The browser's physical device scale factor matches the context DPR so screencast
frames contain actual viewport × DPR pixels without changing CSS coordinates or
breaking Playwright hit testing. The capture size uses the DPR the recorder
configured (`session.deviceScaleFactor`), never the page's `devicePixelRatio`,
which page scripts can redefine. A frame older than the last one (GPU compositing
occasionally delivers one late) is skipped like a duplicate. Encoding validates the expected physical source
dimensions before publishing. The capture clock prefers CDP's monotonic frame
timestamps when available and falls back to epoch timestamps on older Chrome;
both are converted from seconds to milliseconds before alignment.

`encoding.encoder` defaults to `"auto"`: probe NVENC → Quick Sync → x264 with a
real encode, once per encoder per process. If encoding at the recording's actual dimensions fails, try the next
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
popup retargeting and worker/CLI wiring remain separate tasks. Studio mode is
not implemented here. `recordFlow()` below adds compilation and timeline artifacts.

Run all recorder checks, including strict hardware checks on this NVIDIA/Intel
machine, with the GPU suites serialized because they share physical devices:

```sh
AGENTCAST_TEST_CHROMIUM=/usr/bin/google-chrome AGENTCAST_REQUIRE_GPU=1 AGENTCAST_REQUIRE_NVENC=1 pnpm test --no-file-parallelism
pnpm typecheck
```

The referenced `spikes/s1-record/record.ts` is absent; the implementation lives
in `src/screencast.ts`, `src/timing.ts`, `src/encode.ts`, and `src/live.ts`.

## Flow target resolution

`resolveTarget(page, step, options)` implements cache → role → label → placeholder
→ exact text → fuzzy name → LLM heal. It accepts the shared `Step` contract and
returns `{ locator, bbox, method, strategy, entry?, elapsedMs }`. The bbox uses CSS
pixels. Resolution never clicks, types, or executes cached JavaScript.

```ts
import { resolveTarget } from "@agentcast/recorder";
import { jobPaths } from "@agentcast/shared";

const target = await resolveTarget(page, step, {
  replayPlanPath: ctx.path(jobPaths.replayPlan),
  flowId: flow.id,
  formFactor: "desktop",
  signal: ctx.signal,
  heal: true,
  llm: ctx.llm,
  onLlmEvent: ctx.llmProgress,
  secretValues: flow.steps.filter((s) => s.secret).map((s) => s.value ?? ""),
});

// For a click step, the actuator can now use the verified target:
await target.locator.click();
if (target.entry) ctx.artifact(jobPaths.replayPlan);
```

Use the same resolver inside `recordLive()`'s callback, passing its `page` and
`signal`. The integration test records a three-step create-project flow at DPR 2
and validates both its MP4 and replay-plan artifact. For paced actions with
outcome verification and complete-take learning, use `recordFlow()` below.

The first lookup waits for DOM quiet (300 ms, capped at 1 s) and the chain shares
one `timeoutMs` budget (default 4000 ms). `pollIntervalMs` defaults to 100 ms and
`maxCandidates` to 100. A page navigation invalidates the initial settle state.
Use `settle: false` when your caller has already settled the page. Missing,
disabled, hidden, readonly typing, and incompatible select targets fall through.

An explicit `target.near` hint picks an unambiguous nearest visible target.
If its text is absent, normal viewport/link disambiguation still applies. A
role-only target (for example an unnamed checkbox) uses these same checks.
Without an available hint, prefer the sole on-screen match; duplicate links can
prefer the unique main-content copy only if they all point at the same URL.
Scroll targets prefer the first below-fold match even when a copy is on screen.
Remaining ambiguity fails explicitly.
Fuzzy matching normalizes Unicode, case, whitespace, punctuation and symbols,
and conservatively allows short edit/transposition distances on longer names.
It refuses differing numeric IDs and tied best scores.

LLM healing is opt-in (`heal: true`), with `healTimeoutMs` defaulting to 45 s.
Without an injected runner it uses `sharedLlm()` from `@agentcast/llm`; the worker
should supply `ctx.llm` and `ctx.llmProgress`. No vendor SDK or CLI is invoked
by the recorder. Intent and accessibility data are delimited as untrusted,
typed values are omitted, inputs/known secrets are masked, and private scratch
files are removed after the call. The model can decline with null role/name.
Its answer is schema-checked and must resolve to a verified live target.

`replayPlanPath` enables validated atomic cache reads/writes. Entries preserve
`learnedExpect`, use existing schema-version-1 strategies, and contain exact
semantic queries rather than `.nth()` ordinals. `method: "fuzzy"` distinguishes
a fuzzy resolution in memory; its cache strategy is the resulting role/text
query. Cache hits are revalidated before use. Supply `flowId` to avoid collisions
between steps such as `s1` in different flows; `replayKey(step.id, flow.id)` gives
the cache key. Omit `flowId` to retain legacy bare step keys. Invalidate an entry
when the caller edits a step's intent. Sensitive locator names omit `entry` and
are never persisted. Re-resolve after intervening DOM changes.

Run just the locator tests with local Chrome (LLM tests use fake CLIs, no quota):

```sh
AGENTCAST_TEST_CHROMIUM=/usr/bin/google-chrome pnpm test packages/recorder/src/flow --no-file-parallelism
```

## Verified flow recording

`recordFlow(flow, options)` (also exported as `compileFlow`) accepts a shared
`Flow` and records one verified Live subclip. It writes `recording.mp4`,
`timeline.json` and `replay-plan.json`; timeline/replay paths default beside
`outputPath`. All JSON reads/writes use the shared version-1 schemas.

```ts
import { recordFlow } from "@agentcast/recorder";

const result = await recordFlow(flow, {
  outputPath: "./record/create-project/recording.mp4",
  browser: { formFactor: "desktop", gpu: "auto", storageState },
  signal,
  locate: { heal: true, llm, onLlmEvent },
  // Optional: reset server data and navigate before EVERY take, outside capture.
  prepare: async ({ page }, attempt, signal) => {
    signal.throwIfAborted();
    await resetDemoData();
    await page.goto(flow.startUrl, { waitUntil: "domcontentloaded" });
  },
  hygiene: { redactSelectors: [".private-balance"], secretValues: [] },
});
```

Without `prepare`, the recorder navigates to `flow.startUrl` on each fresh
browser. Saved storage is restored by the launcher. Resetting mutations to a
server remains the caller's responsibility. A flow must contain an interaction;
navigation/wait-only flows and duplicate step IDs are rejected before launch.
When the initial step has a target, it resolves/heals before capture starts,
then revalidates during capture. Delayed hydration does not consume video time.

Actions use a cubic Bézier mouse path with slight overshoot, distance-scaled
300–700 ms movement at roughly 60 Hz, a 150 ms hover pause, 35–70 ms typing
jitter and eased wheel increments. Typing replaces the current value; native
single selects accept an option value or exact visible label. Scroll values are
pixels; wait values accept milliseconds or `s`, capped at 10 seconds. Cursor
segments/bboxes are saved in the timeline; detailed samples are returned as
`cursorSamples` for post-production. Chromium screencasts do not include the
system cursor. A visible cursor overlay and native mobile touch gestures are
separate renderer/mobile work.

After acting, settle races DOM quiet (300 ms) against request inactivity
(500 ms), with a 4-second cap. Finite running animations delay settle and supply
measured motion windows to Live's existing stall check; continuous scroll is
marked by the actuator. Static mouse moves/typing are not classified as
continuous visual animation. The verifier then polls for up to 5 seconds.
`settleTimeoutMs` and `outcomeTimeoutMs` adjust these budgets. Resolution waits
and conservatively identified static outcome waits beyond 600 ms become timeline
dead intervals, preserving animation and the arrival of results.

Checks prefer cached `learnedExpect`, then `step.expect`, then action-implied
values, then meaningful change. Input/select values are checked even alongside
stronger checks. All checks must pass; URL patterns use `*` for one path segment
and `**` across segments, including hash-router paths. Loose text is
case/whitespace insensitive, text/elements must intersect the viewport, and
spinner/timestamp-only changes do not satisfy `changed`. `expected` remains a
description for labels/healing, not an executable assertion. Hover/wait can be
intentional holds; add explicit expectations when they should reveal content.
Learned checks include generalized URL paths, new exact headings/dialogs/toasts
and safe input values. Non-locator steps use an empty, non-executable locator
entry to store their checks. Secrets are excluded from learning.

Locator, action, outcome and stall failures share **one limit of three takes**
(`maxTakes` accepts 1–3). Each retake uses a new browser. With `locate.heal`, a
failed target is re-picked using the failed expectation, sanitized before/after
ARIA and masked screenshots, even when the old target still resolves. Healing
only picks a target; automatic prerequisite clicks are not implemented. Strong
failed checks are never weakened or silently relearned. Cancellation and
infrastructure errors stop immediately. `FlowRecordingError.takes`, `flowTakes`
and `onTake` expose sanitized failure/progress details.

Only a complete take that passes outcomes, stalls and video validation commits
the replay plan. Failed takes remove all scratch frames and footage. Video and
timeline are published exclusively without overwriting existing files; a
publication/learning error removes files published by this call. Replay updates
are atomic and preserve unrelated flows/form factors. Outputs on different
filesystems are not supported because publication uses hard links.

Hygiene is installed before navigation and reinstalls on new documents. It hides
scrollbars/carets, waits for fonts, dismisses an unambiguous cookie consent button,
and blurs password/email fields, known secrets, email/token text and custom
selectors, including dynamic content. Secret targets are masked before typing.
Their timeline values are `{ "redacted": true }`; raw typed secrets never enter
repair prompts or learned checks. Use custom selectors for other private data.

The worker's record stage and CLI are still stubs; this API records individual
flows and does not concatenate multiple flow subclips or publish worker events.

See [FLOW_COMPARISON.md](FLOW_COMPARISON.md) for the reference-project comparison,
the complete reference test inventory, adapted coverage and remaining differences.
