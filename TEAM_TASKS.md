# TEAM_TASKS.md: 24-hour split

Who owns what, how we stay unblocked, and how we merge. The spec is `PRD.md` and the steps are in `IMPLEMENTATION_PLAN.md`. This file only says **who** does each part and **when**. Nothing is built yet (see `AGENTS.md`, "Current status").

## 1. Owners

Directory ownership is how we avoid merge conflicts. You can push freely in your own directories. To change someone else's, ask them first or send a small separate PR.

| Who | Role | Owns (directories) | Plan phases |
| --- | --- | --- | --- |
| **Kaustav** | Platform + Director, **merge captain** | root config, `packages/shared`, `apps/worker` (core, not stages), `packages/llm`, `packages/cli`, `packages/director`, `apps/worker/src/stages/{direct,rerun}.ts` | 1, 5b, 7, 8 |
| **Sunjeet** | Explore + Story + Voice | `packages/tinyfish`, `packages/explore`, `packages/story`, `packages/voice`, `stages/{understand,auth,discover,flow-runs,script,voice}.ts` | 2, 4 |
| **Neeraj** | Record + Video | `packages/recorder`, `packages/video`, `assets/music`, `stages/{record,preview,render}.ts` | 3, 5a, 5c, 6 |
| **Aditya** (UI) | Web app + demo target | `DESIGN.md`, `apps/web`, `apps/demoboard` | 1.5, 1.7, gate UIs, 6.6 |

## 2. How we stay unblocked: stubs and fixtures first

1. **H0 to H1.5: Kaustav bootstraps** and pushes to `main`:
   - pnpm workspace, `tsconfig.base.json`, vitest and prettier config, `.env.example`
   - every package folder with its `package.json` and an empty `src/index.ts`
   - **all known dependencies added up front**, so the lockfile rarely changes later
   - `packages/shared` v0: the zod schemas from PRD §10
   - **one fixture per artifact** in `packages/shared/fixtures/`: `flows.json`, `timeline.json` + a short `recording.mp4`, `creative.json`, `storyboard.json`, `script.en.json`, `voice/en.json`, `edl.json`
   - the worker with **every stage stubbed in its own file**. A stub waits 2 s, copies its fixture into the job folder and emits events.

   From then on the whole pipeline "runs" end to end on fakes.
2. While Kaustav bootstraps, everyone else works only in files they own:
   - **Sunjeet:** TinyFish and ElevenLabs smoke scripts in `spikes/sunjeet-*`
   - **Neeraj:** Playwright screencast → mp4 in `spikes/neeraj-*`
   - **Aditya:** `DESIGN.md` (tokens, screens), then the `apps/demoboard` skeleton
3. **Your job is to replace your stub with the real stage.** Build against the fixture for your input, not against a teammate's live code. When your stage produces real output, update the fixture so the people downstream get better test data.
4. **Aditya** builds against the worker's stub mode (real REST + SSE, fake stages). The UI never waits for a real pipeline.

### Handoffs (all are files in the job folder, validated by zod)

```
Sunjeet: explore/flows.json ───────▶ Neeraj: record ─▶ record/desktop/{recording.mp4,timeline.json}
Neeraj:  timeline.json ────────────▶ Sunjeet: storyboard + script.<lang>.json ─▶ voice/<lang>.json
Sunjeet: storyboard/script/voice ──▶ Neeraj: baseline edl.json + renderVideo()
Neeraj:  baseline edl.json ────────▶ Kaustav: director (improves edl.json, re-validates)
Kaustav: REST + SSE events (§7.4) ─▶ Aditya: web app
```

## 3. Tasks (in priority order; work top to bottom)

**Kaustav: Platform + Director**
1. Bootstrap (above). Done means `pnpm typecheck && pnpm test` pass on `main`.
2. Orchestrator: async job store (`state.json` + `events.ndjson`), stage runner with pools, gates (autopilot skips them), retries, cancel, resume on restart.
3. REST API: `POST /jobs` (202), `GET /jobs/:id`, `POST /jobs/:id/gates/:gate`, gate actions, stage signals, SSE at `GET /jobs/:id/events`, `GET /files/*` (path-traversal safe).
4. `packages/llm`: claude-code adapter (`json` + `agent`, `--restricted --strict-mcp-config`, never `--bare`), concurrency pool, fake-CLI tests.
5. `agentcast doctor [--probe]`, `agentcast record`.
6. Director: workspace + `DIRECTOR.md` + motion guides, check CLI, repair rounds, stills review, baseline fallback, revise at gate 3 (resumed session).
7. Re-run on update: `agentcast rerun`, `POST /jobs/:id/rerun`, `remapEdl`, change report, `--skip-if-unchanged`.
8. Codex adapter, then opencode; `agentcast music add|list`; GitHub Action; guardrails and budget panel data (Phase 8).

