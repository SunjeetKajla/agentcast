# Flow reference comparison

Reference reviewed: `/home/neeraj/Projects/AgentCast/packages/recorder/src/`.
The reference repository is read-only during this work. Its `flow.test.ts`,
`drive.test.ts`, `flow/{compile,locate,expect,bridge,timeline}.ts`, Live preparation
and MiniBoard fixture were compared with the current recorder.

The APIs differ: the reference rehearses a page into an action scene and later
records that scene with `SceneDriver`. Here `recordFlow(flow, options)` (alias
`compileFlow`) executes and verifies the flow while recording a Live take. Tests
are adapted to behavior and shared artifacts instead of copying incompatible
scene/selector interfaces. The MiniBoard fixture is copied into
`src/flow/test/miniboard.ts`; tests do not depend on the sibling checkout.

## Gaps reproduced and fixed

The baseline passed 208 tests, but the initial reference-derived run failed
seven of its 17 checks. Those failures exposed:

1. Unnamed semantic controls could not resolve. Bare whitelisted roles now use
   the same visibility, ambiguity and proximity checks, and a restricted
   `getByRole("checkbox")` cache grammar.
2. An absent `near` hint prevented safe normal disambiguation. Missing hints now
   fall through; existing hints that tie still fail.
3. A scroll step picked a visible copy instead of the next below-fold copy.
   Below-fold scroll targets now take precedence after explicit nearby context.
4. Identical unnamed nodes/custom checked states were invisible to meaningful
   change detection. Semantic node counts and checked/selected/expanded/pressed
   states now participate, while timers/spinners remain excluded.
5. A nested container's scroll was not a meaningful outcome. Container scroll
   offsets now participate, in addition to the document scroll. Targeted scroll
   actions also refresh their timeline bbox after bringing the target into view.
6. URL checks allowed `*` to cross path segments and omitted hash-router routes
   and shorter generated hex IDs. `*` now matches one segment; `**` spans
   segments. Hash routes survive learning, query values are omitted, 12+ hex
   IDs generalize, and regex punctuation is literal. Matching uses an NFA to
   avoid executable regex patterns or exponential wildcard backtracking.
7. Delayed first controls consumed recording time. When the initial step has a
   target, resolution/healing runs before capture, with no persistent learning;
   the target is revalidated during capture. Preparation lookup failures share
   the same three-take limit. Stale targets resolve again during capture.

## Reference test inventory

Every test from the reference flow/driver suites is accounted for here. Rows
marked “separate feature” do not claim reference parity and are not hidden behind
skipped tests. All applicable behavior runs in current tests.

