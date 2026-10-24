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

This implements Phase 3 task 1 and GPU renderer selection in `IMPLEMENTATION_PLAN.md`. The referenced
`spikes/s1-record/record.ts` is absent from the scaffold; capture, CFR encoding,
stall checking and the worker record stage are subsequent tasks.
