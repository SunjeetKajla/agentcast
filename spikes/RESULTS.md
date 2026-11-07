# Browser Harness migration — 2026-11-07

Local integration against an owned HTTP fixture passed with pinned Browser Harness 0.1.13 / Python 3.12 and dedicated headless Google Chrome. The fixture verified MCP image delivery, a real button click and visible outcome, stale-target rejection, destructive-action rejection, actual-action trace persistence and successful cleanup.

A real logged-in Codex CLI 0.167.0 browser smoke test passed: observe → click Show preview → verify Preview ready → submit validated report. Only the task-owned MCP server was configured; shell, user settings and unrelated tools remained disabled. The installed CLI needs per-tool `approval_mode="approve"` for these explicitly authorized tools; `auto` still rejected calls under approval policy never.

The Claude runner now uses explicit settings isolation and tools/MCP configuration instead of the unsupported `--restricted` flag found on an older installation. After login, the configured Claude Code CLI also passed the real observe → click → verify → submit smoke test in 13 seconds. Fake-CLI contract tests cover both adapters.

These checks use a controlled local fixture. They do not establish broad website coverage or a completed voiced/video-rendering job. Tests are in `packages/browser/src/browser.integration.test.ts`; setup and optional login checks are in its README.

The complete local exploration integration also passed: a real Codex scout proposed at least two candidates, focused runs executed them in separate browsers, the existing Playwright adapter independently rehearsed at least two agent-origin flows, and shared flow artifacts validated as v2. Runtime: 87 seconds against the controlled PreviewForge HTTP fixture. Authenticated-session cancellation checks verified no published live frames or session values in traces. Web screenshots at 1440/768/390 px showed the new local frame panel without overflow or legacy URL requests. Full workspace typecheck, 332 tests including real browser/private-session checks and the production web build passed before this additional optional pipeline check.

Claude Code also passed the full local discovery → focused execution → independent Playwright rehearsal integration in 56 seconds, producing at least two selected agent-origin flows with clean rehearsals. Both live checks honor the project's configured CLI binaries while explicitly selecting the requested backend for the test. The final suite passed 332 tests (94 optional tests skipped); full typecheck, doctor and the rebuilt web app also passed.

## Linear public-site browser benchmark — 2026-11-07

A browser-only live run tested public `https://linear.app/` with both logged-in CLI backends: Codex default model and Claude Code `opus`. Each scout identified six public workflows, followed by all six focused attempts (two isolated browsers at a time). No worker job, independent rehearsal, recording, voice or render ran. Actual workspace operations were behind sign-in.

Codex: scouting 122.56 s, focused attempts 181.79 s, total 304.35 s (5m 04s), 4/6 reported complete. Claude: scouting 138.05 s, focused attempts 102.03 s, total 240.08 s (4m 00s), 6/6 reported complete. These were different six-flow inventories, so this is not a matched-workload speed ranking. Claude's integration search reached a changelog result rather than an integration card; the report preserves that limitation.

Successful tool latency (median/p95): observation 63/150 ms on Codex and 60/157 ms on Claude; click 354/526 ms and 341/439 ms; navigation 1064/2045 ms and 963/1155 ms. Clicks include the existing 250 ms settle delay. Codex had seven rejected/failed tool calls and Claude four. Most task time was outside measured browser tool responses, including CLI/model time between calls and report generation.

The initial attempt failed before either model started: `document.body` was missing immediately after navigation. The bridge now waits up to 15 seconds for a readable HTTP(S) body and retries transient navigation-context replacement. Both delayed-body and authenticated-session/cancellation Chrome regressions passed (2 tests), and browser/spike typechecks passed. Initial failed attempts (5.24 s Codex, 6.52 s Claude) are excluded from the clean timings above.

[Full per-flow results and measurement method](linear-browser-benchmark.md). Reproduce with `node --import tsx spikes/browser-harness-benchmark.ts --url https://linear.app/ --backend both --max-flows 6`. Screenshots, traces and raw timing logs remain under `/tmp`, outside version control.

## Historical pre-migration spike evidence

The following records describe the removed provider and earlier architecture; they are retained as history, not current setup or implementation guidance.

