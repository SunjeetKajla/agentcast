# Architecture review: replay, video quality, speed, production

Written 2026-10-28 from the code on `hyperframes`, the 40 jobs in `~/.agentcast/jobs`, and the launch-film
teardown (`docs/LAUNCH_FILM_TEARDOWN.md`). These are **proposals**; once accepted, `PRD.md` and
`IMPLEMENTATION_PLAN.md` need updating (AGENTS.md rule 9). Several touch packages owned by
teammates (TEAM_TASKS.md), so each change is listed with the package it lands in.

## 0. Summary

| # | Problem | Root cause (measured) | Recommendation |
| --- | --- | --- | --- |
| 1 | Explored flows don't replay | Remote agent → natural-language step report → re-resolved in a *different* browser. Only **5 of 13** agent-reported flows rehearsed; 8 failed on "no unique element" or an entrance that differed locally. | **Replace TinyFish Agent with our own explorer, deployed on cloud browser workers, in the same browser session that records.** It captures locators from the real element at action time and verifies them before moving on. Protected sites are reached the sanctioned way: signed agent requests, customer allowlisting of verified domains, signed-in sessions (§2.4). |
| 2 | Videos lack motion design | The edit only has pixels (an MP4 of a page). The acted element is ~0.1% of the frame. Timing is voice-led and the music pumps. Sound effects are not synced to picture. The footage is often marketing pages. | **UI as layers**: element sprites + DOM snapshots captured while recording, animated in HyperFrames. A **motion-primitive system** from the teardown. **Music-led** timing for launches. **Sound effects bound to timeline events**. A **film lint** in the director loop. Prefer flows with visible state changes in the real app. |
| 3 | Too slow | ~16 min of machine time per video (median), 55% of it explore (discover ~160 s + flow-runs ~370 s). The director takes ~150 s; preview and render are full encodes. | Local explore (~1.5–2 min). Record while verifying. Template compiler + one structured LLM call instead of an agent loop by default. **Live HTML preview in the browser** instead of a 540p render. Parallel, layer-shared final renders. **Target: ~3–4 min from URL to preview.** |
| 4 | Production | Claude Code CLI on a personal subscription. One machine, local filesystem. Sign-in needs a desktop window on the worker. No tenant isolation, metering or domain verification. | API-key LLM backend (Anthropic API / Agent SDK), Postgres + object storage + a job queue. Containerised browser and render workers. Remote sign-in through a streamed browser or an extension. Domain verification, an eval corpus, cost metering. Phased plan in §5. |

## 1. Where we are (measured)

Stage time on finished jobs (seconds, median; range in brackets; gates excluded):

| understand | discover | flow-runs | record | script | voice | direct | preview | render | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22 [11–35] | 160 [10–600] | **369** [29–750] | 66 [17–180] | 42 [26–75] | 6 [1–21] | **151** [2–284] | 39 [20–75] | 96 [32–392] | **≈ 950 s ≈ 16 min** |

TinyFish runs: scout median **129 s** (p90 159 s), flow run median **156 s** (p90 220 s, max 1,408 s),
at most 2 concurrent per account. Two flows plus their repairs take 5–12 minutes before anything
is filmed.

Rehearsal outcomes across the eight jobs with saved rehearsals:

| Source | Rehearsed OK | Failed | Failure reasons |
| --- | --- | --- | --- |
| TinyFish agent flows | 5 | 8 | 5× "Step s1/s2: no unique visible element matched"; 1× HTTP 503 (Amazon); 1× "product page did not render usable content" (linear.app/demo, a 25 s client boot); 1× repair failed |
| Local guided tours | 13 | 7 | ambiguity, entrance errors |

The tours that pass are mostly **one click** (0.3–1.5 s of footage). The agent flows that pass give 4–20 s.
So the edit starts with very little footage, and much of it is marketing-site navigation.

## 2. Problem 1: why replays fail, and the fix

### 2.1 Diagnosis

The current chain is lossy at three points:

