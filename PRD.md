# AgentCast — Product Requirements Document

> **Paste a URL, get a polished launch video of your real product.**
> TinyFish is the camera crew · Claude Code is the director · Remotion is the editing suite.

|                   |                                                          |
| ----------------- | -------------------------------------------------------- |
| **Status**        | Draft v1.0 (hackathon build)                             |
| **Event**         | AzinHacks 2026 · USAR, GGSIPU · TinyFish-sponsored track |
| **Owner**         | Kaustav Bhalla                                           |
| **Build status**  | Pending: nothing is implemented yet                      |
| **Companion doc** | [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)     |

---

## 0. TL;DR

AgentCast turns a product URL (plus optional test credentials and a prompt for the kind of video wanted) into a finished, narrated, captioned, music-backed demo video, in several formats and languages, **without a human driving the product or touching an editor**.

1. **Explore:** TinyFish **Agent API** web agents sign in, work through onboarding, and propose the 3–4 flows that best show the product's value. Several run in parallel, one per candidate flow. TinyFish **Fetch API** pulls page copy and brand assets.
2. **Review gate:** a human approves, reorders or edits the flows.
3. **Record:** each approved flow is replayed **deterministically** by our Playwright recorder in a **local Chromium** on the worker machine, one browser per form factor, in parallel. CDP screencast frames (60 fps target, checked in spike S1) and a millisecond-accurate action log (`timeline.json`) are captured. TinyFish **Browser API** sessions are the fallback recorder for sites that block a local browser or need a proxy country (§9.3.2).
4. **Script:** Claude writes narration per segment from the action log and page copy, natively in each target language. A second review gate follows.
5. **Voice:** ElevenLabs produces one clip per segment per language, with word-level timestamps.
6. **Direct:** Claude Code (headless, sandboxed) writes an **Edit Decision List** (EDL) against our Remotion primitives library. It can also write bespoke components such as intros, callouts and transitions, which are type-checked and test-rendered before use.
7. **Render and fan out:** Remotion renders a fast preview first, then every variant in parallel (16:9 / 9:16 × EN / HI × desktop / mobile), with smart zoom, a synthetic smooth cursor, captions, voiceover, ducked music and a branded intro/outro.
8. **Re-run on update:** cached flows and locators let you regenerate in minutes from the UI, CLI or a GitHub Action.

---

## 1. Problem

Every product needs a demo video for launches, landing pages, investor pitches, app stores, onboarding and hackathon submissions. Making one today means:

| Pain                      | Today                                                                                     | Consequence                                        |
| ------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Manual recording**      | Set up test accounts, script a flow, record, retake every misclick                        | Hours per video. Founders procrastinate.           |
| **Manual editing**        | Zooms, cursor smoothing, captions, VO, music by hand in Screen Studio / Premiere / CapCut | Needs editing skill. Quality varies wildly.        |
| **One video per variant** | 16:9 vs 9:16, desktop vs mobile, EN vs HI each need a re-record or re-edit                | Teams ship one variant, usually English 16:9 only. |
| **Instant decay**         | Every UI change outdates the video                                                        | Most teams ship stale demos or none at all.        |

**Why existing tools fail:**

- Screen recorders and editors still need a human driving the product.
- AI video generators (text-to-video, restyling) produce _footage, not proof_. They can't show the real product.
- No tool opens a live web app, logs in, finds the key flows and records them by itself.

**The gap:** turning a URL into a real, polished product video needs an agent that can actually _use_ the product on the live web, with logins, at scale, in parallel. TinyFish is built for exactly this.

---

## 2. Goals and non-goals

### 2.1 Goals (hackathon scope)

- **G1. URL → video, unattended.** From a URL alone (public product) or a URL plus sign-in (gated product), produce a ≥45 s narrated video with no manual recording or editing.
- **G2. Real footage only.** Every on-screen product pixel comes from a real browser session on the live product. Generated graphics are limited to overlays (titles, captions, callouts, cursor).
- **G3. Broadcast-quality edit.** Smart zoom on interactions, smooth cursor, word-synced captions, VO, ducked music, branded intro/outro. A viewer shouldn't be able to tell it was automated.
- **G4. Parallel variants from one run.** At least 16:9 + 9:16 and EN + HI from a single job.
- **G5. Human in the loop.** Review gates for flows and script, plus a revise-by-prompt loop on the preview.
- **G6. Re-run on update.** Regenerating a previously produced video, with the UI changed, takes ≤ 5 min and no human input.
- **G7. Deep, visible TinyFish usage.** Agent, Fetch, Vault and Browser Context Profiles are each load-bearing, the live agent view is shown in the UI, and the Browser API is the fallback recorder. TinyFish finds, signs into and rehearses every flow; the take itself is filmed locally (decision in §7.1, row 9).

### 2.2 Non-goals (for now)

- Native mobile apps (iOS/Android binaries). Web only; "mobile" means mobile-viewport web.
- Generating fake UI or AI B-roll of the product.
- Solving CAPTCHAs, OTP/2FA or email verification automatically. We detect these and hand off to a human sign-in.
- A multi-tenant SaaS with billing. The hackathon build is single-user, laptop-hosted.
- A full timeline editor UI. Edits happen through the review gates and prompts, not a drag-and-drop NLE.
- Translating the product's UI. The Hindi variant means Hindi narration and captions over the real UI. If the product itself supports `hi` locale, we switch it (P2).

---

## 3. Users and use cases

### 3.1 Personas

| Persona                             | Need                                                    | Primary entry point                |
| ----------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| **Indie founder / student builder** | Launch or submission video today, zero editing skill    | Web app: paste URL                 |
| **Product/growth team**             | Always-current demos on the site, many formats          | CI/CD (GitHub Action)              |
| **Support / docs team**             | "How to do X" clips per feature, refreshed on UI change | Web app "Tutorial mode", CI        |
| **Sales / founder pitching**        | Walkthrough tailored to a prospect's interests          | Web app with a focus prompt        |
| **Civic-tech / NGO**                | Hindi step-by-step guides to confusing public portals   | Web app, public flows, Hindi-first |

### 3.2 Use cases → feature mapping

| Use case                                              | Key features exercised                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Product launch videos (Product Hunt, X, landing page) | Explore, launch-style pacing, brand kit intro/outro, 16:9 + 9:16                        |
| Always-current demos                                  | Re-run on update, cached replay plans, CLI + GitHub Action, change detection            |
| Help-center tutorials                                 | Tutorial mode (one video per flow, step numbering, slower pacing, chapters), SRT export |
| Multilingual marketing                                | Language fan-out, native-language scripts, Devanagari captions                          |
| Sales and investor demos                              | Focus prompt ("emphasize analytics + SSO"), flow selection at gate 1                    |
| Hackathon submissions                                 | Fast path: public URL → 60–90 s video, defaults everywhere                              |
| Public-service walkthroughs                           | Hindi-first, tutorial mode, public (no-login) flows, slower narration                   |

---

## 4. Product principles

1. **Footage is proof.** Never synthesize product UI. Overlays may annotate, never fabricate.
2. **Explore with an agent, record with a script.** Agents are great at discovery and bad at clean takes. Discovery is non-deterministic; recording must be deterministic and replayable.
3. **Voice leads, picture follows.** Narration duration drives segment timing. Video is retimed (dead time compressed, holds extended) to fit each language's voice, so we record once and narrate many times.
4. **Data contracts over prompts.** Every stage emits a versioned, schema-validated JSON artifact. LLMs write _data and small components_, and deterministic code turns data into pixels.
5. **Every stage is resumable and cacheable.** Artifacts are content-addressed, so a re-run skips everything whose inputs didn't change.
6. **Secrets never reach an LLM.** Credentials go from Vault or the local encrypted store straight into the browser. Not into prompts, logs, captions or footage.

---

## 5. User experience

### 5.1 Primary flow (web app)

The agreed visual design for these screens (tokens, components, layouts) is in [`DESIGN.md`](./DESIGN.md).

```
[1] New video
    URL ............ https://your.app
    Sign-in ........ ( ) Public   (•) Sign in once   ( ) Use TinyFish Vault
    Video prompt ... "Upbeat, 60s, for Product Hunt, focus on the AI editor"   (optional)
    Variants ....... [x] 16:9  [x] 9:16   [x] English  [x] Hindi   [ ] Mobile web
    Mode ........... (•) Launch video  ( ) Tutorial (one per flow)  ( ) Sales demo
    Plan ........... "A 60 s energetic launch video for makers, ending on 'Try it free'"
                     (the creative brief read back; Change → asks again)
                                                         [ Generate → ]

[2] Exploring…   ┌──────── live TinyFish agent view (iframe) ────────┐
                 │  agent 1: "Sign in and finish onboarding"          │
                 │  agent 2: "Create a project from a template"   ... │
                 └────────────────────────────────────────────────────┘
    Stage rail:  ● Explore  ○ Review flows  ○ Record  ○ Script  ○ Voice  ○ Direct  ○ Render

[3] GATE 1 — Review flows
    ☑ 1. Create a project from a template   (6 steps, ~14s)   [edit steps] [▲▼]
    ☑ 2. Ask the AI editor to rewrite a section (5 steps)
    ☐ 3. Invite a teammate                   (needs real email: skipped by default)
    ☑ 4. Export to PDF
    [ + Describe another flow ]                                  [ Approve & record ]

[4] Recording…  desktop + mobile browsers on the worker, live thumbnails, per-step ticks ✓

[5] GATE 2 — Review storyboard (per beat: frame, both languages, motion note)
    beat 2 · core · reveal (EN, ≤6.0s) "Start from a template. One click and your workspace is ready."
                       (HI, ≤6.0s) "टेम्पलेट से शुरू करें — एक क्लिक में आपका वर्कस्पेस तैयार।"
                       motion: slow push-in on the template grid, callout "1 click"
    Re-prompt this beat: "make the hook sharper"   [ regenerate ] [ Approve script ]

[6] Preview (540p, 16:9 EN)   ▶  ───────────────
    Revise: "Make the intro shorter and zoom harder on the AI panel"  [ Send ]
                                                   [ Approve & render all variants ]

[7] Outputs: 16:9 EN · 16:9 HI · 9:16 EN · 9:16 HI   ⤓ MP4 · ⤓ SRT/VTT · ⤓ thumbnail · ⤓ GIF
             [ Re-run on latest UI ]  [ Copy CI snippet ]
```

**Gate defaults.** "Autopilot" (toggle) skips gates 1 and 2 with auto-approval. This is used by CI and by the hackathon fast path.

### 5.2 Sign-in UX ("sign in once")

For gated products, the user signs in **themselves**, so a human handles SSO, OTP and CAPTCHA. There are two ways, and both end with the same login in two places: a **TinyFish Browser Context Profile** for the explore agents, and an encrypted local `storageState` for the local recorder.

- **Local sign-in (default):** the worker opens a visible Chrome window on the user's machine. The user logs in, we save `storageState`, and upload its cookies to the TinyFish profile (`POST /v1/profiles/{id}/upload`, the same thing the TinyFish CLI's `profile import-cookies` does).
- **Remote sign-in:** the user logs in inside a TinyFish profile setup session, and we export `storageState` from that session before saving the profile.

See §8.2.

### 5.3 CLI / CI

```bash
npx agentcast run --url https://your.app --profile prof_abc --variants 16x9:en,9x16:hi --autopilot
npx agentcast rerun --job job_7f3a          # reuse approved flows + script, re-record, re-render
```

```yaml
# .github/workflows/demo-video.yml  (P1)
on: { release: { types: [published] } }
jobs:
  demo:
    runs-on: ubuntu-latest
    steps:
      - uses: agentcast/rerun-action@v0
        with: { job-config: agentcast.yml, tinyfish-key: ${{ secrets.TINYFISH_API_KEY }} }
```

---

## 6. Functional requirements

Priority: **P0** = required for the hackathon demo · **P1** = should have, builds the story · **P2** = stretch / roadmap.

### 6.1 Job intake

| ID   | Requirement                                                                                                                                                                                                                                                                                                                                                                    | Pri |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-1 | Accept URL, auth mode (public / sign-in-once / vault), optional video prompt (FR-5), mode, variant matrix                                                                                                                                                                                                                                                                      | P0  |
| FR-2 | Validate URL (http/https, public host; reject private IPs, localhost, metadata endpoints for SSRF safety)                                                                                                                                                                                                                                                                      | P0  |
| FR-3 | Optional focus prompt ("show analytics and SSO") that biases flow discovery                                                                                                                                                                                                                                                                                                    | P1  |
| FR-4 | Persist job config as `job.json`. Jobs are resumable after a crash or restart.                                                                                                                                                                                                                                                                                                 | P0  |
| FR-5 | **Optional video prompt** ("calm and premium, 60 s, for enterprise buyers"). It becomes a **creative brief** (`brief/creative.json`, §9.4): audience, goal, target length, tone, motion personality, CTA, must-show and avoid. Skipped, the brief is inferred from the product brief and the video mode. The plan summary reads it back in one sentence before the job starts. | P0  |

### 6.2 Product understanding (TinyFish Fetch)

| ID    | Requirement                                                                                                                                                                                                                                                           | Pri |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-10 | Fetch landing page + up to 9 discovered key pages (pricing, features, docs) as markdown in one Fetch API batch                                                                                                                                                        | P0  |
| FR-11 | Produce `product-brief.json`: name, one-liner, value props, audience, tone, key terms                                                                                                                                                                                 | P0  |
| FR-12 | Extract **brand kit**: logo (favicon / og:image / header img), primary and accent colors, font family hints. v2 (§9.7.3): theme, full palette, fonts matched on Google Fonts, corner radius, gradient, hero screenshot; the whole video's look follows it. | P1  |
| FR-13 | Search API for third-party context (what users praise) feeding the script                                                                                                                                                                                             | P2  |

