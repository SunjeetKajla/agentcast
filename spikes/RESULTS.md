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

## S8: launch film teardown (2026-10-28)

Question: what makes the best SaaS launch films feel designed, and how far is our output from them?
We measured 17 official launch films (Raycast, Lovable, Linear, v0, Notion, Framer, Attio, Superhuman, Arc, Dia,
Cursor, LangEase, and a Linear concept film) and two of our renders with ffmpeg/ffprobe (`spikes/s8-teardown/`),
and read each one frame by frame.

- 12 of 16 product films have no voice-over; music and on-screen type carry them.
- They use one of two grammars: rapid-fire (4–8 scene changes per 10 s, ≤ 3% still time) or a one-take glide
  over rebuilt UI. Ours sits between them: 1.4–2.7 changes per 10 s with 16–35% still time.
- In the best films, UI events land on sound effects at 2–3× chance. Ours land at chance.
- Their music builds to a plateau at 50–75% of the film. Ours swings ±10 dB every 2 s because of voice ducking.
- Their subject fills 30–90% of the frame width. Our acted element is about 0.1–0.2% of the frame.

Outcome: proposals in `docs/LAUNCH_FILM_TEARDOWN.md` §6 and `docs/ARCHITECTURE_REVIEW.md` §3. These include
UI captured as layers, motion primitives, music-led launch mode, a sound engine bound to the timeline, and a film lint.
They are not adopted yet, so the PRD is unchanged.

## S9: edit bench and the new mix (2026-11-06)

Question: does the Phase 1 sound work fix the mix on real jobs? `pnpm --filter @agentcast/spikes bench` rebuilds three saved jobs' baseline edits on
copies, with the director off and no provider quota, renders at 540p and measures them. Same edits, old and new mix:

| Job | LUFS | True peak | Largest fall | UI events on onsets (chance) | Cues | Render |
| --- | --- | --- | --- | --- | --- | --- |
| Linear, 17 s footage, voice | −15.0 → −14.2 | −1.1 → −2.3 | 3 → 4 dB | 0.12 (0.16) → 0.17 (0.15) | 20 → 27 | 42 → 51 s |
| shadcn, 3 flows, voice | −14.7 → −14.1 | −1.5 → −2.0 | 7 → 5 dB | 0.26 (0.16) → 0.30 (0.23) | 13 → 19 | 49 → 54 s |
| Linear, typing, no voice | −14.8 → −14.4 | −1.7 → −1.7 | 10 → 1 dB | 0.10 (0.16) → 0.30 (0.24) | 11 → 16 | 34 → 30 s |

- Loudness and true peak pass on all three. The old single-pass `loudnorm` was hiding the music's ±13 dB ducking on these renders, so falls understate
  what changed under a voice; the music's automation is now limited to 6 dB and unit-tested.
- A diagnostic showed cues were too quiet at first (a 50 ms level compared with a 400 ms target). Measuring takes over 400 ms fixed the levels by
  construction, but the onset detector still finds only some cues under music, so it can't confirm audibility. That needs a person listening.
- Sync misses the 2× target. Many visual events are footage changes with no cause to sound on: camera starts, and the page reacting about 0.5 s after a click.
  Adding a sound to each would mean two per interaction. Expect this to move with primitives, whose visual events are designed around their cues.

Outcome: `docs/MOTION_SOUND_MUSIC_PLAN.md` Phase 1 is built. It still needs a listening check and a real sound pack; effects are the synthesised fallback.

## S10: Checkpoint A, a hand-built launch film (2026-11-06)

Question: does the proposed direction (music-led, no voice, label → proof modules, UI animated in parts) look clearly better than today's output, before
we build schema and compiler work for it? `pnpm --filter @agentcast/spikes checkpoint` builds one 20 s film from `job_mvn8okfx618eb0`'s real recording,
with hand-written scenes, hand-measured positions and hand-placed sounds. It uses no schema or compiler changes.