1. **The report is a description, not a reference.** The TinyFish agent acts on pixels in its own
   browser and then *reports* `target_text` / `target_role` / `near_text` in JSON
   (`packages/explore/src/agent.ts`). Those fields are the model's recollection:
   - **Role:** often wrong (a `link` reported as a `button`, as in job_mvmmoxt6f713c5).
   - **Text:** visual text, not DOM text (CSS `text-transform`, icon-only buttons, truncated labels).
   - **Uniqueness:** the reported text often matches several elements ("Projects" in the nav, a
     heading and a card). Our resolver correctly refuses to guess (`local.ts:506`).
2. **The environment differs.** The agent ran in a stealth cloud browser (US IPs, its own cookies,
   consent banners already dismissed, a different A/B bucket, a different viewport). The replay runs
   in a fresh local Chrome in India. Different page, different elements: Amazon returned 503 locally,
   and Linear's demo needed a 25 s boot.
3. **The repair goes through the same lossy channel.** We send the failure reason back as text and
   pay for another 2–3 min remote run, which reports another description.

No amount of locator cleverness fixes (1) and (2). The information we need (which DOM node was
clicked, in which page state) is never transmitted.

### 2.2 Options

| Option | What | Replay rate | Speed | Effort | Notes |
| --- | --- | --- | --- | --- | --- |
| A. Keep TinyFish Agent, ask for more fields | Add CSS paths and bbox to the output schema, longer goals | small gain: still self-reported, still a different browser | same (≥ 2.5 min/flow) | low | Doesn't fix the environment gap |
| **B. Own explorer in local Chromium** | A Claude-driven loop over Playwright in the same browser setup as the recorder; acts by element reference; locators captured and verified from the real node | **high** (target ≥ 85%, to measure) | **~30–60 s per flow, 3–4 in parallel** | medium (1–2 weeks to production quality) | We own the agent quality and the bot-wall problem |
| C. B + TinyFish Browser (CDP) as fallback | Same explorer and recorder, pointed at a remote stealth browser over CDP when the local entrance is blocked | high on walled sites too | slower on those sites only | +2–3 days | Keeps one code path; TinyFish becomes infrastructure, not a source of truth |

**Recommendation: B now, C as the fallback.** The explorer and the camera must look at the same page.
Locators come from the element itself and are checked for uniqueness on the spot, so they don't
depend on what the model remembers.

What we give up by dropping TinyFish Agent:
- **Stealth:** its residential/stealth browsers. Option C keeps them via the Browser API.
- **Live view:** its hosted live view. We already have CDP screencast; stream it to the UI instead.
- **Vault:** we have sealed sessions already.
- **Sponsor track:** the hackathon's "deep TinyFish usage" goal (PRD G7). That matters for judging,
  not for a product.

### 2.3 Design of the local explorer (`packages/explore`, new `explorer/`)

```
plan (1 LLM call)              explore (per flow, parallel)                  verify (deterministic)
┌───────────────┐   intents   ┌─────────────────────────────────────┐ steps ┌──────────────────────┐
│ page map +    │────────────▶│ observe: a11y snapshot with refs     │──────▶│ fresh context, replay │
│ product brief │             │   + small screenshot (set-of-marks)  │       │ captured locators,    │
│ + screenshots │             │ act(ref) → resolve node → fingerprint│       │ check learned outcomes│
└───────────────┘             │   → verify unique → act → diff state │◀──────│ fail → one repair turn│
                              └─────────────────────────────────────┘ repair└──────────────────────┘
```

- **Discovery without a remote scout.**
  - **Crawl:** a deterministic local crawl (entry page, nav and footer links, sitemap.xml, one hop,
    about 10 pages in about 10 s) builds a *page map*: headings, landmarks, forms, interactive
    controls, screenshots.
  - **Plan:** one planning call (smart tier) turns the map plus the product brief into 3–5 flow
    *intents*. It is biased toward **flows that end in a visible state change**: type a prompt and
    get a result, create an item, toggle a view, open a dashboard with data. Navigation-only tours
    are filler.
  - **Entrance:** detecting access (public / demo / sign-in / blocked) reuses `access.ts` and
    `openProduct`.