**Sunjeet: Explore + Story + Voice**
1. `packages/tinyfish`: Fetch, Agent (SSE with polling fallback, async, cancel, step screenshots), Vault, Browser, Profiles. `DELETE` sessions in `finally`.
2. `understand` stage: Fetch → `product-brief.json`; brand kit (`brand.json`: logo, palette, theme, fonts, radius).
3. `discover` + `flow-runs`: entrance scout, ≤3 focused runs (2 at a time), local rehearsal, one repair each, durable checkpoints, guided tour fallback, judge + select (§9.2.1).
4. `packages/story`: creative brief → candidate spans → storyboard (trailer/guide arcs) → `script.en` / `script.hi`, all through `packages/llm`.
5. `packages/voice` + `voice` stage: ElevenLabs `with-timestamps`, a clip per beat per language, word timings, premade voice fallback, clip reuse.
6. Sign in once (local) + `auth` stage, Vault mode; gate actions `edit-step` and `add-flow`; then remote sign-in and auto-tighten.

**Neeraj: Record + Video**
1. Recorder: local Chromium launcher, CDP screencast → CFR mp4, Live mode with stall check.
2. Flow → take: locator chain (role → label → placeholder → text → fuzzy → LLM heal), human-like cursor, settle detection, outcome checks + learning, ≤3 takes, recording hygiene.
3. Timeline writer (`timeline.json`, `replay-plan.json`); `record` stage.
4. `packages/video`: VirtualCamera, Cursor + ripple, karaoke Captions, TitleCard and Outro, LowerThird, callouts, transitions, motion tokens, motion lint; `baseline.ts`.
5. `renderVideo()`; `preview` (540p) and `render` stages (16:9 + 9:16 × EN/HI); loudness pass; sidecars (SRT/VTT, poster, GIF).
6. Trailer grammar (statement/montage/stat scenes, speed ramps, music bed + ducking, sfx), brand-driven look; then Studio mode, mobile form factor, TinyFish fallback recorder.

**Aditya: Web + DemoBoard**
1. `DESIGN.md`: tokens, components, the 7 screens (PRD §5.1), landing page.
2. `apps/demoboard`: fixed demo sign-in, dashboard, new project from template, simulated "AI generate", chart, export. It needs to look good on camera, because it is what gets filmed. Deploy it to Vercel early.
3. `apps/web`: chat-style New video composer → `/jobs/[id]`: stage rail (SSE), activity log, live agent views.
4. Gate 1 (flow review, step edits, "describe another flow"), Gate 2 (storyboard, EN + HI), Gate 3 (preview + revise box), Outputs grid.
5. All worker calls go through `src/app/api/jobs/…` proxies.
6. Landing page, "Re-run on latest UI" + change report, sign-in-once UI, budget panel.

## 4. Schedule (H0 = kickoff)

| Hours | Milestone |
| --- | --- |
| H0 to 1.5 | Bootstrap merged. Everyone pulls. |
| H1.5 to 8 | Real stages built against fixtures. The UI renders stub jobs end to end. |
| **H9** | **M1:** DemoBoard URL → real flows → recorded mp4 → plain render, live in the UI |
| H9 to 15 | Script, voice, baseline edit, director. Gates 1 and 2 work in the UI. |
| **H16** | **M2:** full pipeline, EN 16:9, director edit, preview + revise |
| H16 to 20 | HI + 9:16, `rerun`, then keep working down your list |
| **H20** | **Feature freeze.** Pre-generate backup runs (DemoBoard + 1 real site). |
| H20 to 24 | Fixes only. README, demo script (Plan §2 Phase 9), rehearse ×2, submission video |

Sleep in shifts so at least two people are always awake. Kaustav and Neeraj should not sleep at the same time, because they hold the critical path (record → timeline → render).

## 5. Git rules (clean history, clean merges)

- **Repo setup (Sunjeet, who owns the GitHub repo):** add everyone as collaborators. In Settings, allow **squash merging only** and turn on "Automatically delete head branches". Protect `main`: no force pushes, changes go through PRs.
- **Branch per task:** `<name>/<scope>-<topic>`, e.g. `neeraj/recorder-screencast`. Keep it short-lived: **merge within about 3 hours**.
- **Stay current:** `git pull --rebase origin main` before you start and before you open a PR. Never merge `main` into your branch.
- **PR → squash merge** into `main`, so each PR becomes one commit. Title format: `feat(recorder): live screencast to mp4`. Use package names as scopes; `fix`, `chore` and `docs` work too.
- **`main` is always green.** Run `pnpm typecheck && pnpm test` before every PR. If you break `main`, fixing it is your top priority.
- **Merge windows:** merge whenever you're green, and at least at the **:00 of every 3rd hour** (H3, H6, H9 …), so nobody drifts far from `main`.
- **Hot files** (the usual source of conflicts):
  - `packages/shared/**`: Kaustav merges. Changes are **additive only** (new optional fields; never rename or remove). Send them as a tiny separate PR, and Kaustav merges it within 15 minutes.
  - `pnpm-lock.yaml`: add deps with `pnpm --filter <your-pkg> add x`. On a conflict, don't hand-edit it. Take `main`'s copy (`git checkout origin/main -- pnpm-lock.yaml`), then run `pnpm install` and commit the result.
  - `apps/worker/src/stages/index.ts` (registry) and root `package.json`: Kaustav only. Ask in chat.
  - `AGENTS.md`: Kaustav updates "Current status" and "Commands" at each merge window. Put your notes in your PR description.
  - `.env.example`: append-only.
  - `apps/demoboard` has its own npm lockfile (plan §2 Phase 1). Only Aditya touches it.
- **Don't:** reformat files you don't own, commit `.env` / `~/.agentcast` / videos, or force-push `main`.