| Measure | Current render (director) | Checkpoint |
| --- | --- | --- |
| Length | 29.5 s | 20.0 s |
| Loudness over 2 s windows | −1 −10 −4 −11 −2 −13 −1 −7 −6 −4 −6 −12 0 −7 −13 | −7 −7 −5 −5 0 −1 −1 −3 −3 −14 |
| LUFS / true peak | −15.0 / −0.8 | −14.2 / −1.1 |
| Still time before the end card | 1.6 s (2 runs) | none |
| Scene changes, by count | about 8 | about 15 |
| Featured subject, share of frame width | about 5% | 50–75% |
| Audio onsets on the beat grid (first 16 s) | not designed for it | 59% (chance 16%) |
| UI events on audio onsets (chance) | 0.17 (0.16) | 0.25 (0.21) |

- What worked by eye: type on the beat, the panel lifted out with a highlight hopping down its rows, the roadmap building a column per eighth note, one
  card popping out to the middle, the white inversion at the midpoint, and footage that stays sharp at this scale because the recording is 2880×1800.
- It needed true near-black ground for a dark brand: the default backdrop's grey exposed the footage's edges as rectangles. Dim captures needed a brightness lift.
- The automated pacing and sync metrics both misjudge it (see `docs/MOTION_SOUND_MUSIC_PLAN.md` §7).
- Not proven: nobody has listened yet, including to the music's join from the 16 s mark to the track's real ending. Footage is still marketing-page content, and all
  positions are hand-measured, which Phase 3's element map has to replace.

## S12: music-led films through the real worker (2026-11-07)

Question: do Phases 2 and 3 produce a good film with nothing placed by hand? `pnpm --filter @agentcast/spikes e2e --home <dir> --job <id>` runs Linear through the worker with
real LLM copy and a live recording, and no TinyFish or ElevenLabs quota.

- **Result:** the job finished at 18.0 s and −14.1 LUFS in both formats, with copy, moves and music chosen automatically. Frames of both formats look right.
- **Short film:** the third shot ("Progress, always in view") passed script review and was then dropped for too little on screen, against a 30 s target. See `docs/REFERENCE_WORKFLOW.md`.
- **Director:** it used its full 8 minutes and produced nothing, so the film is the template's edit. `docs/REFERENCE_WORKFLOW.md` proposes replacing this pass.
- **Bug found and fixed:** the worker's 1080p render came out with tiny shots in the top-left corner. Each recompile rewrites `compiled.json`, and a failed director turn restored the scene
  files but not that list, so the compiler's old 540p files read as the director's and were reused. `runDirector` now restores both, and a primitive's file is always made for the variant's size.
  Regression tests cover both changes, and both fail with the fix taken out.
- **Replay of the fix:** on a copy of the job, a fake director recompiled a changed edit and timed out, then `renderVideo` ran at 1080p with the scene folder. No scene read as the director's. The 16:9 film
  matches the corrected render (SSIM 0.9999). Renders took 24 s (16:9) and 21 s (9:16).
- **Second brand (shadcn):** `bench --jobs job_mvmoy4njdfc2fa --led --rerecord --height 1080` passed the stall check on an idle machine, so the earlier failure was load. Both formats came out at 18.0 s, −14.1 LUFS and
  −1.7 dBFS true peak, and rendered in 22 s each. The light theme, column build and logo work. The bench films only the first flow and reuses the job's older copy, so this tests the moves and not the new copy writer or the film's length.
- **Weak spots on shadcn:** the second proof shows the whole Components page, against the guide's "a piece of the page" rule, so its text is small, and in 9:16 unreadable. In 9:16 the build shows only 2 columns, then holds for about 3 s
  (40% still, against 0% in 16:9). In 16:9 the build also finishes early and only drifts for its last 2 s or so.
- **Not proven:** the fix hasn't had a full run through the worker's render stage. Effects are still the synthesised fallback, and only one track has a dependable grid. `sharpLogo` hasn't run on a real job, so the logo is the old low-res capture.

## S13: skeletons from the reference library (2026-11-08)