- **Act by reference, record the real node.**
  - **Observation:** an accessibility snapshot with stable refs (Playwright's `ariaSnapshot`, the
    same shape Playwright MCP uses), plus a downscaled screenshot with numbered marks for visual
    disambiguation.
  - **Tools:** `click(ref)`, `type(ref, text)`, `select(ref, value)`, `press(key)`,
    `scroll(ref?|dy)`, `navigate(url)` (same origin only), `wait(text)`, `done(value_shown)`,
    `abort(reason)`.
  - **Before each action** we resolve `ref` to the ElementHandle and compute its **fingerprint**:
    test id, role + exact accessible name, label, placeholder, text, landmark and ancestor path,
    nth-of-type CSS path, bbox.
  - We then build the locator chain `packages/recorder/src/flow/locate.ts` already understands and
    **assert `count() === 1` before acting**. If it isn't unique, narrow it to the nearest landmark
    or container.
  - The verified locator goes straight into the `ReplayPlan`, keyed `<flowId>/<stepId>` as today,
    so the recorder needs no changes.
- **Outcomes are observed, not reported.** After each action, diff URL, title, accessibility tree
  (new headings or dialogs, changed checked/expanded state) and network idle. Store the result as
  the step's `expect`, using the same learning code as `outcome.ts`.
- **Verify by replay, immediately.** When the agent calls `done`, replay the captured script in a
  **fresh context** with no pacing (usually 3–10 s).
  - **On failure:** the exact failing step and a new snapshot go back into *the same* agent session
    for one repair turn. That costs seconds, not another 2.5 min remote run.
  - **On success:** that run *is* the rehearsal.
- **Safety:**
  - website text stays wrapped as untrusted
  - navigation is locked to the authorised origin
  - no typing into password fields (sign-in-once handles auth)
  - destructive actions are filtered (`DESTRUCTIVE`)
  - step and time budgets per flow (about 25 actions, 90 s)
- **How it runs on the LLM layer (AGENTS.md rule 1 holds):**
  - **Now (CLI backends):** `packages/llm` gains an `mcp` option on `agent()` that passes one
    generated MCP config (instead of none) to `claude -p --strict-mcp-config`. Codex has an
    equivalent MCP config. Our stdio MCP server exposes the tools above and attaches to the
    job's Chrome over CDP. One agent session per flow keeps its cache warm.
    - **Why not `json()` per step:** spawning the CLI for every step would add seconds per action.
  - **Production:** an `anthropic-api` backend running the same tools through the SDK's Tool
    Runner (§5.1), with prompt caching on the system prompt and tool list. A fast model for steps
    and a smarter one for planning and judging. Tiers stay configurable.
- **What is reused:**
  - `locate.ts` (locator chain), `outcome.ts` (learned checks), `heal.ts` (healing at record time)
  - `access.ts` / `openProduct` / `readyPage`, `hygiene.ts`, `score.ts` (judge and selection)
  - the shared `Flow` / `ReplayPlan` contracts (one additive field: the step `fingerprint`, with a
    schemaVersion bump)
- **Bot walls:** if the local entrance gets 403/429/503 or a challenge page, re-run the same
  explorer and recorder against a TinyFish Browser API session over CDP (option C), recorded in
  state-capture mode as PRD §9.3.2 already plans. For sites the customer owns, the cleaner
  production answer is an allowlisted egress IP or a bypass header they add to their WAF (§5.5).

**Expected:**
- **Explore time:** from about 9 min (discover + flow-runs) to **about 1.5–2.5 min**.
- **Replay rate:** from 38% to ≥ 85% of agent flows.
- **Footage:** flows with real interaction depth instead of one-click tours.
- **Caveat:** these are estimates. Measure them on the eval corpus (§5.7) before deleting the
  TinyFish path.