# Spike results

One section per spike (IMPLEMENTATION_PLAN.md Phase 0): the question, what we ran, the numbers, go/no-go, and what changed in the PRD.

## Sunjeet: exploration and sign-in integration (HackIIIT, IIIT Delhi)

Validated the new recorder launcher through fresh local Chrome fixtures, without paid services. Six exploration regressions passed: delayed SPA hydration and hidden auth copy, three real access barriers, prerequisite-dependent flow replay with review frames, and duplicate-target/named-field checks. Three ordinary-Chrome sign-in regressions passed: cookies/localStorage survive capture without reloading the real site, a competing window is refused, and cancellation releases the profile reservation. The sign-in suite took 44.24 s, including Chrome's cookie flush wait.

Free TinyFish key and ElevenLabs subscription probes both succeeded on 2026-10-24; ElevenLabs reported a free plan. No speech or agent runs were created by those probes. The implementations retain the existing PRD decisions: public mode does not demand a separate app/login, remote stealth does not prove local replayability, and sign-in uses an ordinary window before automation captures state. No architecture change is proposed. Worker action routing, shared registration of exploration checkpoints and real recording/rendering remain separate integration work; see `packages/explore/IMPLEMENTATION.md`.

### Bounded live EN/HI narration

A temporary smoke test generated one short line per language using the configured ElevenLabs account and premade voices. Both succeeded on `eleven_v4`: EN 3.600 s / 7 timed words, HI 3.040 s / 7 timed words. There were two speech requests for 90 source characters total, with no model fallback. Both clips passed the timing checks and ffprobe measurement; an immediate repeat reused both with zero further speech requests. Temporary scripts, audio and manifests were removed during pre-commit cleanup. This proves generation, timing and exact reuse against the live provider; naturalness still needs a native Hindi listener, and it is not an end-to-end video render.

### Codeforces live exploration check

TinyFish Fetch read the public Codeforces homepage and help page, and Codex produced the product and creative briefs. The normal discovery stage then failed during the local entrance check, before any TinyFish Agent run was created. A separate navigation-only diagnostic reached HTTP 200; that did not exercise the failing page-inspection callback, so it was insufficient evidence of a transient network problem. Later repeated failures on Cardboard and DemoBoard exposed `ReferenceError: __name is not defined` in tsx-compiled browser callbacks. The shared inspection code now serializes the compiler helper in a local lexical scope, with a regression test that runs the actual tsx compiler. The Codeforces live Agent/stealth path remains unverified by the original check. That test was stopped at the user's request, and its temporary scripts and isolated job data were removed.

After the fix, complete local inspection through tsx succeeded on `https://www.cardboard.ai/` (page heading and image logo, 5.0 s) and `https://agent-cast-beta.vercel.app/` (DemoBoard heading and inline SVG logo, 1.6 s). Both used the production browser adapter, with temporary output removed afterward. These checks made no TinyFish Agent or LLM requests and do not claim full exploration or video completion.


### Flipkart covered-link recovery

The saved public `Exploring Fashion` flow from `job_mvmtzozp39d7a5` replayed successfully through the production local adapter after the covered-click recovery changes (5.8 s, bounded to 30 s). This check used no TinyFish or voice requests, created no new video job, and removed its temporary screenshots afterward. The localhost browser tests separately verify Escape-dismissable overlays, persistent overlays failing without forced clicks, and absent optional dismissal steps. Offline stage tests verify preserving successful takes, reusing them on retry, excluding failed footage from narration, and rejecting failed rehearsals at gate 1. This is not a full Flipkart video render or a guarantee against future site changes.


### Integration with main

Local integration preserves main's full `recordFlow` compiler, semantic replay format, AI director/still review/revisions, voiceover setting and gate-action UI/API. It adds the branch's cancellation cleanup, bounded inspection/evaluation recovery, failed-rehearsal approval protection and reusable successful-take checkpoints. Validation includes the full offline suite, workspace typechecks, production web build, 52 installed-Chrome integration checks (including actual recordings and overlay recovery), and a short real Remotion H.264 render. These fixture checks spend no TinyFish/ElevenLabs quota and do not imply arbitrary live sites always succeed.