Question: does a skeleton change a film enough to tell films apart, before a library is worth building on?
`pnpm --filter @agentcast/spikes bench --led --skeleton <id>` cut three real recordings with each of the four
skeletons in `assets/references/` at 1080p: Linear (`job_e2eled0001`), shadcn (`job_mvmoy4njdfc2fa`) and Sarvam
signed in (`job_mw6o12r65ef81c`). That's 12 films in `spikes/output/bench/sk-<skeleton>/`. All master to −14 LUFS and
render in 29–53 s.

| Skeleton | Lengths (Linear, shadcn, Sarvam) | Cuts per 10 s, counted from the edit | What it looks like |
| --- | --- | --- | --- |
| `modules` | 18, 18, 18 s | about 3 | The old shape, with the framing fixes. |
| `rapid` | 14, 12.5, 12.5 s | about 5–6 | Clearly faster: half-beat labels, two angles per shot, frequent inversions. Short, because these recordings give only two usable shots and the 4 s end card is 30% of the film. |
| `glide` | 26, 20, 20 s | about 1 | Clearly different: no labels between proofs. On Sarvam, one take travels from the hero to the Rail helpline player, the pricing and the playground. On Linear the third take is a mostly black marketing page, which is weak content. |
| `type-led` | 20, 20, 20 s | about 2 | Clearly different: big lines on alternating light and dark grounds, the product answering each. The lines hold still for 2–3 s once built, which feels slow. |

- **Telling them apart:** yes. Side by side, the four cuts of one recording read as four different films, where before every brand had the same shape.
- **Auto pick:** Linear and shadcn read as boards and got `rapid`. Sarvam has typing and got `glide`.
- **Bug found and fixed:** Sarvam's recording has a lower pixel density (1.33), so the sharpness limit made its typing close-up a 660×298 px window, zoomed out instead of in. Regions are now widened until their window fills the frame, and the close-up is always closer than the view it pulls back to. Re-rendered and checked: a full-size close-up of the Tamil typing that pulls back to the panel.
- **The automated metrics still misjudge these films:**
  - **Scene changes:** the colour-histogram detector misses cuts between near-white cards.
  - **Sync:** `rapid` scores at or below chance (0.08–0.11 against 0.15–0.26), even though its cues come from each move's own timing. The likely cause is that its cuts come faster than the effect gaps and per-second budget let sounds through. Not investigated yet.
- **Not proven:**
  - **Listening:** nobody has listened.
  - **Variety:** the music is still the one usable track for every film.
  - **Rapid length:** it needs more shots or angles to reach 20 s.
  - **Type-led motion:** its type needs motion after it lands (swaps, a push).

## S14: Checkpoint B, hand-built brand motion (2026-11-08)

Question: do brand moves (logo, wall of pages, rising cards, a lifted panel, a hand cursor, a mockup) make a film
look like the references, before building capture and art direction for them (`docs/BRAND_MOTION_PLAN.md` §9)?

`pnpm --filter @agentcast/spikes brand-capture` captures the layers:

- **Logo:** linear.app's logo as an SVG, cleaned to shapes only, with colours resolved.
- **Logo parts:** the mark found as the shapes left of the widest gap. The six letters of the wordmark, which is a single
  path, found from ink-free columns in a render.
- **Pages:** 14 of linear.app's own pages as viewport captures.
- **Board:** read from the recording at 8.0 s.

`brand-checkpoint` builds a 24 s film from `job_e2eled0001`'s recording with hand-written scenes and hand-placed
sound. It renders in about 50 s at 1080p, −14.2 LUFS, −0.6 dBTP.

| Time | Scene | Result by eye |
| --- | --- | --- |
| 0–4 s | Mark sweeps in on a bloom of light, then the wordmark slides out from behind it | Clean once the wordmark moved as one strip. Moving each letter separately made later letters cross earlier ones. |
| 4–8 s | Wall of 25 tiles (14 pages) on a tilted plane, columns sliding against each other, diving into one | Reads as the Lovable wall. Linear's pages are dark, so the tiles are dim. |
| 8–12 s | Match cut into the footage; hand cursor clicks "Projects" on the beat; the panel lifts out on its own layer over the dimmed page, and the hand runs down the rows with the highlight | The cut is seamless once the target tile is the recording's own frame. With a page capture, the headline jumped. The hand reads as a hand at about 3% of the frame width. |
| 12–13 s | Label on white, letters landing in a wave | Works. 170 px nearly touched the edges, so it's 150 px. |
| 13–16 s | The board cut into 15 cards rising column by column; the hand clicks one card and it lifts to the middle | Works. |
| 16–20 s | A laptop we draw turns into view on the strong bar, then the camera zooms through its screen | Works, but plain: dark screen content and a flat base. |
| 20–24 s | The mark as soft light sharpens into the mark, the wordmark comes out, the address pill rises | Works. |