**Risks:**
- Our agent quality on hard apps: canvas editors, drag-and-drop, iframes, multi-tab OAuth.
  Mitigation: tool coverage for drag/hover/iframe, and an "ask a human" fallback at gate 1, where
  "describe another flow" already exists.
- Cloud IP reputation: see §5.5.
- Prompt injection from page text: untrusted wrapping, an origin lock and a tool allowlist.

## 3. Problem 2: an architecture for motion design

The teardown's findings (§3 there) translate into five architectural changes. Today the edit
(`packages/video` + `packages/director`) composes *full-page footage + text cards*. The camera can
only crop and zoom a pixel stream, and the acted element is 56×24 px on a 1440×900 page.

### 3.1 Capture UI as layers during recording (`packages/recorder`)

Alongside `recording.mp4` and `timeline.json`, write a `layers/` folder per flow:

- `elements.json`: for each step, the acted element plus its semantic neighbourhood (container,
  siblings such as list rows, cards, chart SVGs, inputs, buttons): bbox, role, text, z-order and
  computed key styles (radius, background, shadow).
- `sprites/<step>/<el>.png`: DPR-3 element screenshots (`locator.screenshot`, about 20–60 ms each),
  for lift, pop, macro and stagger shots.
- `snapshots/<step>.html`: a static DOM snapshot of the key states.
  - **Contents:** computed styles inlined or stylesheets rewritten to local copies, fonts and
    images localised, scripts and event handlers removed, `data-ac-id` attributes on the elements
    in `elements.json`.
  - **What it enables:** HyperFrames scenes can load the snapshot and animate its real parts with
    GSAP: stagger rows and cards in, count numbers up, draw SVG chart paths
    (stroke-dashoffset), draw borders as wireframes then fill, grow a pill from a line, press
    and pop buttons.
  - **Sharpness:** vector-sharp at any zoom, so a 4× macro shot stays crisp.
- **Fidelity check:** render the snapshot in the same viewport and compare with the real screenshot
  (SSIM ≥ 0.9). Otherwise mark it `sprites-only`. Canvas, WebGL and closed shadow roots fall
  back to sprites, and sprites fall back to footage.

Trade-offs:
- **Recording time:** adds about 1–3 s per flow.
- **Disk:** about 5–20 MB per flow.
- **Privacy:** snapshots of signed-in apps contain private data. Treat them like footage: the
  redaction and hygiene rules apply, as do secret masking and tenant-scoped retention.
- **Accuracy:** snapshots are a *reconstruction*. The fidelity check is what keeps "real product,
  not a mock-up" honest. Never invent data that isn't in the snapshot.

### 3.2 A motion-primitive system (`packages/video`, `packages/director`)

Replace "shot / statement / montage + free-form scenes" as the main vocabulary with about 20
parameterised primitives taken from the teardown (§5 and §6.2 there):

- **Examples:** `labelCard`, `macroComponent`, `promptPullBack`, `lineToPill`, `wireframeBuild`,
  `staggerRows`, `countUp`, `drawPath`, `wordSwap`, `rolodex`, `irisWipe`, `glyphWipe`,
  `tiltedGlide`, `colourWorld`, `liftAndPress`, `focusPull`, `endCard`.
- **Each primitive declares:**
  - the layers it needs (snapshot / sprite / footage)
  - its default timing and ease
  - its minimum subject size (e.g. acted component ≥ 15% of frame width)
  - its sound-effect cues
- **Archetype templates** (teardown §4) are primitive sequences:
  - **Feature rapid-fire** (Raycast Pro, Superhuman): one module per flow, `labelCard → proof`, with
    an optional colour world per feature. It is the default launch template, because N explored
    flows map straight onto N modules.
  - **One-take glide:** for one hero interaction.
  - **Hype opener:** 4–6 s of kinetic type before either.
- **The EDL grows a `primitive` segment kind** (EDL v7, schemaVersion bump, PRD §10 update).
  `baseline.ts` becomes a *template compiler*: storyboard + layers + music analysis → primitives,
  with no LLM. The director picks and tunes primitives and only writes free HTML scenes when a
  beat earns it.

