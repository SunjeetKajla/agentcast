# Fixtures

One small, consistent DemoBoard job, so every stage can be built and tested against its input before the stage upstream is real. `fixtures.test.ts` validates all of it against the schemas.

- `job/`: laid out exactly like a real job dir (`jobPaths` in `src/paths.ts`). Stub stages copy their outputs from here. One flow ("Create a project from a template"), a 6 s desktop recording with the timeline's target boxes drawn on it, a trailer storyboard of 5 beats, EN and HI scripts and voiceovers (quiet tones with evenly spaced word timings, not speech), and an EDL.
- `job-config.json`: a `POST /jobs` body.
- `job-state.json`: `state.json` for that job paused at gate 1 (`gate-flows`).
- `events.ndjson`: the event stream of a full run, for building the UI without a worker.
- `changes.json`: a re-run's change report.

From Node: `import { FIXTURE_JOB_DIR, FIXTURES_DIR } from "@agentcast/shared/node"`.

When your stage produces real output, replace its fixture with a small real one (keep it valid and keep the ids consistent: `flow-template`, steps `s1`–`s4`, beats `b-*`).