Still open:

- **Not verified:**
  - Nobody has listened.
  - The 540p render is wrong, because the scenes are written in 1080p pixels.
- **Not tried yet:**
  - The mascot and product-logo moves, which need a brand that has them.
  - Art direction, which this checkpoint doesn't exercise.
- **Hand-drawn assets:** the hand cursor is a first drawing and could be refined.

## S15: Checkpoint C, brand motion for a different product (2026-11-08)

Question: does a different kind of product get a clearly different film from the same toolkit, as art direction
(`docs/BRAND_MOTION_PLAN.md` §7) would choose it?

- **Product:** Sarvam, a voice AI product.
- **Look:** light, with brand colour in its hero's orbs. The captured palette was monochrome.
- **Logo:** a vector wordmark only.
- **Recording:** `job_mw6o12r65ef81c` at 1920×1200 (1.33×). The text-to-speech playground: a Tamil line typed, then
  Generate, then the cURL and Python tabs.

`pnpm --filter @agentcast/spikes brand-capture-sarvam` captures:

- **Logo:** the header logo, kept as an SVG (an `<img>` of an .svg, fetched and cleaned).
- **Letters:** five units from a 4× render. "v" and "a" touch, so they're one.
- **Hero:** the hero at 2×, for the orbs.

`brand-sarvam` renders 24 s in about 45 s at 1080p, −14.1 LUFS, −1.8 dBTP.