### 3.3 Music-led timing for launches (`packages/story`, `packages/video/music.ts`)

- **Launch (trailer) mode, the default:**
  - **Music:** pick the track first.
  - **Structure:** beat grid and sections (intro / build / drop / outro, already measurable by
    `sound.ts`) set the beat boundaries.
  - **Words:** on-screen type at 0.6–1.2 words/s carries them.
  - **Voice:** **off**. This matches 12 of 16 references.
  - **Shots:** footage is retimed (`retime.ts` speed ramps) to fit the music, not the other way
    round.
- **Guide mode:** voice-led, as today.
- **Effect:** removes the voice stage and the per-language voice cost from the default launch path.
  Languages become text-only re-typesets, which is also why rendering gets cheaper (§4).
- **Music source:** the library has two CC BY tracks (`assets/music/tags.json`; the audio files
  aren't committed), and CC BY requires a credit wherever a video is published. For production either license
  a catalogue (an API-licensed stock library), or generate per video with a music-generation
  model that grants commercial rights. Check the provider terms; the tracks must be cleared
  for customers' commercial use.

### 3.4 A sound engine bound to the timeline (`packages/video/audio.ts`, `sound.ts`)

- **Cues from timeline events, frame-exact:**
  - a click on the click frame
  - soft per-word ticks while typing
  - a whoosh 2–3 frames before each camera move
  - a pop on each reveal or stagger item (thinned to at most one per 80 ms)
  - a hit on each card cut
  - a riser into the logo, a sting on it
- **Target:** visual events on audio onsets ≥ 2× chance (ours is at chance today).
- **Mix:**
  - **Arc:** the music builds to a plateau at 50–75%, with an optional 0.6–1.2 s break before
    the reveal, then a decay to silence.
  - **Ducking (voice only):** −6 dB, about 150 ms attack, 400–600 ms release, held across gaps
    under 1.5 s. Today's ±10 dB pumping goes.
  - **Loudness:** final −14 LUFS (−12 for hype), true peak ≤ −1 dBTP.

### 3.5 Film lint inside the director loop (`packages/director/check.ts`)

Run `spikes/s8-teardown` measurements (productionised into `packages/video/measure.ts`) on the
preview, and feed failures back as issues next to the motion lint:
- scene-change rate, still %, audio-visual sync
- loudness arc, subject size
- end card

That gives the director (or the template compiler) an objective "this isn't a trailer yet" signal
instead of relying on taste alone. Targets are in teardown §7.

### 3.6 Content quality (`packages/explore`)

The best motion system can't fix footage of a marketing page. Production should default to
**signed-in or demo workspaces** (§5.4), and the planner should rank flows by
**visible state change and interaction depth**. Optionally, the explorer can *seed demo data* in
a sandbox workspace (create three sample projects first) so dashboards aren't empty, with the
user's consent at gate 1.

## 4. Problem 3: the timeline

| Stage | Now (median) | Proposal | Target |
| --- | --- | --- | --- |
| understand | 22 s | unchanged; runs **in parallel** with the local crawl | 0 s on the critical path |
| discover | 160 s | local crawl + one planning call (§2.3) | 15–25 s |
| flow-runs | 369 s | 3–4 local explorers in parallel; verify-by-replay inline; judge only over verified flows | 60–120 s |
| gate 1 | human | autopilot default for launches; the gate stays for guides | 0 s on autopilot |
| record | 66 s | **record during the verify replay** (Studio mode: virtual clock, deterministic, parallel per flow). Re-record only flows edited at gate 1 | 0–30 s |
| script + storyboard | 42 s | starts as soon as the first flow verifies (streaming), overlaps with recording | 0–20 s on the critical path |
| voice | 6 s | skipped in launch mode; parallel per language otherwise | 0 s |
| direct | 151 s | template compiler (no LLM) + **one** structured smart-tier call to choose and tune primitives; the agent session only for custom scenes and gate-3 revisions | 15–40 s |
| preview | 39 s | **no render**: the composition is HTML, so the job page plays it live with the HyperFrames runtime; revisions show in seconds | about 2 s |
| render (finals) | 96 s per variant, sequential | render shared layers once (footage, UI, motion), overlay per-language type and audio; chunked parallel rendering with NVENC; fan out variants across workers | 30–60 s for all variants |
| **URL → preview** | **≈ 13–14 min** of machine time | | **≈ 3–4 min** |

Other speed levers:
- **Cache per site, not per job.** Page map, brand kit, verified flows and locators keyed by origin
  plus a content hash. A second video for the same product, or `agentcast rerun`, skips explore
  entirely (the rerun path partly exists).
- **Warm pools.** Keep a pool of pre-launched Chromes (about 1–2 s saved per context) and a
  pre-bundled HyperFrames runtime.
- **Speculative work.** Start the brand kit, music pick and title-card render while explore is still
  running; none of them depend on flows.

## 5. Problem 4: taking it to production

### 5.1 LLM backend: move off the personal CLI login

- **The constraint:** driving `claude -p` on a personal subscription is right for the hackathon
  (no API key, AGENTS.md) but can't serve customers. Subscription logins are meant for an
  individual's own use, rate limits hit mid-job (job_mvmrve98632178 failed on "Claude Code hit a
  usage or rate limit"), and there's no per-tenant metering.
- **The backend:** add an **`anthropic-api` backend to `packages/llm`** behind the same
  `json()`/`agent()` interface:
  - **`json()`:** Messages API with structured outputs (`output_config.format`) replaces the
    repair round.
  - **`agent()` for the explorer:** the SDK's Tool Runner with our browser tools; prompt caching
    on system prompt + tools.
  - **`agent()` for the director:** needs a filesystem workspace and Claude Code's tools, so use the
    **Claude Agent SDK** (Claude Code as a library, API-key auth) in the render worker.
  - **Also:** typed errors map onto the existing `LlmError` codes; tier → model mapping lives in
    config.
- **Model routing:** current list prices per million tokens, input / output:
  - Haiku 5.5: $0.10 / $0.50, for explorer steps, classification and hygiene
  - Sonnet 5.5: $2 / $10, for planning, flow judging, storyboard and script
  - Opus 5.5: $4 / $20, for the director, revisions and the stills review
- **Rough cost per 30 s video** (estimate, to verify with real usage logs):
  - explore: about 40–60 steps on a fast model plus planning and judging on a smart model, about
    $0.10–0.60
  - story: about $0.10–0.30
  - director (agent, about 200k in / 20k out on Opus): about $1.2; template + one call: about $0.2
  - **LLM total: about $0.5–2 per video.**
- **Rule 1 still holds:** all calls go through `packages/llm`. Update AGENTS.md and PRD §9.9 to make
  the API backend supported, with the CLI backends kept for local development.

### 5.2 System shape

```
             ┌──────────── control plane ────────────┐
 web app ───▶│ API (Fastify) · auth · billing · Postgres (jobs, stages, events, tenants)
             │ object storage (S3/R2): artifacts, footage, layers, renders
             └──────┬───────────────────────────────┬─┘
                    │ queue (durable, per stage)    │ SSE / websockets (events)
     ┌──────────────┴──────────┐        ┌───────────┴─────────────┐
     │ browser workers          │        │ render workers           │
     │ Chrome per job context,  │        │ HyperFrames/ffmpeg,      │
     │ explorer + recorder +    │        │ NVENC or CPU, chunked,   │
     │ layer capture; sandboxed │        │ no network egress        │
     └──────────────────────────┘        └──────────────────────────┘
```

- **Keep the orchestrator's model** (stage graph, gates, resume, the artifact registry): it's the
  right abstraction. Swap the storage underneath:
  - `state.json` / `events.ndjson` → Postgres rows
  - `~/.agentcast/jobs/<id>/` → an object-storage prefix, with a local scratch cache on workers
  - `ctx.read`/`ctx.write` already centralise artifact I/O, so this is mostly one adapter
- **Queue:** start with a Postgres-backed queue (pg-boss or Graphile Worker: no new infrastructure,
  transactional with job state). Move to Temporal only if workflows outgrow it (long human gates,
  many retries, cross-region).
  - **Trade-off:** Temporal gives durable timers and replay for free but is a second system to run.
    The current orchestrator already does resume and gates.
- **Workers:**
  - **Browser workers:** run headless Chrome in containers. **Studio mode** (virtual clock) as the
    production default needs no GPU or display and gives deterministic frames. Live mode on GPU
    nodes is the fallback for sites that break under virtual time (WebGL, media, timers).
  - **Render workers:** autoscale on queue depth.
- **Isolation:** every job's browser runs in its own container or microVM (gVisor/Firecracker
  class). The worker loads arbitrary websites *and* renders LLM-written HTML scenes. Render workers
  get no network egress, which matches the scene contract's no-network rule.