| Reference test                                                | Current coverage / difference                                                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added identical list items and state changes                  | `reference.integration.test.ts`: unnamed nodes, custom checked state, unchanged state rejection                                                                                  |
| Candidate priority, including unnamed checkbox                | Existing `locate.integration.test.ts`; bare role + proximity + safe cache round trip in reference ports                                                                          |
| Generated IDs, `*`/`**`, hash routes                          | `outcome.test.ts`: reference patterns, query omission, segment bounds, trailing slash and hash route checks                                                                      |
| MiniBoard resolves, learns and paces all steps                | Four-step real Live recording, semantic strategies, learned dialog/value/URL, timeline order and cursor timing                                                                   |
| Learns heading/route without declared checks                  | MiniBoard reference port checks both learned heading and URL                                                                                                                     |
| Cached replay                                                 | Second fresh-browser MiniBoard recording reuses the plan and learned checks; existing resolver cache tests verify cache method                                                   |
| Create opens Upgrade instead of expected route                | MiniBoard rejects step s4; no preceding step learning or partial artifacts survive                                                                                               |
| Missing locator invokes healing                               | Shared LLM JSON interface with fake response; one call, verified `llm` cache entry                                                                                               |
| Compiled take records and maps timeline                       | Direct Live API produces validated video/Timeline; typing focus click is represented by the type event rather than an additional click event                                     |
| Live discards wrong outcome                                   | MiniBoard wrong-outcome port plus existing three-take learned-expectation regression                                                                                             |
| Delayed first control before capture                          | MiniBoard delayed-control port asserts first cursor time and source duration; optional pre-scene dismissal actions are a separate feature                                        |
| Click visible copy / scroll below-fold copy                   | Reference port checks both on one page with duplicate links                                                                                                                      |
| Main-content same-link preference; distinct links ambiguous   | Existing locator tests and absent-near reference port                                                                                                                            |
| Missing prerequisite click + typing beside mislabelled button | **Separate feature:** `findGapClick`, `findBridge`, nearest-field repair. Current resolver rejects incompatible typing targets; it does not guess prerequisite actions or fields |
| Fuzzy symbols and late/missing elements                       | Existing real-browser locator tests, including one deterministic budget and priority-preserving late-target regression                                                           |
| Absent nearby hint and equivalent/distinct links              | Reference port verifies main-content resolution and ambiguity for different destinations                                                                                         |
| Nested-scroll input coordinates and key chords                | Reference port exercises real mouse coordinates inside the clipped container and `Control+k`                                                                                     |
| Encode/join relative paths with spaces/apostrophes            | Reference port validates MP4 recording through a relative path with spaces/apostrophes. **Separate feature:** concatenating multiple subclips                                    |
| Driver glides, clicks, types and presses keys in order        | Existing paced input test, reference nested-input test and MiniBoard timeline assertions                                                                                         |
| Driver typing cadence                                         | Existing real keyboard/input-event timing test verifies jitter cadence; fixed scene CPS scheduling is not this API                                                               |
| Driver event times, bboxes and redacted secrets               | Existing secret/artifact tests plus reference timeline bbox and cursor-end/action-time assertions                                                                                |
| Driver missing target failure                                 | Existing missing/hidden/disabled/incompatible/ambiguous locator regressions                                                                                                      |
| Driver optional dismissal and desktop double-click            | **Separate feature:** optional scene steps and automatic double-click replay are not supported by the current shared Step contract/compiler                                      |
| Scene helper scroll schedule                                  | **Separate feature:** no precompiled SceneDriver schedule here. Current eased real wheel scrolling has real-browser stall/outcome coverage                                       |
| Scene helper motion-window range                              | **Separate feature:** no Studio scene schedule. Current Live action/finite-animation windows have direct stall coverage                                                          |

The current implementation also checks cancellation, cleanup, three-take limits,
secret/PII hygiene, screenshot/prompt redaction, safe cache parsing, competing
cache writes, strict input/select outcomes and stronger learned expectations.
It never weakens a failed strong outcome into a generic change check.

## Run the checks

Validation results: all 223 tests across 20 files passed with real Chromium,
GPU and NVENC required, with no skipped tests. Workspace typechecks, recorder
formatting and `git diff --check` passed. The flow suites include 92 checks;
14 are reference-derived browser scenarios, including pre-capture retry and
cancellation regressions. The final scroll-bbox correction is also verified
by rerunning the reference browser scenarios.

```sh
AGENTCAST_TEST_CHROMIUM=/usr/bin/google-chrome pnpm test packages/recorder/src/flow --no-file-parallelism
AGENTCAST_TEST_CHROMIUM=/usr/bin/google-chrome AGENTCAST_REQUIRE_GPU=1 AGENTCAST_REQUIRE_NVENC=1 pnpm test --no-file-parallelism
pnpm typecheck
```

Browser tests require an installed Chromium binary; the strict hardware run
requires the GPUs/encoder and is serialized because those tests share devices.
LLM tests use fake CLIs or schema-checked fake responses, spending no provider
quota. The current worker/CLI recording stubs, multi-flow joining, automatic
prerequisite repair, optional scene steps and visible cursor renderer remain
separate work; the test report does not imply those features were integrated.