| Time | Scene | Result by eye |
| --- | --- | --- |
| 0–4 s | Orbs cut from the hero float in on the eighth notes, the big one rising like a sun; "Built in India." then "For India." | Works. Multiply blending hides the white around each orb on the paper ground. |
| 4–8 s | A line opens into a white pill inside a ring of the orbs' colours; the recorded Tamil line types in; a "தமிழ் · Tamil" chip; the hand presses "Generate with Bulbul V4", which turns into a spinner; the pill folds back into a line | Works after three fixes. A rotated blurred rectangle made a diagonal smear, so it's now a ring whose colours flow along it. Splitting at "!" typed one word. Flex layout dropped the spaces between graphemes. |
| 8–12 s | The real playground as a window: the line finishes typing, the hand presses the real Generate, and the real player arrives | Works. Footage at 1.33× limits the window to about 1.62× its CSS size. |
| 12–16 s | "Don't take our word for it. Listen." (the site's own line); the hand presses the big orb's play button; a Bulbul V4 sample plays for 3.5 s while a waveform of its real audio lights up in the brand's colours, the music ducked | Works. In the speech band, the voice section is −12.4 LUFS against −19 to −22 for the music around it. The orb's capture ends 82% of the way down, so it sits low enough that the cut is off frame. |
| 16–20 s | The real cURL card lifted out of the page slides in, tilted, beside "Bulbul V4" and `bulbul:v4-flash`, with the product's terms on a ticker | Works. The card is small, because of the footage density. |
| 20–24 s | The wordmark's letters rise out of their own masks (it has no mark to lead with), the orbs come back, then the call to action and the address | Works. |

- **The voice isn't the typed line.** Generating it again in a fresh automated browser was refused (a 403 from
  the playground's session check, "Could not verify your browser"), and we don't work around that. So the film plays
  a sample the page itself publishes (`deck-classroom-tamil.mp3`), labelled "Bulbul V4 · Tamil" in the film. **Correction
  (2026-11-08): the excerpt is English, not Tamil.** It was picked by its file name and never heard, so the film's tag was
  wrong. It
  isn't presented as the typed line read aloud. Real capture should keep the output inside the recording session,
  which got the audio when it clicked Generate.
- **Different from Checkpoint B (Linear)?** Yes, by eye:

  | | Linear | Sarvam |
  | --- | --- | --- |
  | Ground | Dark | Paper |
  | Brand world | A grey bloom | Colour orbs |
  | Logo | Mark lockup | Rising letters |
  | Opener | Page wall | Glow pill |
  | Proof | Board cards | Waveform |

  Both use the same toolkit: the hand cursor, lifted footage windows and the ticker.
- **Not verified:** nobody has listened; the music is still the one track; and the hand-drawn hand is a first
  drawing.

## S16: art direction on saved jobs (2026-11-08)

Question: does art direction, from the product type (A) and what was captured (B), give different films through the
real compiler, not hand-built scenes?

`pnpm --filter @agentcast/spikes bench --tag art --jobs job_e2eled0001,job_mw6o12r65ef81c --height 1080 --led --art` runs
the script stage's chain on job copies with the rules table (no LLM):

1. logo parts and a keyed cut-out from `brief/logo.png`
2. layers cut from the recording
3. the inventory
4. `rulesDirection` and `checkDirection`
5. the edit

Results:

- **Linear:**
  - **Call:** `project-tool`, rapid-fire, lockup, hand, bloom, built around cards, panel and build. Nothing changed by
    the check.
  - **Film:** 14 s.
  - **Logo:** the end card's mark lands alone, then slides aside as the wordmark comes out from behind it.
  - **Cursor:** the hand glides to "Initiatives", the row the recording clicked, and presses with a ring.
  - **Layers:** 24 cut from the recording.
- **Sarvam:**
  - **Call:** `voice-audio`, type-led, letters, hand, plain (its captured accent is grey, so no colour field), built
    around the typing.
  - **Film:** 20 s.
  - **Logo:** the end card's five letter parts rise one after another.

Bugs found and fixed on the way:

- **Logo background:** taken as the commonest colour, it was the letters on Sarvam's peach gradient, so the whole
  logo read as one span. It's now the median of the border.
- **Seams:** pieces covering only their own ink left seams; they now tile the logo.
- **Peach plate:** the old capture's plate showed, so the end card now uses the cut-out (or the vector).
- **"field" on a grey accent** read as smudges; it now needs a colourful brand.
- **Rapid-fire's 1.5 s proofs** held a click too early to glide to. A panel proof now starts just before the click
  that opened it when the direction wants a cursor.

Not verified:

- **The director's own turn:** not run on these jobs; unit tests cover its check and fallback.
- **The understand stage's new capture** isn't verified through a worker job. Its browser step was run live on its own
  (`recorderAdapter().inspect`):
  - **linear.app:** the inline SVG kept clean (3,083 chars), read as mark+wordmark with 6 letters, plus 9 page
    captures, in 29 s.
  - **sarvam.ai:** the `<img>` .svg kept clean (2,955 chars), read as a wordmark with 5 parts, plus 9 page captures, in
    18 s.
  - That time overlaps the product brief's LLM work, which runs in parallel.
  - Linear's page list includes /contact and /docs, which the skip list could exclude.
- **Listening:** nobody has listened.

## S17: brand moves through the compiler (2026-11-08)

`bench --tag art2 --led --art` on job copies, with art direction by the rules table (no LLM):

- **Linear:**
  - **Call:** `project-tool`, rapid-fire, opens on its logo, lockup, hand, bloom, built around wall, cards and panel.
    The copy's `brief/captures/` holds the 14 page captures from Checkpoint B.
  - **Film, 18 s:**
    1. The mark lands, the name slides out from behind it, then the line.
    2. A wall of linear.app's pages slides on a tilted plane and dives into the home page.
    3. The panel, with the hand pressing "Initiatives".
    4. The board.
    5. The lockup end card.
- **Sarvam:**
  - **Call:** `voice-audio`, type-led, letters, hand, plain, built around glow pill and output.
  - **Output material, demo only:** the recording predates the output watcher. So on the copy only, Sarvam's
    published sample (`deck-classroom-tamil.mp3`) stands in as the playground's output. **Correction:** the excerpt
    is English, not Tamil, so it doesn't match the typed line; it was picked by name and never heard.
  - **Film, 25.5 s:**
    1. The opener.
    2. A pill types the recorded Tamil line's first sentence; the hand presses send.
    3. A solid ink disc is pressed, and the sample plays for 4.5 s while its waveform lights bar by bar and the music
       ducks.
    4. The ticker.
    5. The end card's letters.

Bugs found and fixed:

- **Grey brands:** a near-black accent made the pill's "light" a dark smear and the output's disc grey. A grey brand now
  gets a soft ring of its ink and a solid ink disc.
- **Lit bars never lit:** GSAP can't tween to a CSS variable, so they're switched by class.
- **Output length:** it ran 7 s, now capped at 4.5 s.
- **Pill typing:** a long line was still typing when the hand pressed send. Typing now fits the time before the press,
  and a long value types its first sentence.
- **Logo cloud on Linear:** captured live, with six logos (OpenAI, Vercel, Figma, Cursor, Coinbase, Ramp). Tight crops
  made keying eat the white letters. Captures now have a margin, and keying is skipped when the border isn't one even
  colour. The orbit's tiles use the brand's surface colour.

Not verified:

- **Not seen in a render:** the mockup and the orbit. Unit tests cover both through the compiler.
- **Not through a real worker job:** the output watcher. Its JSON-audio parsing is unit-tested.
- **The director's own art-direction turn.**
- **Listening:** nobody has listened.

## S18: the pipeline's Sarvam film against the hand-built one (2026-11-08)

**Question.** After S17 the pipeline's Sarvam film had generic moves on a plain ground, next to the hand-built
film's orbs, glow pill and coloured waveform. Can the pipeline get there on its own, built the way a new job would
be?

**Run.** `bench --tag art8 --jobs job_mw6o12r65ef81c --height 1080 --led --art --live-kit --director`: sarvam.ai
inspected live in local Chrome (the brand kit as understand builds it), brand imagery from the pages and the
recording, the director's art direction call with shot calls (one fast-tier turn), the film planned by
`planLedFilm`. Output: `spikes/output/bench/art8/job_mw6o12r65ef81c/job_mw6o12r65ef81c.mp4`, 23.5 s, rendered in 34 s.

**What it made.** Director: voice-audio, `glide`, world `imagery`, opener `logo`, featured glow-pill, output,
prompt; shot calls with headlines "Voices that sound Indian" (from the script) and "Type Tamil, hear Tamil" (from the
script). The film: the wordmark revealing with three of Sarvam's orbs floating in; "Built in India. For India.";
the TTS page in a tilted window opening on the whole page and gliding in, the orbs around it; the glow pill typing
"வணக்கம்! நான் உங்கள் உதவியாளர்." under chips "தமிழ் · Tamil" and "Shubh · Conversational", the hand pressing
"Generate with Bulbul V4"; the output on the maroon orb with a waveform in the orbs' colours; the orbs ringing the
end card.

**Imagery.** The home page has no orbs (its hero is an orange and blue glow); they're on the TTS page, so the
recording frames find them. Of the five, the big magenta one carries the site's play button (dropped) and the amber
one is bitten by it (dropped). Objects are found at 960 px and cut at full size, with the mask's edge blurred.

**Voice.** The stand-in output is Sarvam's published sample `deck-classroom-tamil.mp3` (the TTS playground blocks
automated browsers, so no real output could be recorded). Transcribed with ElevenLabs Scribe it is Tamil, but
code-mixed: its first 4.5 s, which the earlier films played, are "Okay class கொஞ்சம் silence please. அர்ஜுன் it's
actually a very good question", mostly English words. The bench copy now plays 5.30–9.45 s, "இப்போ பாரு ஒரு
rectangle ஓட length எட்டு centimeters". It still isn't what the pill typed; a recorded output would be.

**Still behind the hand-built film.** No "Listen." beat from the site's own line, no ticker of terms, no code card;
the orbs are larger and one (orange) keeps a sliver of its neighbour's ring; on a cut an orb can pass over the middle
of the frame. The cookie banner shows in the proofs because this recording predates the consent hiding.