### 5.3 Data, security and privacy

- **Session storage:** sealed sessions go to KMS-backed per-tenant keys (today:
  `~/.agentcast/secret.key`).
  - Sessions, DOM snapshots and footage of signed-in apps are customer-confidential: encrypted at
    rest, short retention by default, tenant-scoped access, never in logs or prompts (rule 5).
  - Secret masking at capture (`hygiene.ts`) applies to snapshots too.
- **LLM data:** send screenshots and snapshots only to the LLM provider under the commercial
  (no-training) terms, and say so in the product's data policy.

### 5.4 Sign-in on a server

The current flow opens a real Chrome window on the worker's desktop, which can't work for remote
users. Options:

| Option | UX | Security | Effort |
| --- | --- | --- | --- |
| **Streamed browser**: the user signs in inside a remote Chrome streamed to the job page (CDP screencast + input forwarding) | good; works for SSO, OTP and CAPTCHA (a human solves it) | credentials never touch our code; we save the resulting session | medium (the screencast exists; add input forwarding) |
| **Browser extension**: "connect your session" exports cookies/localStorage for the product's origin only | best for repeat use | the extension needs narrow host permissions and an audit | medium; store review |
| **Test account + TOTP secret** in a vault | best for CI / re-run on deploy | secret handling | low |