### 6.3 Explore (TinyFish Agent)

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                        | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-20 | Short scout: find the real app entrance, verify public/demo/signed-in access, propose up to 3 independent flows with a value rationale                                                                                                                                                                                                                             | P0  |
| FR-21 | Every candidate flow comes back as a structured step list with **semantic targets** (visible text, ARIA role, label, placeholder, nearby text), values, expected outcome and a narration hint. A focused Agent run performs each proposed flow; every report is rehearsed in fresh local Chrome, with one bounded repair for a stalled run or failed replay (§9.2) | P0  |
| FR-22 | Stream the TinyFish live view (`streaming_url`) of each agent into the UI                                                                                                                                                                                                                                                                                          | P0  |
| FR-23 | Guardrails in every goal: stay on the product's domain, no destructive or irreversible actions (delete, pay, send to real users, change billing), no real personal data                                                                                                                                                                                            | P0  |
| FR-24 | Detect blockers (CAPTCHA, OTP, email verification, paywall) and surface a "sign in once" or skip prompt instead of failing silently                                                                                                                                                                                                                                | P1  |
| FR-25 | Score and rank flows with the rubric in §9.2.1 (hard gates, then value alignment, visible payoff, length, risk, distinctness). Pre-select the top 3–4 and order them into a story arc (setup → core → payoff → share). Autopilot depends on this ranking.                                                                                                          | P0  |
| FR-26 | User can add a flow in natural language at gate 1, which spawns one more flow run, as the gate action `add-flow` (the run's live view shows; the result is rehearsed and added, selected if it replays).                                                                                                                                                 | P1  |
| FR-27 | Seed demo data: the agent fills the account with realistic sample content before recording, so screens look lived-in                                                                                                                                                                                                                                               | P2  |

### 6.4 Gate 1: flow review

| ID    | Requirement                                                                                                                                                         | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-30 | List flows with per-step screenshots (from TinyFish step screenshots), estimated duration, toggle, reorder, rename                                                  | P0  |
| FR-31 | Edit a step's target text or typed value inline, as the gate action `edit-step`: the flow is rehearsed again from the edited step and the review updates. | P1  |
| FR-32 | Autopilot auto-approves the top-ranked flows                                                                                                                        | P0  |

### 6.5 Record (local Chromium + Playwright; TinyFish Browser as fallback)

| ID     | Requirement                                                                                                                                                                                                                                                                                                               | Pri                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| FR-40  | One **local Chromium** per form factor, launched by Playwright on the worker machine, in parallel. Each replays all approved flows in order.                                                                                                                                                                              | P0                     |
| FR-40a | **Fallback recorder:** when the local browser is blocked (bot wall, CAPTCHA, geo-block) or the job needs a proxy country, record that flow in a TinyFish Browser API session in **state-capture mode** (§9.3.2). The flow's footage is marked so the editor knows it is stills plus synthetic motion.                     | P1                     |
| FR-41  | Restore auth by injecting captured `storageState`, or replay the login steps with locally-held credentials (never sent to an LLM)                                                                                                                                                                                         | P0                     |
| FR-42  | Resolve each semantic target to a Playwright locator via a fallback chain (role+name → label → placeholder → text → LLM pick from ARIA snapshot). Cache resolved locators in `replay-plan.json`.                                                                                                                          | P0                     |
| FR-43  | Human-like action execution: eased mouse path to the element's bbox center, hover dwell, click, per-character typing with jitter, smooth scrolling                                                                                                                                                                        | P0                     |
| FR-44  | **Live mode (default):** capture CDP `Page.startScreencast` frames with timestamps from Google Chrome rendering on the GPU. Transcode to constant-frame-rate MP4 with the hardware encoder (NVENC, then Quick Sync, then x264). Target ≥ 30 fps during motion.                                                            | P0                     |
| FR-44a | **Stall check:** measure source-frame gaps during declared expected-motion windows, including their leading/trailing boundaries. A maximum gap over 250 ms or p95 gap over 60 ms retakes the complete flow (up to three takes). Paint-driven static holds are preserved; a take with no expected motion reports `not-applicable`. | P0 |
| FR-44b | **Studio mode (opt-in):** for heavy or mostly scrolling pages, or when "cinematic" quality is chosen. A real-time rehearsal saves every response to a HAR file; then N parallel browsers render frame-perfect 60 fps from it on a virtual clock (§9.3.3).                                                                 | P1                     |
| FR-45  | Emit `timeline.json`: for every action, `t`, kind, label, bbox, cursor path, URL, settle time, and **dead intervals** (locator resolution, slow loads) safe to cut                                                                                                                                                        | P0                     |
| FR-46  | "Takes": if a step fails, the take is discarded and retried (max 3), self-healing the failing locator. Only clean takes are kept.                                                                                                                                                                                         | P0                     |
| FR-46a | **Outcome verification:** after each step settles, check the step's expectations (URL, visible text/element, input value, or "something changed"). A step that ran without error but didn't produce its expected result fails the take. Expectations learned from the first clean take are reused on re-runs. See §9.3.1. | P0                     |
| FR-47  | Desktop (1440×900 @2x) and mobile (390×844 @3x, touch, mobile UA) form factors                                                                                                                                                                                                                                            | P0 desktop / P1 mobile |
| FR-48  | PII redaction: blur DOM elements matching email, API-key or token patterns and user-specified selectors via injected CSS before capture                                                                                                                                                                                   | P1                     |
| FR-49  | Fallback footage: if CDP recording fails entirely, use the Agent run's `video_url` recording for that flow, marked as "rough"                                                                                                                                                                                             | P2                     |

### 6.6 Script (Claude)

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                            | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-50 | Plan the whole video as a **storyboard** (§9.4) from the creative brief, `product-brief.json`, the approved flows (labels and rehearsal frames) and `timeline.json`: a story arc per mode, split into beats. Each beat has its footage span, narration with a **word/second budget** from its visual duration, on-screen text and a **motion intent**. | P0  |
| FR-51 | Write each language natively, not as a literal translation. Hindi uses natural Hindustani with common English tech terms kept in Latin script where they're the idiomatic choice ("dashboard", "template").                                                                                                                                            | P0  |
| FR-52 | Title card text, hook line (first 3 s), CTA line, video title + description for posting                                                                                                                                                                                                                                                                | P0  |
| FR-53 | Gate 2: per beat, its frame, both languages and its motion note; edit a line, or re-prompt one beat ("make the hook sharper")                                                                                                                                                                                                                          | P0  |
| FR-54 | Tutorial mode: imperative step-by-step voice ("Step 2: click **New project**")                                                                                                                                                                                                                                                                         | P1  |

### 6.7 Voice (ElevenLabs)

| ID    | Requirement                                                                                                        | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------ | --- |
| FR-60 | One TTS clip per segment per language using the `with-timestamps` endpoint. Store audio + character alignment.     | P0  |
| FR-61 | Voice presets per language and tone, selected from the creative brief                                              | P1  |
| FR-62 | Auto-tighten: if a clip exceeds its segment budget by >25%, ask Claude to shorten that line and re-synthesize once | P1  |

### 6.8 Direct (Claude Code, headless)

| ID    | Requirement                                                                                                                                                                                                                                                                         | Pri |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-70 | Claude Code runs in a per-job sandboxed workspace containing the Remotion project, primitives library, all artifacts and a `DIRECTOR.md` brief                                                                                                                                      | P0  |
| FR-71 | Output: `edl.json` (validated against the zod schema). It covers segment order, in/out points, speed ramps, camera keyframes (zoom targets), callouts, transitions, music mood, intro/outro design.                                                                                 | P0  |
| FR-72 | Optional bespoke components in `custom/` (intro, outro, callout styles). Each must pass `tsc --noEmit` and a `remotion still` test render, or the director falls back to the default primitive.                                                                                     | P1  |
| FR-73 | Revise loop: free-text feedback on the preview → Claude edits EDL/components → re-preview                                                                                                                                                                                           | P0  |
| FR-74 | Different video prompts produce visibly different edits (pacing, palette, transitions, typography, motion personality). Running twice with the same inputs shouldn't produce a bland template look.                                                                                 | P1  |
| FR-75 | **Motion design rules** (§9.7.1): the director plans the edit with the motion design skill (`.agents/skills/motion-design`, LottieFiles, MIT): one motion personality per video, four-act beats, three motion layers, emotion-matched easing and duration                           | P0  |
| FR-76 | **Motion tokens**: the EDL carries `style.motion` (personality, signature easing, duration palette, overshoot, entrance pattern), and every primitive (camera, cursor, captions, callouts, cards, transitions, ambient layer) takes its timing from it instead of hard-coded values | P0  |
| FR-77 | **Motion lint**: the worker checks the EDL against the skill's critical rules before preview and sends failures back to the director (§9.7.1). After 2 failed repair rounds the job falls back to the baseline edit.                                                                | P0  |
| FR-78 | The director reviews rendered stills of key moments (start of each beat, each click, the title and outro) and fixes what it sees before finishing                                                                                                                                   | P1  |

### 6.9 Render and fan-out (Remotion + FFmpeg)

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                    | Pri |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-80 | Preview render: 960×540 (or 540×960), 30 fps, fast encoding, target ≤ 60 s wall time for a 60 s video                                                                                                                                                                                                                                          | P0  |
| FR-81 | Final renders: 1920×1080 and 1080×1920 H.264 MP4, AAC, -14 LUFS loudness, all approved variants in parallel. Loudness normalisation applies to previews too.                                                                                                                                                                                   | P0  |
| FR-82 | **Virtual camera**: smart zoom and 9:16 reframing are the same primitive, a smoothed crop window following camera keyframes, clamped to frame                                                                                                                                                                                                  | P0  |
| FR-83 | Synthetic cursor rendered from `timeline.json` cursor paths (headless screencast has no cursor), with click ripple, eased motion and a hide-when-idle option                                                                                                                                                                                   | P0  |
| FR-84 | Word-level captions from TTS alignment, styled per EDL. Noto Sans Devanagari for Hindi.                                                                                                                                                                                                                                                        | P0  |
| FR-85 | Music from a local royalty-free library tagged by mood/BPM, ducked under VO (−18 dB, 200 ms attack/release), fade in/out. See §9.7.2: `assets/music/` with `agentcast music add`, picked by personality and grammar, ducked under the voice, cuts on the beat in trailers; plus generated sound effects. | P0  |
| FR-86 | Sidecar exports: SRT/VTT per language, poster thumbnail, 6 s GIF teaser, chapters (tutorial mode)                                                                                                                                                                                                                                              | P1  |
| FR-87 | **Editing grammar** (§9.7.2): launch and sales videos are cut as trailers (headline scenes between proof shots, outcome-led narration, montage, speed ramps, tilt, lifted callouts, music up front with cuts on the beat, sound effects, minimal captions); tutorials as guides.                                                    | P0  |

### 6.10 Re-run on update

| ID    | Requirement                                                                                                                                                                                                                        | Pri |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-90 | Re-run reuses approved flows, replay plan, script and EDL. It re-records only, self-heals broken locators, re-voices only segments whose script changed, and re-renders (§9.8.1).                                       | P0  |
| FR-91 | Change detection: perceptual-hash key frames vs the last run. Report "UI changed in flows 2, 4" and skip render if nothing changed (CI mode), with frame differences per step plus locator and outcome changes (§9.8.1). | P1  |
| FR-92 | If a flow can't self-heal, re-run that flow's TinyFish Agent exploration only, then continue                                                                                                                                       | P1  |
| FR-93 | CLI (`agentcast run/rerun`) and GitHub Action wrapper.                                                                                                                             | P1  |
| FR-94 | Webhook mode: TinyFish `webhook_url` for async agent runs (needed when the worker is behind a public URL)                                                                                                                          | P2  |

### 6.11 LLM backends and portability

| ID     | Requirement                                                                                                                                                                                                     | Pri |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-100 | Every LLM call goes through `packages/llm` (§9.9). No stage calls a model vendor's SDK or CLI directly.                                                                                                         | P0  |
| FR-101 | `claude-code` backend: drives the locally installed, logged-in Claude Code CLI. **No API key required.** Default backend.                                                                                       | P0  |
| FR-102 | `opencode` and `codex` backends with the same task contract                                                                                                                                                     | P1  |
| FR-103 | `anthropic-api` backend, used only when `ANTHROPIC_API_KEY` is set and selected                                                                                                                                 | P2  |
| FR-104 | `agentcast doctor`: reports Node, pnpm, ffmpeg, Chromium, TinyFish and ElevenLabs keys, and which LLM CLIs are installed. `--probe` runs one tiny structured-output call per backend to confirm it's logged in. | P0  |
| FR-105 | The repo ships `AGENTS.md` (canonical project instructions) and `CLAUDE.md` (imports it), so Claude Code, Codex, opencode and similar agents get the same instructions on any machine that clones the repo      | P0  |

---

## 7. System architecture

### 7.1 What changed from the original sketch, and why

| #   | Original idea                                                         | Revised                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | TinyAgent emits `flow.json` with **selectors**                        | Agent emits **semantic targets** (text/role/label). Our recorder resolves them to locators at record time and caches them.                                                                                                                                                                                             | TinyFish Agent run steps are natural-language action descriptions + screenshots, with no selectors in the documented step schema. Semantic targets also survive UI changes better than CSS selectors, which is what makes "re-run on update" work.                                                                                                                                                |
| 2   | TinyProfiles feed both explore and record                             | Profile feeds **explore**. A locally captured `storageState` (taken during the same sign-in session) feeds **record**.                                                                                                                                                                                                 | Browser Context Profiles attach to Agent API runs. Direct Browser API sessions are documented as isolated with no profile parameter. One human sign-in should serve both.                                                                                                                                                                                                                         |
| 3   | Record × N: one browser per (form factor × language)                  | One browser per **form factor**. Language is a narration concern.                                                                                                                                                                                                                                                      | The product UI doesn't change with narration language. Recording per language doubles cost and creates inconsistent takes. We retime footage per language instead (§9.6).                                                                                                                                                                                                                         |
| 4   | Claude writes a **fresh Remotion composition every run, no template** | Claude writes an **EDL** against a tested **primitives library**, plus optional bespoke components that are compiled and test-rendered with fallback                                                                                                                                                                   | Freeform TSX per run is the biggest reliability risk: compile errors, render crashes, multi-minute fix loops. The EDL keeps Claude creative (pacing, camera, typography, custom intros) and makes variant fan-out, revisions and re-runs cheap.                                                                                                                                                   |
| 5   | Single approval gate before render                                    | Three gates: flows → script → preview with revise loop. Autopilot skips all three.                                                                                                                                                                                                                                     | Cheapest to fix mistakes early. Recording a wrong flow wastes the most time.                                                                                                                                                                                                                                                                                                                      |
| 6   | Cursor smoothing implied                                              | **Synthetic cursor** composited in Remotion from logged mouse paths                                                                                                                                                                                                                                                    | Headless CDP screencast doesn't render the OS cursor at all.                                                                                                                                                                                                                                                                                                                                      |
| 7   | Orchestrator is a job pipeline                                        | **Resumable stage graph** with content-addressed artifacts                                                                                                                                                                                                                                                             | Enables crash recovery, re-run on update and CI with minimal recompute.                                                                                                                                                                                                                                                                                                                           |
| 8   | —                                                                     | **Fetch-based brand kit + product brief**                                                                                                                                                                                                                                                                              | Free under TinyFish Fetch's daily allowance, and makes the intro/outro look on-brand automatically.                                                                                                                                                                                                                                                                                               |
| 9   | Record in TinyFish Browser API cloud browsers                         | Record in a **local Chromium** on the worker. TinyFish Browser API sessions become the **fallback recorder**, captured state by state.                                                                                                                                                                                 | TinyFish browsers run in AWS San Jose, about 305 ms round trip from Delhi. The screencast waits for an acknowledgement per frame, so we expect only 4–6 fps and much slower typing; local Chromium should reach 60 fps. There's no region setting, the proxy country doesn't move the browser, and TinyFish has no local or self-hosted mode. Spike S1 confirms the numbers. |
| 10  | One discovery run performs every flow                                 | **Short entrance scout, then up to three focused flow runs**, two at a time, each rehearsed in fresh local Chrome. Save run IDs and results incrementally.                                                                                                                                                             | Broad exploration loops, mismatched browser access and lost completion responses cost more than the extra agent startup. Focused tasks bound wasted work; durable polling avoids duplicate paid starts.                                                                                                                                     |
| 11  | A style prompt shapes the director's edit                             | An optional **video prompt** becomes a **creative brief**, then a **storyboard** (beats with narration and motion intent). The director plans motion with the **motion design skill** as its rulebook, writes **motion tokens** every primitive obeys, and is held to the skill's critical rules by a **motion lint**. | A free-text style prompt gives the director taste but no discipline, so edit quality varies. The skill turns taste into checkable rules (one personality, directional easing, the 1/3 rules, three layers), and the brief lets the user's intent reach every stage, not just the edit.                                                                                                         |

### 7.2 Component diagram

```mermaid
flowchart LR
  subgraph UI["Web app — Next.js + Tailwind"]
    A[New job form] --> B[Live progress + TinyFish live view]
    B --> G1[Gate 1: flows]
    G1 --> G2[Gate 2: script]
    G2 --> G3[Preview + revise]
    G3 --> O[Outputs]
  end

  subgraph W["Worker — Node.js / TypeScript (local)"]
    ORC[Orchestrator<br/>stage graph · SQLite · WS events]
    REC[Recorder<br/>Playwright over CDP]
    DIR[Director + script writer]
    LLM[LLM runner<br/>claude -p · opencode run · codex exec]
    RND[Renderer<br/>Remotion + FFmpeg]
    VOX[Voice client]
    CHR[Local Chromium × form factors<br/>screencast · 60 fps]
  end

  subgraph TF["TinyFish cloud — one API key"]
    FETCH[Fetch API<br/>copy + brand]
    AGENT[Agent API<br/>discover + per-flow runs<br/>run-sse · streaming_url]
    PROF[Browser Context Profiles]
    VAULT[Vault<br/>1Password / Bitwarden]
    BROW[Browser API<br/>fallback recorder · state capture]
  end

  subgraph EXT["External"]
    CL[Your coding-agent login<br/>Claude Code by default · no API key]
    EL[ElevenLabs TTS]
  end

  UI <-- REST + WebSocket --> ORC
  ORC --> FETCH
  ORC --> AGENT
  AGENT --- PROF
  AGENT --- VAULT
  ORC --> REC --> CHR
  REC -. fallback .-> BROW
  ORC --> DIR --> LLM --> CL
  REC -. locator healing .-> LLM
  ORC --> VOX --> EL
  ORC --> RND
```

### 7.3 Pipeline (stage graph)

```mermaid
flowchart TD
  I[intake] --> U[understand<br/>Fetch: brief + brand]
  U --> CB[creative brief<br/>video prompt or inferred]
  I --> AUTH{auth mode}
  AUTH -->|sign-in once| SI[setup session → profile + storageState]
  AUTH -->|vault/public| D
  SI --> D[discover<br/>Agent run]
  CB --> D
  D --> FR[flow runs ×K<br/>Agent, parallel]
  FR --> G1{{Gate 1: flows}}
  G1 --> R[record ×form factors<br/>local Chromium, parallel]
  G1 -.draft in parallel.-> S
  R --> S[storyboard + script ×languages<br/>Claude]
  S --> G2{{Gate 2: script}}
  G2 --> V[voice ×segments×languages<br/>ElevenLabs, parallel]
  V --> DR[direct<br/>Claude Code → edl.json + custom/]
  DR --> P[preview render]
  P --> G3{{Gate 3: preview}}
  G3 -->|revise prompt| DR
  G3 -->|approve| F[fan-out renders<br/>aspect × language × form factor]
  F --> OUT[outputs + sidecars]
```

Each node is a **stage** with declared inputs and outputs. Its cache key is `sha256(stage version + input artifact hashes + relevant config)`. A stage is skipped when its key matches a completed run, which is how re-run on update stays cheap.

### 7.4 Runtime topology (hackathon)

- **`apps/web`**: Next.js (App Router) + Tailwind. Talks to the worker through its own route handlers (REST, plus server-sent events for live progress), so the worker URL stays server-side.
- **`apps/worker`**: a long-lived Node process (Fastify), fully asynchronous. `POST /jobs` answers 202 at once and the job runs in the background. It owns:
  - the orchestrator
  - an async, file-backed job store (`~/.agentcast/jobs/<jobId>/state.json`, written atomically, plus `events.ndjson`), chosen over SQLite because Node's built-in SQLite is synchronous and `better-sqlite3` needs a native build
  - Playwright, Remotion bundling and rendering, and Claude invocations

  Rendering never runs inside Next.js route handlers. Live progress uses server-sent events rather than WebSocket: the stream is one-way, and browsers reconnect to it on their own.

- Concurrency limits (configurable): Agent runs 4, local recorder browsers 2 (desktop + mobile), TinyFish fallback sessions 2, TTS 6, renders 2 (CPU-bound). Recording and rendering don't overlap within a job, so the CPU isn't shared between capture and encoding.

---

## 8. TinyFish integration (sponsor surface)

| Product name in deck | TinyFish API                                                 | Used for                                                                                                | Key params                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TinyFetch**        | Fetch API `POST api.fetch.tinyfish.ai`                       | Product copy, brand kit, link discovery                                                                 | `urls[≤10]`, `format: "markdown"`, `links: true`, `image_links: true`                                                                                                  |
| **TinyAgent**        | Agent API `/v1/automation/run-sse`, `/run-async` (+ batch)   | Discovery + per-flow exploration in parallel                                                            | `url`, `goal`, `output_schema`, `browser_profile: lite\|stealth`, `use_profile`, `profile_id`, `use_vault`, `credential_item_ids`, `agent_config.max_duration_seconds` |
| _(live view)_        | `STREAMING_URL` SSE event                                    | Live agent iframes in the UI                                                                            | —                                                                                                                                                                      |
| _(step evidence)_    | `GET /v1/runs/{id}?screenshots=url`                          | Gate-1 step thumbnails, fallback `video_url`                                                            | —                                                                                                                                                                      |
| **TinyProfiles**     | Browser Context Profiles `/v1/profiles`, setup session, save | Sign in once, reused by all explore runs                                                                | `POST /v1/profiles/{id}/setup-session` → `cdp_url`                                                                                                                     |
| **TinyVault**        | Vault (1Password / Bitwarden)                                | Agent logs in without the LLM seeing passwords                                                          | `use_vault: true`, `credential_item_ids`                                                                                                                               |
| **TinyBrowser**      | Browser API `POST api.browser.tinyfish.ai`                   | **Fallback recorder** (state capture) for sites that block a local browser or need a proxy exit country | `url`, `timeout_seconds`, `proxy_config` (`country_code` accepts any ISO code, including `IN`) → returns `session_id`, `cdp_url`, `base_url`                           |
| _(optional)_         | Search API                                                   | Third-party product context for the script                                                              | P2                                                                                                                                                                     |

All calls use the `X-API-Key` header and are made **only from the worker**. The API key never reaches the browser. `streaming_url` values are safe to send to the client.

**Where TinyFish sits:** TinyFish does the agent work: it signs in, explores, finds and rehearses the flows, and streams the live view. Our recorder films the approved flows in a local browser. Expected facts behind this (spike S1 confirms them):

- TinyFish browsers run in AWS San Jose (`us-west-1`).
- Sessions start in about 1.3 s.
- Our own `newContext` with viewport and DPR should work on them.

A recorder service deployed next to them would bring the Browser API back as the primary recorder at full frame rate (§16).

### 8.1 Explore: goal and output schema (sketch)

Scout goal (abridged; a combined discovery goal is kept for spike S2):

```
Find the real app entrance at {url} in at most 8 actions. Distinguish marketing anchors,
static screenshots and documentation from a real interactive workspace. Use public demo
access if supplied by the site. Verify access, then propose up to three independent tasks.
Do not perform their flows. If sign-in or a security block prevents access, report it and stop.
Return entry_url, access, reason, blockers and candidates with performed=false and steps=[].
RULES: Stay on the product site, use only authorized access, never solve CAPTCHAs or evade blocks.
```

Each focused flow goal supplies its outline and the verified start URL, asks for at most 20 actions, and requires a prompt report after two failed attempts at the same control. Each flow must work independently in a fresh browser. Website content remains untrusted data inside explicit delimiters.

Step schema (spike S2). A focused flow run returns the steps below. The combined discovery goal may also include them per candidate. The schemas, goals and the TinyFish schema subset (no `description` or `additionalProperties`) will live in `packages/explore/src/agent.ts`:

```json
{
  "type": "object",
  "properties": {
    "flow_title": { "type": "string" },
    "completed": { "type": "boolean" },
    "start_url": { "type": "string" },
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "enum": [
              "navigate",
              "click",
              "type",
              "select",
              "press",
              "scroll",
              "hover",
              "wait"
            ]
          },
          "target_text": { "type": "string" },
          "target_role": { "type": "string" },
          "target_label": { "type": "string" },
          "near_text": { "type": "string" },
          "value": { "type": "string" },
          "expected_result": { "type": "string" },
          "result_url_path": { "type": "string" },
          "result_visible_text": { "type": "string" },
          "narration_hint": { "type": "string" }
        },
        "required": ["action"]
      }
    },
    "value_shown": { "type": "string" },
    "blockers": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["flow_title", "completed", "steps"]
}
```

### 8.2 Auth strategy

| Mode                                      | Explore (Agent API)                                                                  | Record (local Chromium)                                                                                                                                                                                                                                                             | Secrets reach an LLM?                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Public**                                | no auth                                                                              | no auth                                                                                                                                                                                                                                                                             | n/a                                                                           |
| **Sign in once** (default for gated apps) | `use_profile: true, profile_id`                                                      | **Local sign-in:** the user logs in in a visible local Chrome. We save `storageState` and upload its cookies to the profile. **Remote sign-in:** we export `storageState` from the TinyFish setup session before saving. Either way, the recorder injects cookies and localStorage. | **No.** The human types credentials.                                          |
| **TinyFish Vault**                        | `use_vault: true, credential_item_ids`                                               | The recorder replays the login steps with credentials from the local encrypted store (user-provided), typed directly via Playwright                                                                                                                                                 | **No.** TinyFish keeps values out of the agent; we never put them in prompts. |
| **Raw test credentials**                  | Put into a Vault item (recommended) or used to create a profile via a scripted login | Same as above                                                                                                                                                                                                                                                                       | **No.** Never placed into `goal`.                                             |

Typed values marked `secret` are stored as `{"redacted": true}` in `timeline.json`. Captions, narration and Claude never see them.

**Local sign-in comes first.** The auth stage opens a visible Chrome window; closing it saves the session (`auth/session.enc`, AES-256-GCM, key in `~/.agentcast/secret.key` or `AGENTCAST_SECRET`). Sign-in-once uploads it to a TinyFish profile (`POST /v1/profiles`, `/upload`) used by discovery and flow runs; the local rehearsals and every take start from it. Vault mode keeps the vault for the agents and uses the local session for the recorder. Re-runs carry the sealed session over. Remote sign-in follows later.

**Sign-in window:** don't use a Playwright-launched Chrome from the recorder's launcher. Google refuses sign-in when `navigator.webdriver` is set ("This browser or app may not be secure"), and Chrome sets it for `--enable-automation` and for any `--remote-debugging-port`/pipe, even with nothing attached. The recorder's GPU probe tab and forced ANGLE/NVIDIA flags can also make the window flicker under Wayland. So the auth stage starts ordinary Google Chrome with no DevTools and no GPU flags (the page sees `webdriver=false`). It uses the site's own profile in `~/.agentcast/profiles/<site>` (0700, kept between jobs, so the next sign-in usually starts signed in), set to "continue where you left off" so Chrome keeps session cookies when it quits. The person signs in, then presses "I'm signed in" on the job page (`POST /jobs/:id/stages/auth/signals/signed-in`, a stage signal; `ctx.when()` in the stage) or closes the window. Chrome is asked to quit (SIGTERM, a clean shutdown), and the profile's cookies and the site's local storage are read in a headless Chrome, then sealed and uploaded as before. The profile holds the site's cookies under Chrome's basic (not keyring) encryption; delete its folder to forget the session.

**Moving a session between machines:** a login travels between a US TinyFish browser and the user's machine. Some sites bind sessions to an IP address or device fingerprint and will reject the moved cookies.

- Local sign-in starts the session on the recorder's own machine, so it's the default.
- If the agents' copy is then rejected, use Vault mode for exploring.
- If the recorder's copy is rejected, replay the login with stored credentials.

---

## 9. Pipeline deep dive

### 9.1 Understand (Fetch)

1. Fetch the root URL with `links: true, image_links: true`.
2. Pick up to 9 same-origin links scored by path keywords, and fetch them in one batch. What the product looks like scores highest (`/features`, `/product`, and showcase pages: `/examples`, `/blocks`, `/templates`, `/themes`, `/charts`, `/gallery`, `/components`), then `/pricing` and use cases; docs count for little and setup pages (installation, getting started, changelog, CLI, API reference) are skipped. A brief written from setup pages describes commands, not the product.
3. The LLM runner (fast tier, §9.9) produces `product-brief.json`. A deterministic extractor produces `brand.json`: logo candidates from `image_links`, colors from a quick headless screenshot palette (k-means on the hero) or `theme-color` meta.

### 9.2 Discover and flow runs (Agent), rehearse-first

**Browser mode:** scout, focused flow, repair and gate-added flow requests explicitly use TinyFish's managed `browser_profile: "stealth"` from the first attempt. This runtime mode is independent of saved sign-in profiles and vault credentials, which continue to be passed alongside it. It improves compatibility with protected sites but does not guarantee Cloudflare access; explicit blocks still stop exploration without proxy rotation or CAPTCHA solving, and local rehearsal/recording must independently pass access checks. Existing task checkpoints remain immutable; a changed request requires a new job rather than restarting a paid run.

**Why scout first:** one broad exploration run tends to fail in a few ways: a blocked remote browser with no local navigation, a completion lost after a transport timeout, or repeated app-entry navigation until the time cap. So the worker separates finding access from demonstrating a task:

1. **Scout the entrance.** One `/run-async` task asks only for the actual app/demo entrance, its access classification and up to three independent candidate outlines. Its requested duration is 60 s, worker step budget 18, and worker elapsed cap 180 s, including queueing. A local Chrome check verifies the same entrance before any focused run starts. A demo flow starts at the stable demo/login URL and includes entering the demo; session-specific dashboard redirects are not substituted as its start URL. Entrances and redirects must remain on the authorized product host.
2. **Perform one flow per run.** Run up to three focused tasks, at most two concurrently per job. Each requests 120 s with a 32-step worker budget and a 300 s worker elapsed cap. Each report is normalized and rehearsed in a fresh local browser with the recorder's compiler (§9.3). Only real replay success makes a flow eligible.
3. **Recover once.** Five identical normalized actions among the last eight new steps without distinct observed frames, repeated unchanged frames with repeated actions, an exceeded step budget, or 90 s without a new observed step stops a running task. Polling the same step or publishing a progress heartbeat is not progress. A stalled focused run or failed local replay gets at most one separate repair task, told the failure and sent to the same verified entrance. Explicit sign-in and automation blocks stop further attempts; they do not trigger changes to browser mode, proxies or CAPTCHA workarounds.
4. **Save each useful result.** Write `flows.json`, `flow-review.json` and learned replay locators after each completed attempt. Stage retries preserve eligible rehearsals and resume unfinished remote tasks. One failed flow can be excluded while successfully rehearsed flows continue to review and selection.

**Account compatibility:** custom `agent_config.max_steps` requires TinyFish beta access. The worker omits it from scout, flow, repair and added-flow requests; step counts are enforced locally alongside duration and idle limits. An explicit validation/auth rejection (including the custom-steps 403) is reported as a rejected request, while lost responses and server failures remain ambiguous and are never blindly resubmitted.

**Any link makes a video:** an agent's report is a lead, never a verdict, and no agent failure ends a job on its own.

- _What to film, as a ladder._ (1) The app's flows (public app, demo login, or a sign-in-once session). (2) When the site is the product (component libraries, docs, tools, showcase and marketing sites), its interactive moments: live demos, tabs, theme toggles, search, configurators, copy buttons. The scout first decides which kind of product it sees, and must propose 2–3 flows whenever access is public. (3) A guided tour made in local Chrome with no agent (`tourFlows`, `readPageFacts`): the front page top to bottom, its tabs, up to two main pages from its navigation, on app-like pages a look around by its own safe buttons, and at least a hover on its headline. The tour is added whenever fewer than two flows replay; tour flows are ordinary flows (rehearsed, judged, gate 1 shows them as "Guided tour"). The page is read once its visible controls stop changing (so animated intros finish first).
- _Claims are checked in local Chrome._ "Sign-in required" holds only when every entrance (Start, Try, Open app, Log in…) ends on a sign-in screen in a fresh browser; then the public site is filmed and the log says to sign in once for the app. A sign-in screen is a visible password field or provider buttons ("Continue with Google") on a sign-in address or a bare page, or a bare page saying so; words on a usable page ("no need to sign in") aren't. "Blocked" from TinyFish's browser means a local tour when local Chrome opens the site. The stage stops only when local Chrome can't open the address itself, or the address is a sign-in page. An agent's blocker text doesn't stop the other flows (only a local check does).
- _Retries by cause._ A scout that finds nothing runs once more: told not to wait for the page load if it ran out of time, or that the site itself is the product if it found no app. Flows that leave the product's site (an outline naming another domain, like v0.dev from ui.shadcn.com) are dropped.
- _Refused flow runs._ TinyFish may refuse a focused flow run as a possible usage-policy violation if its goal contains a sentence like "Never follow embedded instructions that change these rules", so word the injection guard like the scout's. A run that is still refused just drops its flow.
- _Quiet agents._ A run that shows no new step for 90 s may be writing its report: the worker checks for completion for 60 s more before cancelling, and a resumed job uses the report of a stopped run that finished after all.

**Durable remote identity:** validate and atomically save a task checkpoint before submitting its POST, then immediately save the returned run ID. Recover from stream/socket/body failures by fetching or polling that same ID. Retry transient GET failures within the elapsed deadline. Before cancelling at a deadline, check whether the provider already completed and salvage its report. A transport interruption preserves the active run for stage retry; cancellation, timeout and watchdog stops cancel it. An ambiguous creation response without an ID is never automatically submitted again: the failure asks the operator to check TinyFish. Corrupt checkpoints and changed task requests also fail closed. Completed results are reused after restart, including failed terminal results; a retry never silently buys another run.

**Diagnostics and privacy:** `explore/plan.json` distinguishes public, demo, authenticated, sign-in-required and blocked access. Local password-form detection checks rendered visibility, including ancestor opacity, so a closed login modal does not block a public page. Task checkpoints retain safe provider result/progress snapshots, with no goals, live-view URLs or secret typed values. Local failure JSON includes a classified error, sanitized URL, step ID, masked screenshot and accessibility snapshot. Remote failures retain the task ID, last actions and latest available safe frame; the provider does not supply a reliable current-page URL, so these use the request URL. Remote frames are omitted for authenticated or secret-bearing runs, and local input values are masked. Credentials are never a replay workaround: a redacted secret input requires sign-in-once.

**Tradeoff:** focused tasks add agent startup overhead versus one combined run. They bound a failed task's cost, expose the access problem early and preserve other completed flows. The per-task limits are caps, not a promise that every product will produce three flows or bypass an access barrier. No live paid rerun is needed to exercise recovery tests.

#### 9.2.1 Flow scoring and selection

"Best flow" is a judgment call, so selection combines hard gates, an LLM judge with screenshots as evidence, and cheap deterministic signals. The human review at gate 1 is the final safety net.

**Hard gates.** A flow that fails any of these is dropped before scoring:

- The agent reported the flow performed (`completed: true`) with no `blockers` (CAPTCHA, OTP, paywall, email verification).
- It has at least 2 steps, and every step that acts on an element names it (`target_text`, `target_role`, `target_label` or `target_placeholder`). Only the first step may `navigate`; later URL jumps can't be filmed as a user journey.
- It starts on the product's domain (or a known auth provider during sign-in).
- **It rehearses cleanly in a fresh local browser** (§9.2 step 2).

**Scored signals:**

| Signal                  | Source                     | How it's measured                                                                                                                                                                                  | Weight  |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Value alignment** (V) | LLM judge (fast tier)      | 0–5: how directly the flow proves one of the value props in `product-brief.json`. The judge must cite which value prop.                                                                            | 0.35    |
| **Visible payoff** (P)  | LLM judge with screenshots | 0–5: compares the first and last step screenshots. A large, legible change (empty page → generated plan, blank chart → populated chart) scores high. A settings toggle scores low.                 | 0.30    |
| **Length fit** (L)      | Deterministic              | 1.0 for 3–12 steps and an estimated 8–20 s of footage, falling off linearly to 0 at 20 steps / 40 s                                                                                                | 0.15    |
| **Distinctness** (D)    | Deterministic              | 1.0 minus the max similarity to any higher-ranked flow (title-embedding cosine, shared start URL, perceptual hash of final screenshot)                                                             | 0.10    |
| **Focus match** (F)     | LLM judge                  | 0–5: match against the user's focus prompt (FR-3). Weight 0 if no focus prompt; its 0.10 then goes to V.                                                                                           | 0.10    |
| **Risk** (R)            | Deterministic              | −0.15 per step whose label matches destructive keywords (`delete`, `remove`, `pay`, `purchase`, `send`, `invite`, `publish`), capped at −0.45. Such flows always need explicit approval at gate 1. | penalty |

```
score = 0.35·V/5 + 0.30·P/5 + 0.15·L + 0.10·D + 0.10·F/5 + R
```

The judge runs **once for all surviving flows** (one fast-tier call with each flow's first and last rehearsal frames), so scores are relative to each other and a subscription pays one CLI start-up instead of one per flow. It returns, per flow, a one-line rationale (shown on the gate-1 card) and a **story role**: `setup`, `core`, `payoff` or `share`. If the coding agent isn't available, flows get neutral judge scores and are ranked on the deterministic signals.

Agent-reported outcomes become checks conservatively: a reported URL change becomes a URL check (ids generalized), but reported result text is kept as a description only, because agents paraphrase it and a wrong check would fail a good take. The rehearsal learns the real checks (§9.3.1).

**Selection and ordering:**

1. Greedily take the highest-scoring flows, recomputing distinctness after each pick, until 3–4 are chosen or the total footage exceeds the creative brief's target length (default 60 s). Footage length is the rehearsed take's length when there is one. A flow at least 0.8 similar to one already picked is never picked: a demo shouldn't show the same thing twice, whatever the score.
2. Order by story role: setup → core → payoff → share. Within a role, keep score order. At most one `setup` flow, and only if it's short; sign-in and onboarding are rarely worth showing.
3. Write the scores, rationale and story role into `flows.json` so gate 1 can show why each flow was picked, and so the user can override.

Weights live in config and are tuned against the benchmark set (implementation plan, Phase 8).

### 9.3 Record (local Chromium + Playwright)

Per form factor:

1. Launch full bundled Chromium on the worker in modern headless mode through `playwright-extra`, with `puppeteer-extra-plugin-stealth` enabled by default (`stealth: false` opts out). Retain Playwright's page/context/CDP APIs and isolate plugin instances per launcher. Select a verified renderer using dGPU → iGPU → CPU fallback (§9.3.3).
2. Create a context with the form factor's viewport, DPR, UA, touch. Inject `storageState`.
3. Inject recording CSS: hide scrollbars, disable caret blink, blur redaction selectors, `prefers-reduced-motion: no-preference`.
4. `Page.startScreencast({format:'jpeg', quality:85, maxWidth, maxHeight})`. Register the listener first. Record receipt time immediately; ACK independently of a bounded serialized disk-write queue. Store each frame with its CDP timestamp converted from seconds to milliseconds. Fail capture on invalid timestamps, write errors, page closure or queue overflow. Wait for an initial frame before starting scene time.
5. For each flow, then each step:
   - Mark `t_resolve_start`.
   - Resolve the locator (cache first, then the fallback chain).
   - Mark a dead interval `[t_resolve_start, t_resolved]`.
   - Get `boundingBox()`.
   - Animate the mouse along an eased path (~350–600 ms, distance-scaled).
   - Hover dwell 150 ms, then act.
   - Wait for settle (network idle ≤ 2 s or DOM-stable 300 ms). Mark slow-load portions as dead.
   - **Verify the outcome** against the step's expectations (§9.3.1). A failed check fails the take.
   - Log the event.
6. Stop the screencast and drain acknowledgements/writes. Evaluate original frame gaps within declared expected-motion windows, including leading/trailing silence; a failed stall check retakes the flow, at most three times. Static holds are preserved. Frames + timestamps go through ffmpeg (generated concat manifest with explicit per-image durations, 1 ms timebase and terminal hold) into CFR 30 fps H.264 `recording.mp4`, using a real NVENC → Quick Sync → x264 probe/fallback and full-range JPEG to limited-range `yuv420p` conversion. Use GOP 15 and fast-start metadata. Validate every decoded presentation timestamp, frame count, dimensions, duration and keyframe spacing with ffprobe before publishing atomically. The encoding may hold up to one extra output frame to round duration to the 30 fps grid. The flow timeline writer then writes `timeline.json` (a separate stage from capture).
7. Close the browser (always, in `finally`).

Capture stills with Playwright's `page.screenshot()`, not raw CDP `Page.captureScreenshot`. The raw call ignores the emulated DPR and returns CSS-pixel size.

**Clock sync:** action times use the local monotonic clock in milliseconds. Capture prefers `metadata.monotonicTimestamp` when available, falling back to `metadata.timestamp` on older Chrome; it keeps that choice for the entire take. Offset = median(`receipt_local_ms − source_timestamp_seconds × 1000`) over all frames. Scene time starts after the initial frame, with the latest pre-roll image held at time zero. `controls.now()` and expected-motion windows use scene milliseconds; the flow timeline writer converts these to video seconds. CFR holds never contribute samples to the stall check. The browser's physical device scale factor matches its context DPR so capture preserves viewport × DPR pixels and CSS input coordinates; expected dimensions are validated before publication. `recordLive()` reruns a replayable callback in a fresh browser after quality failure; its `prepare` callback must reset application data as needed for each take. Cancel, timeout and action failures clean up without publishing partial footage. The current capture API tracks one page; new tabs fail explicitly until target reattachment is implemented.

**Finding elements on loosely described pages:** the first step waits for the start page to settle (animated sites show nothing at `load`); a target that isn't there yet is looked for again for up to 4 s; several visible matches without a `near` hint go to the only one on screen (for a scroll step, the first one below the screen); and the chain ends with fuzzy text (names compared without case, spacing, punctuation or symbols, so "Backed by Vercel" finds "Backed by▲ Vercel"). A dedicated flow run is replayed from the URL it was sent to, not the `start_url` it reports. When every visible match is a copy of the same link (a sidebar entry and the same link in the page), the one in the main content is clicked. Pages open on their HTML (DOMContentLoaded, 45 s, one retry on a timeout) plus up to 8 s for the full load, then the settle check, so a slow CDN moment doesn't fail a take. A flow with no actions (only waits or page loads) isn't filmed, and gate 1 warns when a selected flow didn't replay. On sites with nothing to create (component libraries, docs, showcase and marketing sites), proposed tasks should use actual interactive moments. The scout proposes tasks and focused runs perform them; an inaccessible app is reported explicitly.

**Agents' reports leave out clicks.** The rehearsal repairs what it can and records the repair:

- A reported `navigate` that names a short button or link ("Open workspace") is replayed as a click.
- A start page with a generated id (`/projects/eb09b8b3-…`) only existed in the agent's browser: the flow's repair run is told so.
- If the first element isn't on the start page, the rehearsal tries the other likely starts (where the agent was sent, the start it reported, the candidate's, the front page), then looks one step away (`findBridge`): same-origin links (entrances first), then entrance buttons ("Try the demo workspace", "Continue as guest"), and adds that click as the flow's first step.
- If a later element doesn't appear, it clicks the visible "move on" buttons (Create, Continue, Next, Save…; never Cancel, Delete, Pay) until one makes it appear (`findGapClick`), inserts that click and rehearses again from a fresh page (up to 3 times).
- A typing step whose target can't take text ("type into Create project") types into the nearest empty field.
- When an element took a while to appear (a redirect after the last click), the take waits as long. Element lookups never wait more than a second on a box (otherwise a `near` hint that isn't on the page can cost 30 s).

**Take model:** a failed step aborts the take (we don't keep partial footage), heals the locator (LLM pick from `ariaSnapshot()`), and restarts that flow from its `start_url`. Flows are separate sub-clips, so one bad flow doesn't invalidate the others.

#### 9.3.1 Outcome verification

Finding exactly one matching element and clicking it without an error doesn't prove the click did the right thing. The click might land on the right button while a modal intercepts it, or a form might silently reject input. Each step therefore carries **expectations** that are checked after the page settles.

**Where expectations come from**, in priority order:

1. **Learned from the last clean take.** After the first successful take, we record what each step actually changed: the URL path after it, new visible headings/dialogs/toasts (diffed from the ARIA snapshot before and after), and input values. These become the step's expectations for every later take and re-run. This is the strongest source.
2. **Reported by the agent.** `result_url_path` and `result_visible_text` from the per-flow run (§8.1) become `url` and `text` checks.
3. **Implied by the action.** A `type` step implies the input's value equals the typed text. A `select` step implies the selected option.
4. **Fallback.** If nothing else is known, `changed`: the URL changed or the DOM had a meaningful mutation (added or removed visible elements, not just a spinner or a timestamp).

**Check types:**

| Type      | Passes when                                                      | Example                                             |
| --------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `url`     | Current URL path matches a pattern (ids replaced with wildcards) | `/projects/*` after "Create"                        |
| `text`    | Text is visible in the viewport                                  | "Q4 Launch"                                         |
| `element` | A role + name is visible                                         | `heading "Q4 Launch"`, `dialog "Choose a template"` |
| `value`   | An input's value equals the expected value                       | Project name = "Q4 Launch"                          |
| `changed` | URL or meaningful DOM change since before the action             | fallback                                            |

**Evaluation:** the checks are polled for up to 5 s after settle (the extra time counts as dead time). All checks attached to the step must pass. Agent-reported text is matched loosely (case-insensitive, whitespace-normalized, substring), because the agent paraphrases. Learned checks are matched exactly.

**On failure:**

1. The take is discarded. The failure reason ("expected heading 'Q4 Launch', saw dialog 'Upgrade to Pro'") is logged and shown in the UI.
2. Healing gets the before/after screenshots, the ARIA snapshot and the failed expectation. It picks a different element if the locator was wrong, or adds a prerequisite step (close a modal, scroll a container) if something blocked the action.
3. If the same expectation fails on all 3 takes, the flow is marked failed. During a re-run this is how a real UI change is detected, and it triggers the escalation in FR-92.

Learned expectations are stored per form factor in `replay-plan.json`, next to the resolved locators.

#### 9.3.3 Recording modes: Live and Studio

To be confirmed by spikes S7 and S7b.

|                      | Live (default)                                                                              | Studio (opt-in)                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Use for              | Web apps, dashboards, forms, light pages                                                    | Heavy pages: scroll-driven animation, WebGL, autoplay video (Apple-style), or a "cinematic" request                |
| How                  | Real-time CDP screencast                                                                    | Real-time rehearsal saves a HAR, then frame-by-frame rendering on a virtual clock, in N parallel browsers          |
| Target (10 s clip)   | ~16 s total, ≥ 30 fps during motion, no retakes on apple.com (2×) or Wikipedia (1×)         | Frame-perfect 60 fps at 2×: about 5× real time on apple.com, 3.5× on Wikipedia, with 4 workers on an RTX 3050       |

**Both modes:**

- **Browser:** full bundled Chromium with `channel: "chromium"` for modern headless mode. An installed Google Chrome stable can be selected with `launchOptions.channel: "chrome"` for licensed codecs. Stealth uses Puppeteer Extra's plugin through its Playwright adapter; WebGL vendor spoofing is disabled, and mobile/custom user agents retain their configured values.
- **GPU:** `gpu: "auto"` tries dGPU → iGPU → CPU. Optional `vulkaninfo --summary` identifies physical adapter types; Linux sysfs provides a fallback for NVIDIA and Intel chipset graphics. Unknown adapters are skipped. NVIDIA uses PRIME offload, Mesa uses a `DRI_PRIME` vendor/device selector; routing is confined to each child process, with inherited GPU selectors cleared between attempts. Hardware attempts must produce a working WebGL frame on the expected adapter and CDP `gpu_compositing: "enabled"`; software renderers never count as GPU success. Failed browsers close before fallback. CPU mode verifies SwiftShader/software rendering. `gpu: "igpu"` starts at iGPU, and `gpu: "cpu"` skips hardware attempts. Renderer, acceleration status and attempt reasons are returned on `session.gpu` for worker logging; no secrets or raw launch command lines are included in these diagnostics. Probes run before session state is restored. Fallback applies to startup/probe failures, not to replaying an already-running flow after a driver crash.
- **Encoding:** the hardware encoder, through the same detection order as FR-44.

**Studio's virtual clock** is our own page script, not Playwright's clock API, which can hang on heavy pages like Wikipedia.

- It intercepts timers, `requestAnimationFrame`, idle callbacks, `performance.now` and `Date`.
- Every timer runs at least 1 ms, and each frame has a callback cap, so pages that reschedule zero-delay timers still advance instead of looping forever.
- Each frame seeks CSS and web animations and `<video>` elements to virtual time.
- Each frame then waits for one real rendering frame, so scroll and intersection observers fire before the capture.

**Studio speed:**

- Capture with raw CDP `Page.captureScreenshot` (clip scale = DPR, `optimizeForSpeed`), not Playwright's screenshot.
- Deal half-second chunks to N parallel browsers in rotation, so each moves forward through the clip and heavy stretches are shared evenly.
- Make skipped frames cheap: no media seeks, and a real rendering frame only every 4th frame.
- Concatenate the NVENC segments without re-encoding.
- Rehearse with page-sized scroll jumps, not in real time.

**Input in both modes:** an action scene (timed moves to elements, clicks, typing, keys, scrolls) drives the same CDP input in Live (real time) and Studio (per frame, in every worker and the rehearsal). Clicks and typing must work on Studio's virtual clock (test on TodoMVC). Each recording writes `events.json` in scene time, and Live's video is aligned to scene time, so cursor, zoom and caption timings match either mode.

**Studio limits:**

- Saved network responses can diverge from a live app on stateful flows (new IDs, CSRF tokens). Studio suits client-side and viewing flows; server-heavy flows use Live.

#### 9.3.2 Fallback recorder: TinyFish state capture

Used when FR-40a applies: the local browser hits a bot wall, CAPTCHA or geo-block, or the job needs a proxy exit country (for example `IN` for Indian public portals). Live screencast to a TinyFish browser is capped at about 6–8 fps from India by distance alone: Delhi to San Jose is a round trip of 130 ms or more even on ideal fibre. This mode doesn't depend on frame rate.

1. `POST api.browser.tinyfish.ai` with `proxy_config`, then `chromium.connectOverCDP(cdp_url)` and `browser.newContext({ viewport, deviceScaleFactor })`. Spike S1 checks both.
2. Replay the same steps with the same locators, expectations and take logic.
3. After each step settles, capture one 2× still with `page.screenshot()` (WebP, expected about 0.4 s each).
4. During anything animated, such as a modal opening or AI text streaming, capture a short burst of stills. `Animation.setPlaybackRate` can slow CSS animations so a burst catches more of them.
5. For scrolling, capture one tall screenshot that the virtual camera pans across.
6. Emit the same `timeline.json`, with each event pointing at its still instead of a video time. The editor builds the motion: cursor, zoom, pans, and crossfades between states.
7. `DELETE` the session in `finally`.

### 9.4 Creative brief and storyboard (Claude)

**Creative brief** (`brief/creative.json`, FR-5). One fast-tier `json` task right after understand, from the optional video prompt, `product-brief.json` and the video mode:

- audience, goal, target length, tone keywords and the CTA
- a **motion personality** picked with the motion design skill's keyword table: Playful, Premium, Corporate or Energetic (default Corporate for product UI)
- must-show and avoid lists (the focus prompt feeds must-show)

With no prompt, all of it is inferred from the product's tone and the mode. The read-back happens twice:

- **Instantly, in the composer:** a pure reading of the prompt (`readPrompt` in `packages/shared`: length, the skill's personality keywords, tone words, "for …" audience) becomes the plan's Video row, "A calm, premium launch video, about 60 s, for enterprise buyers." No LLM, so no wait, and no LLM call in a request handler (AGENTS.md rule 4).
- **Refined, in the worker:** the understand stage runs the brief task with the product brief and shows its summary on the job page ("A 55 s premium launch video for QA engineers…"). What the prompt states outright (a length, a style word) always wins over the model; "under a minute" means about 50 s. If the coding agent is unavailable, the pure reading becomes the brief.

On autopilot it proceeds. The brief steers discovery (focus), flow selection (target length), the storyboard, the voice and the edit.

**Storyboard** (the script stage). One smart-tier `json` task after recording, because it needs real timings. Inputs: the creative brief, the product brief, the approved flows with step labels and rehearsal frames, and `timeline.json` (labels, durations, dead time removed).

- **Arc by mode.** Launch: hook → problem → 2–4 flows → payoff → CTA. Tutorial: goal → steps → result. Sales: pain → solution → proof → CTA.
- **Beats.** Each beat has its footage span (flow and source in/out), narration with `maxSeconds` from the compressed visual duration × pacing, on-screen text (title, callout, lower third) and a **motion intent**: what to emphasize (a step's element), the emotion it carries, and its kind (reveal, emphasis, transition, hold).
- **Languages.** One storyboard; each language's lines are written natively from it (FR-51), so every language shares one edit.
- Also the hook, title card, CTA and posting copy.

Output: `storyboard.json` (beats, shared) and `script.<lang>.json` (lines per beat). Speech-rate budgets on `eleven_v4` (spike S5 confirms them): EN ≈ 2.8 words/s, HI ≈ 2.55 (launch); tutorial lines run about 15% slower. Brand names and tech terms stay in Latin script inside Hindi lines (FR-51), which should be spoken and transcribed exactly that way.

**Gate 2** shows each beat's frame, both languages and its motion note. A line can be edited, or a single beat re-prompted ("make the hook sharper") without regenerating the rest.

### 9.5 Voice (ElevenLabs)

`POST /v1/text-to-speech/{voice_id}/with-timestamps` with `eleven_v4` and `language_code` (fallback `eleven_multilingual_v2`; not `eleven_v3`, whose word timings can drift up to ~0.4 s). Each beat's line is sent with its neighbours as `previous_text`/`next_text` so separate clips sound continuous. Response audio → `voice/<lang>/<beatId>.mp3`, and alignment (character start/end times) → word timings (`packages/voice`) → `voice/<lang>.json` (`Voiceover`, §10). Captions aren't stored: each render pages the words onto its own timeline (§9.6), at most 7 words a page, breaking at sentence ends and pauses, and highlights each word as it's spoken (`captionStyle: 'karaoke'`). Spike S5 checks that v4's word starts land within ~30–45 ms of an independent transcriber's, so karaoke captions are frame-accurate. Clips run 2 at a time (`ELEVENLABS_CONCURRENCY`; the free plan's limit), the length comes from the mp3 (ffprobe), and a clip whose timings fail the checks is re-made once on the fallback model.

- **Identifiers are read as words.** The voice gets `performance glitch user`, not `performance_glitch_user` ("underscore" read aloud, and 3 s long). The swap keeps the line's length, so the timings map back onto the line as written and captions show the identifier.
- **Reuse.** Each clip's key hashes the voice, model, spoken line and neighbours; a re-run re-voices only lines whose key changed (FR-90), so edits at gate 2 cost only the lines they touch.
- **Budget.** Lines longer than 1.25× their beat's budget are logged; their shots hold until the line ends (§9.6). Auto-tightening them is P1.

**Plan limits.** The free plan has 10,000 characters a month (about ten 60 s videos in English and Hindi; two scripts for a short demo are around 800) and can only use premade voices and the account's own through the API; library voices answer `402 paid_plan_required`. The voice stage checks the plan first (a free call): a configured voice the plan can't use is replaced by a premade one (Bella for English, Brian for Hindi) with a warning, and a job that needs more characters than are left stops before speaking. `agentcast doctor` shows both.

### 9.6 Retiming ("fit video to voice")

For each segment and language:

```
visual_raw   = source out − in (with dead intervals removed)
voice        = clip duration + 0.25 s lead + 0.35 s tail
target       = max(visual_raw / maxSpeed(1.6), voice)
if visual_raw > target: speed-ramp non-interaction spans (typing, loads) up to maxSpeed, never during cursor approach + click
if visual_raw < target: hold on the settled frame with a slow camera drift (Ken Burns) to fill
```

Remotion's `calculateMetadata` computes total duration per (language × aspect) from this, so the same EDL renders correctly for every variant.

**Holds first (`planParts` in `packages/video`).** Each part of the edit lasts at least `0.25 s + its lines (0.2 s apart) + 0.35 s`: the title card and outro stretch to fit the hook and CTA lines, and a shot shorter than its line freezes its last frame (camera and cursor at rest) until the line ends. Shots longer than their line play as cut.

**Speed ramps (`retime.ts`):** a shot carries `ramps: [{ from, to, speed }]` (source seconds, 1.25–4×). Speed eases in and out over the first and last quarter of each ramp (at most 0.35 s), and output time is the integral of 1/speed, tabulated per shot; every frame shows the source second the map gives (Remotion `<Freeze>` on the footage), and camera, cursor and overlays follow the same clock. The baseline adds ramps only in trailer edits (§9.7.2): waits between actions (2.5×), typing (3×) and the recorder's dead time, biggest first, only while the footage stays at least as long as its narration (so a ramp never turns into a freeze) and never while text is up. The drifting hold comes after.

### 9.7 Direct (Claude Code)

- The workspace is the job's `render/` dir: a Remotion project with `src/primitives/*` (VirtualCamera, Cursor, ClickRipple, Captions, Callout, TitleCard, LowerThird, Transition, MusicBed), `src/schema/edl.ts` (zod), artifacts in `data/` (creative brief, storyboard, scripts, voice timings, timelines, baseline EDL), `guides/motion/` (§9.7.1), and `DIRECTOR.md` (role, rules, the brief, budget).
- It's invoked as an `agent` task through the LLM runner (§9.9). By default that's headless Claude Code (`claude -p`) on the user's own login, with the smart tier (`opus` alias). opencode or Codex can be swapped in by config.
- **Allowed tools:** `Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash` restricted to `npx tsc --noEmit`, `npx remotion still …`, `node scripts/validate-edl.mjs`. No network tools, no MCP servers. Wall-clock timeout 6 min.
- **Definition of done:** `edl.json` validates, `custom/*` type-checks, and three stills (0 s, middle, end) render without error. The worker re-verifies independently, so it doesn't trust the agent's claim.
- **Revise loop:** user feedback is appended to the session, and Claude edits only what is needed. At gate 3 a revision is a gate decision `{ reopen: true, revise }`: the orchestrator re-runs `direct` (resuming the session) and `preview`, then asks again.
- **First version (Phase 5b):** the director edits only `edl.json`; the worker re-checks it (schema, storyboard order and spans, callouts in every language, motion lint) with up to 2 repair rounds, then gives the director one look at rendered stills of key moments. If the edit never passes, or Claude Code isn't available, the baseline edit is used. `AGENTCAST_DIRECTOR=off` skips the director.
- **Primitives (`packages/video/src/remotion/`)**, every one timed by the motion tokens:
  - **Kinetic type** (`KineticText`): display lines arrive word by word, each word in its own mask, in the personality's pattern (premium and corporate rise from behind a line, playful bounces up, energetic snaps in at scale, in capitals), staggered within 450 ms; out together. Type style per personality (`typeStyle`): weight, tracking, case. League Spartan, falling back to Noto Sans Devanagari for Hindi.
  - **Backdrop:** the brand background with two glows on slow orbits and a faint grid fading from the centre; it continues across parts (the ambient layer).
  - **TitleCard:** the site address as a kicker, the product name in kinetic type, the script's title line, an accent rule drawing itself. **Outro:** the name, the CTA as the headline, the URL in a pill that lands last and sends out one ring.
  - **Window stage** (`style.frame: 'window'`, 16:9): wide shots sit in a browser window (title bar, the page's address from the timeline, shadow) on the backdrop; it opens to full frame as the camera zooms past 1.25×, so close-ups fill the screen. 9:16 is always full frame.
  - **Shot title** (`segment.title`): a chapter headline in kinetic type over a shot's opening, on a scrim, with an accent rule. **Lower third** (`segment.lowerThirds`): an accent bar grows, a panel wipes open, the words rise in.
  - **Callout** with an optional **spotlight** (the rest of the frame dims); labels stay out of the captions' band.
  - **Transitions** overlap the parts (up to a third of either): `fade` crossfades, `slide` pushes in from the right, `zoom-through` grows the outgoing shot toward the viewer as the next settles in. `cut` doesn't overlap. A part's narration waits for its transition.
  - **Karaoke captions** from the voice's word timings.
  - The baseline places the storyboard's `title`, `callout` and `lowerThird` texts (one at a time; callouts as the pointer heads for the element and gone just after the click; a dropdown choice without a box points at the element opened before it), and picks transitions per personality: premium `fade`, corporate and playful `slide`, energetic `zoom-through`, and `cut` between continuous footage.
  - EDL v4 (§9.7.2) adds headline, montage and stat scenes, speed ramps, the tilted window, lifted callouts, the music bed and sound effects, minimal captions, light sweeps and motion blur on trailer transitions.
  - Later: `DeviceFrame` for phones, custom components (FR-72).

#### 9.7.1 Motion design (the skill as the director's rulebook)

The motion design skill (`.agents/skills/motion-design`, by LottieFiles, MIT licence) is the director's rulebook for every movement in the video.

**How the director gets it.** Its files are copied into the workspace as `guides/motion/` (with the licence notice) and `DIRECTOR.md` says to read them first. Copying, rather than relying on Claude Code's own skill loading, works the same on every backend (opencode and Codex have no Claude skills) and under the runner's locked-down flags.

**Motion tokens.** The director writes `style.motion` into `edl.json` from the brief's personality: the signature easing curve, a quick / standard / slow duration, the overshoot and the entrance pattern. Every primitive reads these tokens, so "calm and premium" and "punchy launch" move differently on the same footage. The skill's tables are for UI animation, so durations are translated for video:

| Motion                                                    | Scale                           | Example (Corporate)                       |
| --------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| Overlays: captions, callouts, click ripples, lower thirds | UI timings as given, 150–400 ms | callout enters in 300 ms, exits in 200 ms |
| Camera moves, scene transitions, title and outro cards    | 2–3× the UI timings, 0.5–1.2 s  | camera eases onto a button in 0.7 s       |

**Beat structure.** The skill's four acts map onto every click:

1. **Anticipation:** the camera starts toward the target as the pointer heads for it.
2. **Action:** the click and the UI change.
3. **Reaction:** the ripple, then the callout, 50–150 ms apart.
4. **Resolution:** a hold of at least the narration's tail before the next beat.

**Three layers in every beat.** Primary: the footage and the camera. Secondary: cursor, ripple, callouts and captions. Ambient: a slow background drift on cards and held shots, the tilted window's drift, and the music bed.

**Emotion map.** Each beat's motion intent picks easing and duration from the skill's emotion table: a big reveal gets the slow tier and a long arc; a quick feature gets the quick tier.

**Motion lint** (FR-77). Before preview, the worker checks the EDL against the skill's critical rules:

- no linear easing on spatial movement (camera, callouts, cards)
- no camera move travelling more than 1/3 of the frame without a cut or zoom-through
- staggers under 500 ms; entrances at least as long as exits
- one personality for the whole video
- every beat has its three layers
- every caption and callout stays up long enough to read (≈ 180 ms per word, minimum 1.2 s)
- one piece of on-screen text at a time per shot (title, callout, lower third), on the output clock (ramps); titles ≤ 6 words, lower thirds ≤ 8 (warnings); a non-cut transition into a shot shorter than three transitions is flagged
- ramps inside their shot and apart; warnings for text during a ramp, headlines over 7 words, scenes too short to read, montage clips under 0.6 s

Failures go back to the same director session (at most 2 repair rounds), then the job falls back to the baseline edit. The director also reviews rendered stills of key moments and fixes what it sees (FR-78).

**Starting point.** The director receives the deterministic baseline EDL (camera on each click, cursor, captions, cards) and improves it, so a weak run can't produce a worse video than the baseline.

#### 9.7.2 Two editing grammars: trailer and guide

A video cut like a how-to (the screen recording carrying 80% of the runtime, the narration reading the
clicks, no music) makes a weak launch video. So the edit has a grammar, `style.edit`, set by the
video type: **launch and sales videos are cut as trailers, tutorials as guides** (`editFor` in
`packages/story`).

|           | Guide (tutorial)                                                       | Trailer (launch, sales)                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story     | the steps in order, every beat on footage                              | claims and proof: headline beats (no footage) between proof shots, at most 3, never two in a row                                                                                                                                         |
| Narration | imperative steps; 85% of a shot's footage                              | outcomes, never clicks or field values; 70% of a shot, so music and cuts carry the rest                                                                                                                                                  |
| Scenes    | shots only                                                             | `statement` (a headline in big kinetic type, its line voiced over it), a closing `montage` of the payoffs in tilted windows, `stat` (a counting number, only for real numbers)                                                           |
| Picture   | browser window opening on zoom                                         | tilted window (perspective, drifting, flattening as it opens), harder zooms (≥ 1.65×), speed ramps, lifted callouts on emphasis shots (the element rises out of the screen as a card), light sweep and motion blur on moving transitions |
| Pace      | as recorded                                                            | cuts on the beat: with a tempo, each part runs on (under a beat) so the next cut lands on one; music starts on a downbeat at frame 0                                                                                                     |
| Sound     | voice; a quiet music bed if there is one (−18 dB, −10 under the voice) | music up front (−6 dB, −13 under the voice), sound effects (`style.sfx: 'auto'`)                                                                                                                                                         |
| Captions  | karaoke box                                                            | minimal: no box, a soft shadow                                                                                                                                                                                                           |

**Headlines.** The storyboard writer adds them in trailer modes (its check enforces the title, the count
and the spacing); without a coding agent, the plain storyboard takes up to two from the product's value
props. Each script translates the title; the statement scene shows it while its line plays. A headline the
edit leaves out falls back to a card for its narration (`beatParts`).

**Music library** (`assets/music/`, FR-85). `tags.json` (`MusicLibrary`) lists each track: file, title,
artist, source, licence (required), moods, energy 1–5, BPM, first downbeat, length. `agentcast music add`
copies a file in and measures tempo and first beat (onset envelope, autocorrelation over 70–180 BPM weighted
toward 120, then a joint tempo-and-phase search; target accuracy 0.1 BPM and 10 ms on test tracks). Audio files aren't
committed; `tags.json` is. The direct stage picks a track by personality moods and grammar energy, preferring
tracks long enough not to loop (seeded by job id), and copies it into the job (`render/audio/`). With an empty
library the video simply has no music. Ducking: the bed eases down 0.15 s before each line and back up 0.3 s
after; fades in over 0.5 s and out over 1.6 s.

**Sound effects** are synthesised with ffmpeg (`ensureSfx`: whoosh, click, pop, riser, hit), so there's no
licence to track; made once per machine in `~/.agentcast/sfx/` and copied into the job. With `sfx: 'auto'`:
a riser peaking as the product name lands, a whoosh centred on each transition, a pop as each headline or
stat lands, a soft click on each recorded click, a hit on the CTA. Shots may add their own cues.

**Loudness.** Previews and finals are normalised to −14 LUFS / −1.5 dBTP with `loudnorm`, the picture copied.

**Director.** `DIRECTOR.md` documents EDL v4 and the grammar; trailers also get `guides/trailer.md` (how a
launch trailer is cut: shape, pace, picture, sound). Its time limit is 8 minutes. The check requires the
storyboard's shots and headlines in order as shots and statements; montages and stats are the director's own.

#### 9.7.3 The look follows the product

A video shouldn't look like AgentCast (one fixed base colour, accent, font pair and centred layout per
card), and a greyscale brand shouldn't fall back to our accent. The video is made from the product's
own look.

**Brand kit v2** (`brief/brand.json`, read from the landing page in local Chrome):

- **Theme and palette:** the page's background by a vote over a 5×5 grid of points (each taking the first opaque background outward), its text colour as the one most of the visible text uses (weighted by size and length), pushed to 13:1 for video; the accent pooled from theme-color, buttons, links and the screenshot, or for a greyscale brand its text colour (so black-and-white stays black-and-white); a second colourful colour as `accent2`; a `surface` for panels.
- **Fonts:** the main heading's and a paragraph's computed families, matched on Google Fonts through framework mangling (`__Inter_d65c78` → Inter, `GeistSans` → Geist); otherwise a stand-in by the family's category (Inter, Source Serif 4, JetBrains Mono, Space Grotesk). Loaded at render time from Google Fonts (the render waits; Figtree/League Spartan stay bundled as fallbacks, Noto Sans Devanagari for Hindi).
- **Shape and imagery:** the commonest button corner radius, the hero's gradient stops, and a screenshot of the first screen (`brief/hero.jpg`).
- **Logo plate** by contrast with the video's theme (a dark logo on a dark video, or a light one on a light video, gets a plate of the opposite tone).

**The look** (`style.look`, EDL v5), chosen by `chooseLook` from the brand and the personality, seeded by the site so products differ:

- `theme`: the brand's.
- `title` (title card and outro): `center`, `editorial` (left column), `wordmark` (the name huge), `split` (beside the hero screenshot in a tilted window; needs a hero).
- `statement` (headline scenes): `center`, `editorial` (an index like "02" above), `panel` (an accent panel wipes across; text in black or white, whichever reads), `outline` (outlined type that fills from the left).
- `backdrop`: `glow`, `solid` (the brand colour with a drifting soft light), `mesh` (the brand's colours as drifting blobs; never for greyscale brands), `hero` (the first screen, blurred and washed into the background).
- `chrome`: `browser` (address bar), `minimal` (a bare frame, for sharp brands), `none`; `radius` from the brand's buttons (sharp stays sharp, pills get round windows).

Every component is theme-aware: window bars and surfaces, pills and callout labels in whichever of black or white reads on the accent, captions in a dark box with colours made readable on it. The director gets `data/brand.json` and `data/hero.jpg`, may change the look's layouts and backdrop and use the brand's other colours, but not flip the theme or leave the brand; the lint fails a palette below 4.5:1 for text or 3:1 for the accent.

Try it on saucedemo, vengenceui.com, Stripe, Linear and Notion: they should come out with clearly different looks (light and mint, black-and-white with outlined headlines, white with Stripe purple, black editorial, white with a blue mesh).

### 9.8 Render and fan-out

- Bundle once per job (`@remotion/bundler`). `renderMedia` per variant with `inputProps = { lang, aspect, formFactor }`.
- **Virtual camera math:** camera keyframes are in _source_ coordinates (`{t, bbox, zoom}`). For each output aspect, the crop rect = the largest rect of that aspect containing `bbox × padding`, scaled by zoom, clamped to the frame, and spring-smoothed (critically damped). For 9:16 from desktop footage, this reframes like a camera operator. Mobile footage at 9:16 is native.
- **Audio:** VO per segment as `<Audio>` in `<Sequence>`s. Music with a volume callback for ducking, sound effects as short `<Audio>`s at their cues (§9.7.2). Final loudness normalized in an FFmpeg pass.
- **Outputs:** `out/<variant>.mp4`, `.srt`, `.vtt`, `poster.jpg`, `teaser.gif`.

### 9.8.1 Re-run on update

A re-run is a **new job** (`config.rerun = { of, skipIfUnchanged }`, on autopilot) so the earlier job and its videos stay as they were. Start one with `agentcast rerun --job <id>` (through the worker if it's up, so the web app shows it; in-process otherwise), `POST /jobs/:id/rerun`, or "Re-run on latest UI" on the job page. The earlier job's record and direct stages must be done.

- **Carried over:** the briefs, the approved flows (understand → gate 1 are marked done with the earlier outputs), the replay plan and the voice clips.
- **Record:** every approved flow is rehearsed and filmed again. Saved locators that stop matching heal through the usual chain (role → label → … → the coding agent). A saved pick by position (`>> nth=`) is ignored when the step has a `near` hint, so a reordered list can't send the click to the wrong item. In a re-run, a learned check that no longer holds is dropped for the explorer's own expectation and learned again (once per step), and the step is reported as changed. A flow that still fails is left out with its shots and lines.
- **Change report** (`record/changes.json`, FR-91): each step's new take against the old one. A step changed when its locator healed, its learned outcome changed, or its settled frame differs (mean absolute difference of a grey thumbnail of the page above 0.02, or of the step's element above 0.04; two recordings of an unchanged site differ by ≤ 0.011). Changed steps get before/after frames. The job page and the CLI show it.
- **Script, voice, edit:** no LLM calls. The storyboard and the final EDL (the director's, with its revisions) are moved onto the new recording by step: each flow gets a time map anchored at every step's pointer start, action and settle in both recordings (linear between anchors), and every box (zoom targets, callout anchors) follows its element by the same affine move as the matched event's box. Lines whose words and neighbours are unchanged reuse their clips (0 characters).
- **CI:** `skipIfUnchanged` skips script → render when nothing changed.
- Target on a small site (2 flows, EN + HI, 1080p): about 2.5 min end to end, 0 ElevenLabs characters, identical framing when nothing changed.
- After that: FR-92 (a TinyFish re-explore for a flow that can't heal), the GitHub Action, `agentcast run`.

### 9.9 LLM backends: bring your own coding agent

AgentCast needs **no LLM API key**. Every LLM call goes through `packages/llm`, which drives a coding-agent CLI that is already installed and logged in on the machine. Claude Code is the default, first-class backend. Whoever clones the repo uses whichever agent they have.

**Two kinds of task:**

| Kind    | Used by                                                                                                   | Contract                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `json`  | Product brief, flow-scoring judge, script writer, locator healing, mobile prerequisite step, auto-tighten | Prompt + JSON Schema + optional image/file paths → a zod-validated object                                                                                                                        |
| `agent` | Director (EDL + custom components) and the revise loop                                                    | Workspace dir + task prompt + allowed commands → files written in the workspace, verified independently by the worker. Streams progress events and returns a session id so revisions can resume. |

**Model tiers:** `smart` (director, script writer) and `fast` (brief, judge, healing). For Claude Code these map to the `opus` and `haiku` aliases, so new model versions need no code change. Codex uses its built-in default model, or `AGENTCAST_LLM_SMART_MODEL` / `AGENTCAST_LLM_FAST_MODEL` when set to Codex model names. Its user config is deliberately ignored. For other backends the model strings come from config.

**Backends:**

| Backend                        | Auth                                                 | `json` task                                                                                                                           | `agent` task                                                                                                                                                                                   | Status                                                                                                                        |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **`claude-code`** (default)    | The user's Claude Code login (subscription). No key. | `claude -p … --json-schema '<schema>' --output-format json` → read `structured_output`                                                | `claude -p … --output-format stream-json --verbose`. Revise with `--resume <session_id>`.                                                                                                      | Pending: check sandboxed file write and `--json-schema` on a subscription login (spike S6)                                    |
| **`opencode`**                 | Whatever provider opencode is configured with        | `opencode run --format json` + file contract                                                                                          | `opencode run --dir <ws> --format json [--session <id>]`, with permissions from a generated `opencode.json` in the workspace. Never `--auto`.                                                  | Pending: check flags and permission config (spike S6)                                                                         |
| **`codex`**                    | Codex CLI login (`codex login`), no API key          | `codex exec --json --ephemeral --sandbox read-only --output-schema schema.json -o answer.json -`; zod validation and one repair round | `codex -a never exec --json -C <ws> --sandbox workspace-write --skip-git-repo-check`, resumed with `codex exec resume <id> -`; shell disabled, edits with `apply_patch`, worker checks the EDL | Pending: Codex CLI 0.163+, with fake-CLI tests for both task kinds                                                            |
| **`anthropic-api`** (optional) | `ANTHROPIC_API_KEY`                                  | Messages API with structured output                                                                                                   | Claude Agent SDK                                                                                                                                                                               | Pending: only when a key is present and selected                                                                              |

**Claude Code invocation (every call is locked down):**

```bash
# --restricted         no Bash/WebFetch unless named in --tools; ignores user/project settings; file tools confined to cwd
# --strict-mcp-config  none of the user's MCP servers (Drive, Gmail, browser plugins…) load
# --tools              json tasks use "Read" (for images) or ""
# --permission-mode    headless can't prompt, so anything not allowed is denied
# --model              opus for the smart tier, haiku for the fast tier
claude -p "<prompt>" \
  --restricted \
  --strict-mcp-config \
  --tools "Read,Write,Edit,Glob,Grep,Bash" \
  --allowedTools "Bash(npx tsc --noEmit)" "Bash(npx remotion still:*)" "Bash(node scripts/validate-edl.mjs)" \
  --permission-mode acceptEdits \
  --model opus \
  --output-format stream-json --verbose
```

- **Never pass `--bare`.** It only accepts `ANTHROPIC_API_KEY` or an `apiKeyHelper` and ignores the subscription login.
- If `ANTHROPIC_API_KEY` happens to be set in the shell, Claude Code may bill that key instead of the subscription. The runner removes it from the child process environment unless `AGENTCAST_CLAUDE_USE_API_KEY=1`.
- The child process also gets no TinyFish or ElevenLabs keys.

**Codex invocation:** every call uses `--ignore-user-config --ignore-rules`, disables shell,
plugins, hooks, apps, multi-agent tools and web search, and uses `-a never`. The task directory
is marked untrusted to skip project config; automatic `AGENTS.md` loading is disabled.
Text files are supplied on stdin as delimited JSON records and screenshots through `-i`.
The director receives a fresh workspace snapshot on every turn, including new review stills,
and edits via `apply_patch`. It runs no commands, including `allowCommands`; the worker performs
validation and feeds errors back through the existing repair loop. The sandbox allows writes
only to the task workspace, with network access and temporary-directory write exceptions disabled.
`HOME` / `CODEX_HOME` retain the existing login and director sessions; API keys are stripped.
JSON tasks are ephemeral. Optional JSON fields travel as required nullable fields and are restored
before zod validation; dynamic-key maps use a JSON-string contract. Task text is capped at 2 MiB,
and hidden files and paths escaping the workspace (including symlinks) are rejected.

**Selection:** `AGENTCAST_LLM=auto` (the default) picks the first available of `claude-code` → `opencode` → `codex` → `anthropic-api`. Per-tier overrides are `AGENTCAST_LLM_SMART` and `AGENTCAST_LLM_FAST`, so you can, for example, run the director on Claude Code and the judge on opencode. `agentcast doctor` shows what was detected.

**Rules that keep backends interchangeable:**

1. **File contract.** Each task gets a scratch dir `jobs/<id>/llm/<taskId>/` with `TASK.md`, `schema.json` and the inputs (screenshots, ARIA snapshots). Native structured output (`--json-schema`, `--output-schema`) is used where the backend has it. Otherwise the agent writes `result.json`. The worker always validates with zod and allows one retry with the validation errors.
2. **Instructions live in the prompt and the task files** (`TASK.md`, `DIRECTOR.md`), never in backend-specific memory files, so no backend depends on `CLAUDE.md`/`AGENTS.md` discovery. Restricted mode ignores project settings anyway.
3. **Images are passed as file paths** the agent opens: Claude Code's `Read` tool, `codex -i`, `opencode -f`.
4. **One event stream.** Each adapter maps its CLI's stdout into `LlmEvent` (`text`, `tool_use`, `done`, `error`) for the UI. Unknown events are ignored, which tolerates CLI version drift.
5. **Budget for subscription limits.** Subscription logins have usage limits, and each CLI call has about 3–5 s of startup. The LLM pool defaults to 2 concurrent calls, the judge scores all flows in one batched call, and locator healing only runs after the deterministic lookup chain fails. Healing latency becomes dead time that the edit cuts.

**Hosted-product caveat:** running AgentCast on your own machine with your own CLI login is the intended setup for this build. A hosted, multi-user AgentCast must not route other people's jobs through one personal subscription. It would use `anthropic-api` with a proper key, or run on each user's own machine with their own login.

---

## 10. Data contracts

All artifacts live in `~/.agentcast/jobs/<jobId>/` and carry `"schemaVersion"`. Zod schemas live in `packages/shared`.

Exploration recovery contracts (`packages/shared/src/exploration.ts`):

| Artifact                                                            | Version | Required recovery data                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explore/tasks/<taskId>.json`                                       | 1       | Task ID, request hash, safe start URL, original start/update times, status, optional stop reason, provider run ID, safe last snapshot and error. Saved atomically before/after creation. |
| `explore/plan.json`                                                 | 1       | Scout run ID, verified entrance proposal, access classification, reason, blockers and independent candidate outlines.                                                                    |
| `explore/candidates.json`                                           | 2       | Normalized candidate report, including performed flag and steps. Unknown versions fail validation.                  |
| `explore/discovery-run.json`, `explore/runs/<flowId>[-repair].json` | 1       | Provider fields at the top level plus schemaVersion; goals and live/video URLs removed, secret values redacted.            |
| `explore/failures/<taskId-or-flowId>.json`                          | 1       | Time, sanitized start/current URL, classified error, optional run/step ID, safe actions and optional screenshot path/accessibility snapshot. Images are binary sibling files.            |

`flows.json`, `flow-review.json` and `record/replay-plan.json` retain their existing versions and validate on read/write. Task IDs distinguish scout, initial flow, repair and user-added requests. `startedAt` survives retries so resuming cannot reset the elapsed budget.

```ts
// flows.json
type Flow = {
  id: string;
  title: string;
  whyItMatters: string;
  startUrl: string;
  requiresAuth: boolean;
  rank: number;
  selected: boolean;
  scoring: FlowScoring;
  steps: Step[];
  tinyfishRunId: string;
};
type Step = {
  id: string;
  action:
    | "navigate"
    | "click"
    | "type"
    | "select"
    | "press"
    | "scroll"
    | "hover"
    | "wait";
  target?: {
    text?: string;
    role?: string;
    label?: string;
    placeholder?: string;
    near?: string;
  };
  value?: string;
  secret?: boolean;
  expected?: string;
  narrationHint?: string;
  screenshotUrl?: string;
  expect?: Expectation[]; // agent-reported or action-implied (§9.3.1)
};
type FlowScoring = {
  // §9.2.1
  valueAlignment: number;
  visiblePayoff: number;
  lengthFit: number;
  distinctness: number;
  focusMatch?: number;
  riskPenalty: number;
  score: number;
  storyRole: "setup" | "core" | "payoff" | "share";
  valuePropCited: string;
  rationale: string;
};
type Expectation =
  | { type: "url"; pattern: string }
  | { type: "text"; text: string; match: "loose" | "exact" }
  | { type: "element"; role: string; name: string }
  | { type: "value"; target: string; value: string }
  | { type: "changed" };

// replay-plan.json — cache of resolved locators + learned expectations per form factor
type ReplayPlan = Record<
  FormFactor,
  Record<
    StepId,
    {
      strategy: "role" | "label" | "placeholder" | "text" | "llm";
      locator: string;
      lastOk: string;
      learnedExpect?: Expectation[]; // from the last clean take; preferred over Step.expect
    }
  >
>;

// recordings/<formFactor>/timeline.json  (the edit timeline)
type Timeline = {
  recordingId: string;
  formFactor: "desktop" | "mobile";
  viewport: { w: number; h: number; dpr: number };
  fps: 30;
  duration: number;
  flows: { flowId: string; in: number; out: number }[];
  events: TimelineEvent[];
  dead: [number, number][]; // safe-to-cut intervals
};
type TimelineEvent = {
  t: number;
  flowId: string;
  stepId: string;
  kind: Step["action"] | "settled";
  label: string; // "Create project"
  bbox?: [number, number, number, number]; // x, y, w, h in CSS px
  cursor?: {
    from: [number, number];
    to: [number, number];
    t0: number;
    t1: number;
  };
  value?: string | { redacted: true };
  url: string;
};

// brief/creative.json (§9.4)
type CreativeBrief = {
  prompt?: string; // the user's words, if any
  audience: string;
  goal: string;
  targetSeconds: number;
  tone: string[]; // e.g. ["calm", "premium"]
  personality: "playful" | "premium" | "corporate" | "energetic";
  cta: string;
  mustShow: string[];
  avoid: string[];
  inferred: boolean; // true when there was no prompt
};

// script/storyboard.json — shared by every language (§9.4)
type Storyboard = {
  schemaVersion: 1;
  arc: "launch" | "tutorial" | "sales";
  beats: {
    id: string;
    role: "hook" | "problem" | "setup" | "core" | "payoff" | "cta";
    flowId?: string;
    in?: number;
    out?: number; // footage span, source seconds (all or none)
    onScreen: {
      kind: "title" | "callout" | "lowerThird";
      text: string;
      stepId?: string;
    }[]; // English; scripts translate
    motion: {
      kind: "reveal" | "emphasis" | "transition" | "hold";
      emotion: string;
      focusStepId?: string;
    };
    intent: string; // what the narration must get across
    maxSeconds: number; // 85% of the footage, or the card's length for hook/cta
  }[];
};

// script/script.<lang>.json (schemaVersion 2)
type Script = {
  lang: "en" | "hi" | string;
  hook: string;
  titleCard: string;
  cta: string;
  posting: { title: string; description: string; hashtags: string[] };
  segments: {
    beatId: string;
    text: string;
    onScreen: string[];
    maxSeconds: number;
  }[];
};

// voice/<lang>.json — the narration (§9.5); clips at voice/<lang>/<beatId>.mp3
type Voiceover = {
  lang: string;
  voiceId: string;
  voiceName: string;
  clips: {
    beatId: string;
    file: string;
    text: string;
    seconds: number;
    words: { text: string; start: number; end: number }[]; // seconds in the clip
    model: string;
    key: string;
  }[]; // key: reuse when unchanged
};

// edl.json — written by Claude Code, rendered by Remotion
type EDL = {
  schemaVersion: 5;
  fps: 30;
  style: {
    palette: {
      bg: string;
      fg: string;
      accent: string;
      surface?: string;
      accent2?: string;
    };
    fonts: { display: string; text: string }; // v5: the brand's fonts (Google Fonts families)
    look: {
      theme: "dark" | "light"; // v5: the brand's look (§9.7.3)
      title: "center" | "editorial" | "wordmark" | "split";
      statement: "center" | "editorial" | "panel" | "outline";
      backdrop: "glow" | "solid" | "mesh" | "hero";
      chrome: "browser" | "minimal" | "none";
      radius: number;
    };
    pacing: "calm" | "balanced" | "punchy";
    edit: "trailer" | "guide"; // v4: the editing grammar (§9.7.2), from the video type
    captionStyle: "karaoke" | "block" | "minimal";
    music: {
      mood: string;
      trackId?: string; // v4: the bed, from assets/music/tags.json
      bpm?: number;
      firstBeat?: number; //     its tempo and first downbeat (cuts on the beat)
      gainDb?: number;
      duckDb: number;
    }; //     level alone, and how far it ducks under the voice
    sfx: "auto" | "none"; // v4: automatic sound effects
    frame: "window" | "tilt" | "none"; // 16:9 shots: browser window, tilted window, or full bleed
    motion: {
      // §9.7.1, from the brief's personality
      personality: "playful" | "premium" | "corporate" | "energetic";
      easing: [number, number, number, number]; // signature cubic-bezier
      durations: { quick: number; standard: number; slow: number }; // seconds, overlay scale
      cameraScale: number; // camera/transition durations = durations × this (2–3)
      overshoot: number; // 0–0.3, overlays only
      entrance: "fade-scale" | "slide" | "rise" | "snap";
      hold: number; // seconds the camera stays after an action
      zoom: number;
    };
  }; // zoom onto a clicked element
  intro: { component: string; props: Record<string, unknown>; seconds: number };
  segments: Array<
    // playing order
    | {
        kind: "shot";
        id: string;
        flowId: string;
        formFactorSource?: "desktop" | "mobile";
        in: number;
        out: number;
        ramps?: { from: number; to: number; speed: number }[]; // v4: speed ramps, source seconds, 1.25–4×
        camera: {
          t: number;
          target: "full" | [number, number, number, number];
          zoom: number;
          ease: "spring" | "smooth" | "cut";
        }[];
        cursor: "auto" | "hidden";
        callouts?: {
          t: number;
          text: Record<string, string>;
          anchor: [number, number, number, number];
          spotlight?: boolean;
          lift?: boolean;
        }[]; // v4: lift the element out as a card
        title?: { text: Record<string, string>; seconds: number };
        lowerThirds?: { t: number; text: Record<string, string> }[];
        sfx?: {
          t: number;
          kind: "whoosh" | "click" | "pop" | "riser" | "hit";
          gain?: number;
        }[]; // v4
        transitionIn: "cut" | "fade" | "slide" | "zoom-through" | string;
      }
    | {
        kind: "statement";
        id: string;
        text: Record<string, string>;
        kicker?: Record<string, string>;
        seconds: number;
        transitionIn: string;
      }
    | {
        kind: "montage";
        id: string;
        clips: { flowId: string; in: number; out: number }[];
        text?: Record<string, string>;
        seconds: number;
        transitionIn: string;
      }
    | {
        kind: "stat";
        id: string;
        value: number;
        prefix?: string;
        suffix?: string;
        decimals?: number;
        label: Record<string, string>;
        seconds: number;
        transitionIn: string;
      }
  >;
  outro: { component: string; props: Record<string, unknown>; seconds: number };
};

// assets/music/tags.json — the music library (§9.7.2)
type MusicLibrary = {
  tracks: {
    id: string;
    file: string;
    title: string;
    artist?: string;
    source: string;
    license: string; // required: no unlicensed music
    mood: string[];
    energy: 1 | 2 | 3 | 4 | 5;
    bpm: number;
    firstBeat: number;
    seconds: number;
  }[];
};

// brief/brand.json — the brand kit (FR-12, §9.7.3), schemaVersion 2
type Brand = {
  url: string;
  theme: "light" | "dark"; // from the page's own background
  palette: {
    bg: string;
    fg: string;
    accent: string;
    surface: string;
    accent2?: string;
  }; // #rrggbb
  accentFrom:
    "theme-color" | "buttons" | "links" | "screenshot" | "text" | "default"; // text: a greyscale brand
  found: string[]; // screenshot colours, most prominent first
  gradient?: string[]; // the hero's gradient stops
  fonts: { display: FontChoice; text: FontChoice }; // FontChoice: { family (Google Fonts), source (the site's), exact, category }
  radius: number; // button corners, CSS px; 999 = pill
  logo?: {
    file: string;
    width: number;
    height: number;
    plate: boolean;
    from: "inline-svg" | "img" | "background" | "apple-touch-icon" | "icon";
  };
  hero?: { file: string }; // brief/hero.jpg, the first screen
};

// job.json (Job schemaVersion 2; version 1 files still read)
type JobConfig = {
  url: string;
  auth: AuthConfig;
  stylePrompt: string;
  focusPrompt?: string;
  mode: "launch" | "tutorial" | "sales";
  variants: { aspects; langs; formFactors };
  autopilot: boolean;
  rerun?: { of: string; skipIfUnchanged: boolean };
}; // v2: a re-run of job `of` (§9.8.1)

// record/changes.json — a re-run's change report (§9.8.1, FR-91)
type ChangeReport = {
  jobId: string;
  parentJobId: string;
  at: string;
  changed: boolean;
  summary: string; // "UI changed in 1 of 2 flows. …"
  flows: {
    flowId: string;
    title: string;
    status: "unchanged" | "changed" | "failed";
    reason?: string;
    seconds?: { before: number; after: number };
    steps: {
      stepId: string;
      label: string; // changed steps only
      locator?: { before: string; after: string; strategy: LocatorStrategy };
      outcome?: string; // why the learned check was dropped
      visual?: { page: number; element?: number }; // 0–1
      frames?: { before: string; after: string };
    }[];
  }[];
};
```

`timeline.json` is the edit timeline. **bbox** drives auto-zoom and callout anchors. **t** drives cuts, captions and cursor motion.

`CreativeBrief`, `Storyboard`, `Voiceover`, `Brand` and `ChangeReport` are new schemas; `Job` is at 2 (added `config.rerun`). `Script` (lines keyed by beat) is at `schemaVersion: 2` and `EDL` at 3 (2 added `style.motion`; 3 added `style.frame`, shot titles, lower thirds and callout spotlights); files from before are rejected, not misread (AGENTS.md rule 3). The four personality presets are in `packages/shared/src/motion.ts` (`MOTION_PRESETS`).

---

## 11. Non-functional requirements

| Area                                                             | Target                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latency** (public app, 3 flows, 2 langs, 2 aspects, autopilot) | Understand ≤ 30 s · Explore ≤ 4 min · Record ≤ 2 min · Script+Voice ≤ 1 min · Direct ≤ 3 min · Preview ≤ 1 min · Fan-out ≤ 4 min → **first preview ≤ 10 min, all variants ≤ 14 min**                                                                                             |
| **Re-run on update**                                             | ≤ 5 min to all variants when flows self-heal                                                                                                                                                                                                                                     |
| **Visual quality**                                               | 1080p output. Source frames captured at DPR 2 so 2× zoom stays crisp. Local recording ≥ 30 fps during motion (60 expected; spike S1). Fallback flows are crisp stills with synthetic motion. CFR 30 fps output.                                                                         |
| **Reliability**                                                  | ≥ 80% of runs on the curated demo targets produce a video with no human intervention. Every stage has retries with backoff and honors `Retry-After` on 429/503.                                                                                                                  |
| **Cost control**                                                 | Worker-side step budgets and `max_duration_seconds` on every Agent run; omit the beta-gated `max_steps` option. Browser sessions get `timeout_seconds` and guaranteed `DELETE`. TTS only re-synthesizes changed lines. Per-job budget display.                                   |
| **Observability**                                                | Structured logs per stage (pino), every external call logged with duration and status (no secrets), stage timings shown in the UI, `events.ndjson` per job for replay/debug                                                                                                      |
| **Portability**                                                  | Runs on a single laptop (Linux/macOS), Node 22+, FFmpeg (bundled by Remotion), Chromium only for local stills. Needs only TinyFish and ElevenLabs keys plus any one supported coding-agent CLI that's logged in (§9.9). `git clone` → `pnpm install` → `agentcast doctor` → run. |

---

## 12. Security, privacy and safety

| Threat                                    | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Credential leakage to LLMs/logs**       | Vault or a human sign-in. Local secrets are AES-256-GCM encrypted with a key in the OS keychain or an env var. `secret` values redacted in all artifacts. Password fields are already masked on screen, and email/token patterns are blurred (FR-48).                                                                                                                                                                                                                                                                                               |
| **Prompt injection from the target site** | Page copy, step text and screenshots are _untrusted data_. The coding agent runs in restricted mode (Claude Code `--restricted --strict-mcp-config`, equivalent permission configs for other backends) with no network tools, no MCP servers, a restricted Bash allowlist, a job-scoped cwd and no env secrets. Worst case is a bad video, not exfiltration. The EDL is schema-validated, and custom components are type-checked and rendered in Remotion's sandbox. Prompts wrap site content in delimiters with instructions to treat it as data. |
| **Agent doing damage in a real account**  | Guardrails in every goal (FR-23). Recommend test accounts or staging. Domain allowlist. The recorder only executes approved steps. Steps whose labels match destructive keywords (`delete`, `remove`, `pay`, `purchase`, `send`, `invite`) need explicit approval at gate 1 even in autopilot.                                                                                                                                                                                                                                                      |
| **SSRF via URL intake**                   | Validate scheme and host, block private/loopback/link-local ranges and metadata IPs. TinyFish Fetch also rejects these.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Third-party content rights**            | Users may only generate videos of products they own or are authorized to show. Music library is royalty-free with each track's source and licence recorded in `assets/music/tags.json` (required by the schema); sound effects are generated, not sourced.                                                                                                                                                                                                                                                                                          |
| **Bot detection / ToS**                   | The local recorder uses Puppeteer Extra's stealth plugin through Playwright Extra by default, with an explicit opt-out. Automate only products the user owns or is authorized to demo. Stealth does not guarantee access; explicit security blocks still stop local replay and follow the existing fallback policy. No CAPTCHA solving. |

---

## 13. Success metrics

### Hackathon judging

- **Live demo:** paste a URL on stage → live agent view → gate 1 → preview video within the slot (with a pre-generated backup run).
- **TinyFish depth:** Agent (discovery plus parallel per-flow runs), Fetch, Profiles and Vault are load-bearing, with the Browser API as the fallback recorder. The live agent views and parallel exploration are shown on screen. The pitch: TinyFish finds and rehearses every flow, and the take is filmed locally at 60 fps.
- **Wow moments:** the same run yields 16:9 EN + 9:16 HI. "Re-run on update" after changing a button label in the demo app live.

### DemoBoard target

`apps/demoboard` is the controlled SaaS target from the implementation plan. It is independently deployable to Vercel, with a fixed public demo account, a seeded dashboard, project creation from four templates, brief-driven simulated content generation (2.1-second delay), editable drafts, task/status tracking, sample audience charts, and real project-progress reports. CSV, Markdown and JSON downloads, workspace backup/restore, and a confirmed reset make filming repeatable. A single `NEW_PROJECT_LABEL` constant supports the "New project" → "Create project" re-run demo.

The demo has no external provider dependencies. Its generation is explicitly simulated, its audience metrics explicitly sample data, and projects are stored per browser rather than in a shared database. Browser persistence and JSON backup/restore use a local versioned zod contract (`schemaVersion: 1`, `apps/demoboard/src/lib/model.ts`); these are demo-app data, separate from §10's AgentCast pipeline artifacts. The fixed-account session is server-validated with an expiring HttpOnly cookie. For remote TinyFish exploration it must be deployed publicly; local Chrome QA uses port 3001. Its README covers deployment and the three recording paths.

### Product

- Time-to-first-video (median) ≤ 10 min. Re-run ≤ 5 min.
- Autopilot success rate on the 10-site benchmark set ≥ 80%.
- Revision rounds per approved video ≤ 1.5.
- Share of renders where the user changed nothing at gates 1–2 (trust signal).

---

## 14. Risks and mitigations

| #   | Risk                                                                                                                                   | Likelihood   | Impact               | Mitigation                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | CDP screencast over a remote TinyFish session yields a low or uneven frame rate                                                        | High         | High                 | **Decided up front (§7.1, row 9):** record in local Chromium (60 fps target). Spike S1 checks the remote frame rate (expected 4–6 fps at a ~305 ms round trip from Delhi). The TinyFish fallback uses state capture, which works at any latency. |
| R2  | Agent output steps too vague to replay                                                                                                 | Med          | High                 | Strict `output_schema` with semantic targets. Prompt for exact visible text. LLM locator healing from ARIA snapshot. Gate-1 inline editing.                                                                                                    |
| R3  | `newContext` with custom viewport not permitted on TinyFish CDP                                                                        | Low          | Med                  | Spike S1 checks `browser.newContext({ viewport, deviceScaleFactor })` on TinyFish sessions.                                                                                                                                                    |
| R4  | Profile state can't be exported for the recorder                                                                                       | Known        | Med                  | Capture `storageState` ourselves from the setup session before saving (§8.2). Otherwise replay login.                                                                                                                                          |
| R5  | Claude Code direction slow or produces broken components                                                                               | Med          | Med                  | EDL-first design with a primitives library, test-render gate, fallback to defaults, time cap                                                                                                                                                   |
| R6  | Remotion render time on a laptop for 8 variants                                                                                        | Med          | Med                  | Preview at 540p. Final concurrency tuned. Only render selected variants. Remotion Lambda as a stretch option.                                                                                                                                  |
| R7  | Hindi TTS quality or pronunciation of product names                                                                                    | Med          | Low                  | Multilingual voice, Latin-script product names, pronunciation dictionary / phonetic respelling in the script                                                                                                                                   |
| R8  | Target site blocks automation, or CAPTCHA/OTP                                                                                          | Med          | Med                  | Stealth profile, human sign-in once, curated demo targets for judging                                                                                                                                                                          |
| R9  | Indian public portals geo-restrict non-Indian IPs                                                                                      | Med          | Med (civic use case) | A local recorder in India has an Indian IP already. For agents and the fallback recorder, `country_code: "IN"` is accepted (TinyFish FAQ). Confirm it actually exits in India before relying on it.                            |
| R10 | Credit or rate limits during the live demo                                                                                             | Low          | High                 | Pre-warm, cache artifacts, pre-generated backup run, budget display, honor `Retry-After`                                                                                                                                                       |
| R11 | Agent creates duplicate data on each re-run (e.g. "Q4 Plan (3)")                                                                       | High         | Low                  | Templated values with a run suffix hidden by the camera crop, or idempotent names. Optional cleanup flow (P2).                                                                                                                                 |
| R12 | Remotion licensing                                                                                                                     | Low          | Low                  | Free for individuals and companies ≤ 3 people. Revisit for commercial launch.                                                                                                                                                                  |
| R13 | Subscription usage limits hit mid-job (many LLM calls, live demo)                                                                      | Med          | Med                  | LLM pool of 2, batched judge, deterministic-first healing, fast tier for small tasks. Jobs resume after a limit reset. Switch backend with `AGENTCAST_LLM`. Pre-generate the demo backup run.                                                  |
| R14 | Coding-agent CLI flags or output formats change between versions                                                                       | Med          | Med                  | Small flag surface, adapter contract tests against recorded CLI output, `agentcast doctor --probe`, file-contract fallback, and tolerant event parsing                                                                                         |
| R15 | The local recorder is blocked by bot detection, or shows a different page than the agents saw (geo, A/B tests, consent banners)        | Med          | Med                  | Detect blocks: CAPTCHA frames, a 403, or an expectation failing on the first step. Move that flow to the TinyFish fallback recorder (FR-40a). Dismiss consent banners in recording hygiene.                                                    |
| R16 | A login cookie moved between TinyFish (US) and the local recorder is rejected because it's bound to an IP or device                    | Med          | Med                  | Local sign-in is the default (§8.2). Vault mode replays the login on whichever side rejects it.                                                                                                                                                |
| R17 | Laptop load during recording (other apps, renders) drops frames                                                                        | Low          | Med                  | Recording and rendering never overlap in a job. Cap local recorder browsers at 2. Measure effective fps per take and retake below 24 fps.                                                                                                      |
| R18 | Studio's virtual clock hangs or diverges on some pages (timer loops, web workers, WebSockets, stateful responses replayed out of date) | Med          | Med                  | Our own clock with a minimum timer delay and a per-frame callback cap. A wall-clock budget per frame and per render, with fallback to Live for that flow. Studio is opt-in and limited to viewing and scrolling flows until clicks are proven. |
| R19 | The motion design skill is written for UI animation (100–600 ms), so applying it literally makes camera moves twitchy                  | Med          | Med                  | A video translation table (§9.7.1): overlays keep UI timings, camera and transitions scale 2–3×. Lint ranges are per category.                                                                                                                 |
| R20 | The director ignores the motion rules or the storyboard                                                                                | Med          | Med                  | Motion tokens are enforced in the primitives, not just requested; motion lint plus 2 repair rounds; fallback to the baseline edit.                                                                                                             |

---

## 15. Open questions

1. Is `capture_config` (recording, screenshots) enabled on our TinyFish account? It's account-gated and affects FR-49.
2. Does TinyFish CDP allow `Browser.newContext` (spike S1)? What are the practical concurrency limits on Browser sessions for the fallback recorder?
3. Does a profile setup session started for an existing profile load its saved state? If yes, re-auth refresh for the recorder becomes trivial.
4. Is custom `max_steps` available on our key? It's beta-gated, so until that's confirmed use `max_duration_seconds` plus worker-side step budgets and omit `max_steps`.
5. Which default voices (EN/HI) do we ship, and are we cleared to use them in public demo videos? Library voices need a paid ElevenLabs plan, which we can't buy for now (no UPI), so jobs use the premade Bella (EN) and Brian (HI) on the free plan. The Hindi needs a native listener's rating (spike S5).
6. Hackathon rules: is pre-event preparation (spikes, primitives library) allowed? This affects phase scheduling.
7. Will TinyFish offer a browser region nearer India (for example Mumbai), or server-side recording for Browser API sessions? Either would let the Browser API record at full quality from here. Ask the sponsor team.
8. Does `country_code: "IN"` actually exit through an Indian IP?
9. The house editing rules from the team (how Remotion should cut, zoom and pace by default) are still to come. They go into `DIRECTOR.md` as hard rules and into the baseline EDL, so they hold even when the director doesn't run.

---

## 16. Roadmap beyond the hackathon

- **Recorder next to TinyFish:** deploy the recorder in San Jose (Fly.io `sjc` or AWS `us-west-1`) so TinyFish Browser API sessions record at full frame rate again, at cloud scale and in parallel. The `timeline.json` format doesn't change.
- **More languages** (Tamil, Bengali, Spanish…) as configuration only. The pipeline already fans out per language.
- **Prospect-tailored sales demos:** CRM field in → focus prompt → per-prospect video, batched.
- **Docs integration:** auto-embed tutorial clips into Mintlify/Docusaurus pages, refreshed on release.
- **Cloud rendering:** Remotion Lambda / a worker pool. Multi-tenant SaaS with team workspaces.
- **Interactive demos:** export the same `timeline.json` as a clickable HTML walkthrough (Arcade/Storylane style).
- **Voice cloning** of the founder (with consent) for an authentic launch VO.
- **A/B hooks:** generate three different first-3-second hooks for social and track performance.

---

## Appendix A: Glossary

- **Flow:** a short user journey that demonstrates value (e.g. "create a project from a template").
- **Semantic target:** a description of a UI element by what a human sees (text, role, label), not by CSS selector.
- **Take:** one complete, clean recording attempt of a flow.
- **Dead interval:** recorded time with no meaningful visual change (locator resolution, network waits) that the editor may cut.
- **EDL:** Edit Decision List. A JSON description of the edit that Remotion renders.
- **Virtual camera:** an animated crop window over the source footage, used for both zoom and reframing.
- **Variant:** one output video = (aspect × language × form factor).

## Appendix B: References

- TinyFish docs index: https://docs.tinyfish.ai/llms.txt
- Agent API reference: https://docs.tinyfish.ai/agent-api/reference
- Browser API reference: https://docs.tinyfish.ai/browser-api/reference
- Fetch API reference: https://docs.tinyfish.ai/fetch-api/reference
- Browser Context Profiles: https://docs.tinyfish.ai/key-concepts/browser-context-profiles
- Vault credentials: https://docs.tinyfish.ai/key-concepts/credentials
- Runs (steps, screenshots, video_url): https://docs.tinyfish.ai/key-concepts/runs
- Live browser preview: https://docs.tinyfish.ai/live-preview
- TinyFish cookbook: https://github.com/tinyfish-io/tinyfish-cookbook
- Remotion: https://www.remotion.dev/docs · ElevenLabs TTS with timestamps: https://elevenlabs.io/docs
- Claude Code headless mode: https://docs.claude.com/en/docs/claude-code/headless · opencode CLI: https://opencode.ai/docs/cli · Codex CLI: https://github.com/openai/codex
