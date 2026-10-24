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