**Recommendation:** the streamed browser first (it reuses our stack), and test accounts for CI.

### 5.5 Authorisation and abuse

- **Domain verification before automating an origin:** DNS TXT, a meta tag, or a file at
  `/.well-known/agentcast.txt`. Public demos of well-known sites can be allowed read-only, with no
  sign-in or forms. This enforces AGENTS.md rule 8 and prevents the product being used to drive
  someone else's site or account.
- **Bot walls on verified domains:** document an allowlist IP or a bypass header the customer adds
  to their CDN/WAF. Residential proxies (or the TinyFish Browser fallback) only as a last resort,
  never to defeat a third party's protection.
- **Limits:** rate limits per tenant, a step budget per explorer, and a moderation pass on style
  prompts.

### 5.6 Cost of goods (rough, per 30 s launch video, one language, 16:9 + 9:16)

| Item | Estimate |
| --- | --- |
| LLM | $0.5–2 |
| Voice | $0 in music-led launch mode; about $0.1–0.3 per language with voice |
| Music | licence or generation, about $0–0.5 |
| Browser compute (about 3 min, 2 vCPU) | about $0.01 |
| Render compute (about 1–2 min, 8 vCPU or GPU) | about $0.02–0.10 |
| Storage and egress | about $0.01–0.05 |
| **Total** | **about $1–3** |

At $20–50 per video (or a subscription with N videos a month) margins are healthy. LLM spend is the
lever to watch, mainly the director agent, which is why §3.2 moves most of the edit to a template
compiler.

### 5.7 Quality as a measured thing: the eval corpus

