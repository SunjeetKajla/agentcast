# Explore, Story, Voice and auth handoff — HackIIIT, IIIT Delhi

The implementation lives on `sunjeet/tinyfish-client`. All six Sunjeet-owned worker stages use real package functions by default. Existing worker fixture tests remain offline: `AGENTCAST_STAGE_MODE=stub` explicitly enables fixtures; setting `AGENTCAST_STUB_DELAY_MS` also retains the scaffold's fixture behavior unless `AGENTCAST_STAGE_MODE=real` is set. Provider errors never substitute fixture artifacts.

Main's UI refactor (`d6b3584`) is now integrated. `pnpm dev:web` starts `apps/web`; it supports job creation, public/sign-in-once choices, live stage/agent events and the three review gates through server proxies. Its production build and combined regression suite passed after integration. Gate-action editing and the sign-in completion button still require the worker/UI wiring listed below; closing Chrome remains the available sign-in completion path.

## Implemented boundaries

- `@agentcast/tinyfish`: Fetch, async runs, SSE with polling recovery, run cancellation, screenshots, Browser, Vault and Profiles. Run-creating POSTs are never automatically retried. Browser owners must delete sessions in `finally`.
- `understand`: Fetch root and up to nine linked pages, local browser fallback, product brief, creative brief and browser-derived brand kit. Brand capture handles header images, styled inline SVGs, CSS background marks and touch icons; chosen marks are saved as PNGs to avoid persisting active website markup. It extracts hero gradients and checks arbitrary font families against the public Google Fonts stylesheet endpoint, with a bounded cache and category fallbacks.
- `discover` / `flow-runs`: a short stealth scout and up to three focused candidates, two remote runs at a time process-wide, checkpoint before submission and run ID before polling, deadlines and loop detection. A failed local rehearsal gets at most one repair. Independent local rehearsals gate selection; a generated guided tour supplements insufficient remote flows.
- Local rehearsals use Neeraj's `launchRecorderBrowser()` with a fresh browser/context for every flow. They resolve unique visible semantic targets, run prerequisites, check explicit outcomes and capture public review frames. Secret-bearing and destructive flows are excluded. Authenticated rehearsals currently omit screenshots to avoid persisting private account surfaces automatically.
- `@agentcast/story`: prompt interpretation, creative brief, timeline candidate spans, trailer/guide storyboards, English and Hindi narration scripts. The worker extracts representative recording frames before planning; both the flow judge and storyboard writer receive available public visual evidence. All model calls use the current `packages/llm` interface through `workspaceLlm()`; input files are delimited as untrusted data. Storyboard and creative-brief fallbacks are deterministic; scripts require a valid writer response. Model plans must have exactly one opening hook and one closing CTA.
- `@agentcast/voice`: ElevenLabs plan/voice selection, timestamped clips, word timing checks, quota preflight and model fallback. Clip keys include voice, model, language, spoken text and neighboring lines. Incremental manifests retain successful clips after interruption.
- `auth`: opens ordinary Chrome with a separate persistent site profile, without Playwright attachment or a DevTools port while the user signs in. Closing Chrome completes sign-in. The existing `makeAuth({done})` seam also accepts a UI completion promise. Session extraction blocks network requests to the real site, then seals the authorized product's cookies/localStorage with AES-GCM. Failed profile upload reuses the sealed session and saved profile ID on retry. Vault mode uses Vault item IDs for remote agents and a locally captured session for rehearsal.
- Flow review exports `editStep(ctx, payload)` and `addFlow(ctx, payload)` from `apps/worker/src/stages/flow-runs.ts`. Both rehearse changes before selection and update replay locators.

## Pending teammate integration

1. **Kaustav: action routes.** Route gate-1 `edit-step` and `add-flow` actions to those exports, with per-job serialization and checks that the job is still waiting at gate 1. These actions must keep the gate open. Step edit payload is `{flowId, stepId, text?, value?}`; add flow is `{description}`. The functions do not implement HTTP authorization or request concurrency.
2. **Kaustav: sign-in completion signal.** Supply the job's `signed-in` promise as `done` to `makeAuth()`, or expose the equivalent context signal. Until then users finish by closing the ordinary Chrome window. UI completion is not wired in the current worker core.
3. **Kaustav: shared artifact registration.** `packages/explore/src/artifacts.ts` currently supplies validated local contracts for `explore/tasks/<id>.json`, `explore/plan.json`, `explore/rehearsals/<flow>.json`, and private `auth/state.json`. Move these to shared schemas/paths/registry additively, preserving current v1 files. Shared schemas remain teammate-owned; no existing contracts were renamed.
4. **Neeraj: recording.** The merged launcher and local rehearsal are integrated, but the worker's recording stage/flow compiler/timeline handoff still need their real implementation. Script expects one combined desktop `recording.mp4` and timeline, with `flowId` on events and flow source intervals. The current shared timeline schema requires `fps:30` even though recorder capture targets 60 fps; reconcile that in the shared contract before connecting real footage.
5. **Neeraj: authenticated recording.** Load `sessionFor(ctx)` from the auth stage and pass the returned storage state into recorder browser options. No session data should be served by `/files` or emitted in progress messages.

Remote sign-in, automatic script tightening after speech, mobile exploration and TinyFish fallback recording are later tasks; they are not claimed as complete by this implementation.

## Validation

Run the offline suite with `pnpm test`. It uses fake provider servers/CLIs and spends no quota. Browser regression tests are opt-in:

```sh
AGENTCAST_BROWSER_TESTS=1 pnpm exec vitest run packages/explore/src/local.test.ts packages/explore/src/sign-in.test.ts
```

They create temporary localhost fixtures and isolated Chrome profiles. Covered regressions include delayed hydration, hidden login/challenge copy, visible access barriers, prerequisite replay, ambiguous locators, named-field assertions, session capture without real-site reload, competing windows and cancellation. No account login is requested by these tests.

The worker script-stage integration test runs real ffmpeg against the repository's recording fixture, confirms JPEG evidence reaches the storyboard writer before planning, and validates English/Hindi script artifacts against the resulting beat IDs. Its LLM responses are fake, so it does not claim paid model quality or full-video rendering coverage.

Live provider checks and the bounded EN/HI speech check are recorded in `spikes/RESULTS.md`. Temporary probe scripts and generated test data were removed before committing; the repeatable regression tests remain. Live full-video validation remains pending the real recorder/video stages and worker action wiring; passing offline tests is not evidence of a finished real video.