Before and after every architectural change:

- **The corpus:** about 30 sites (public SaaS demos, our DemoBoard, a few signed-in test workspaces,
  a few bot-walled sites).
- **Measured each run:**
  - replay success rate per flow
  - URL → preview time
  - cost per job
  - film-lint scores (teardown §7)
  - a small human rating set
- **Cadence:** nightly; regressions block a deploy.

The TinyFish → local-explorer switch should be decided on this table, not on estimates.

### 5.8 Observability

OpenTelemetry spans per stage, LLM call and browser action. The job id goes on every log line.
A dashboard shows the failure taxonomy (the rehearsal reasons in §1 are exactly what to chart),
cost per job and p50/p90 time per stage.

### 5.9 Product surface

What turns a pipeline into a product:
- **In-browser editor:** a timeline editor over the EDL. The live HTML preview makes edits
  instant: swap a primitive, retime, retype text, change the music.
- **Kits and styles:** saved brand kits per workspace, plus a style library of archetypes, colour
  worlds and fonts.
- **Re-run on deploy:** the GitHub Action / CI hook already in the PRD. "Re-run on latest UI" is
  a strong retention feature.
- **Exports:** 16:9 / 9:16 / 1:1, captions burned in or as SRT, a GIF for READMEs, and a
  Product Hunt pack.
- **Accounts:** teams, roles, usage-based billing (Stripe metered).

## 6. The proposed pipeline

```
URL ─┬─▶ understand (Fetch/local, brand kit) ───────────────┐
     └─▶ crawl page map ─▶ plan flows (1 call) ─▶ explore ×N in local Chromium (parallel)
                                               └▶ verify-replay = Studio take + layers (sprites, DOM snapshots)
                                                         │ (gate 1: optional)
     music pick + analysis ◀───────────────────────────┤
     storyboard + on-screen copy (1 call) ◀─────────────┤
                                                         ▼
               template compiler → EDL v7 primitives → director call (+ agent only for custom/revise)
                                                         ▼
               live HTML preview in the job page (gate 3, revisions in seconds)
                                                         ▼
               final renders: shared layers once, per-language type and audio, parallel workers
```

## 7. Suggested order of work

| Phase | Scope | Why first |
| --- | --- | --- |
| **P0 (1 week)** | Local explorer (§2.3) behind a flag next to TinyFish; the `mcp` option in `packages/llm`; the eval corpus with replay-rate and timing measurement | Fixes the #1 bottleneck and gives the evidence to delete the TinyFish path |
| **P1 (1–2 weeks)** | Layer capture (§3.1); sound engine + mix (§3.4); music-led launch mode (§3.3); film lint (§3.5) | Biggest visible quality jump; each is independently shippable |
| **P2 (2 weeks)** | Motion primitives + template compiler, EDL v7 (§3.2); live HTML preview (§4); director reduced to one call plus revisions | Speed and consistency; most of the edit no longer depends on an agent's taste |
| **P3 (3–4 weeks)** | `anthropic-api` backend; Postgres + object storage + queue; containerised workers; streamed sign-in; domain verification; metering | Production readiness |

## 8. Decisions needed from you

1. **Drop TinyFish Agent for discovery and flow runs?** Recommended: yes, after the P0 eval confirms
   the replay rate. Keep TinyFish Browser (CDP) as the stealth fallback. Note this ends the
   hackathon's sponsor-track framing.
2. **Make launch videos music-led with no voice by default?** Recommended: yes; voice stays for
   guides and as an option.
3. **Allow DOM-snapshot reconstruction of the UI?** Recommended: yes, with the fidelity check and
   the rule that the snapshot is never edited to show data that isn't there.
4. **Production LLM backend:** the Anthropic API (Tool Runner for the explorer, Agent SDK for the
   director). This needs an org API key and updates to AGENTS.md / PRD §9.9.
5. **Ownership:** explore, recorder and video are teammates' packages (TEAM_TASKS.md). Agree on who
   takes P0/P1 before code moves.
