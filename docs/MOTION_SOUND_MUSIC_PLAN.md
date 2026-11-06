# Implementation plan: sound engine, music-led launches, motion primitives

Written 2026-11-06 against `hyperframes` at `2a1d18e`. It implements `docs/LAUNCH_FILM_TEARDOWN.md` §6
and `docs/ARCHITECTURE_REVIEW.md` §3.2–3.4. TinyFish and the explore pipeline stay as they are; nothing
here depends on replacing them. DOM snapshots (review §3.1) are also out of scope, and are only
needed by a later tier of primitives.

Estimates assume one person who knows the code. Two people can run Phases 2 and 3 in parallel.

## 1. What the code does today

These findings come from reading the code and inspecting `job_mvn8okfx618eb0` (Linear). They change
what needs building.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| The "pumping" is the ducking | Trailer music is −6 dB and ducks a further 13 dB (`MUSIC_LEVEL`, `packages/video/src/music.ts`). The Linear render swings between 0.50 and 0.11 gain around all 7 voice lines (`compile.ts`). | A few lines fix this. |
| Tracks aren't level-matched | Enter the Party measures −19.8 LUFS and Electrodoodle −9.2 LUFS, which also clips (+1.1 dBTP). Both get the same fixed gain. | Normalise per track. |
| Final loudness is single-pass | `loudnorm` runs once, dynamically (`hyperframes/render.ts`). Our renders measured −15.0 and −17.8 against a −14 target. Dynamic mode also flattens a designed arc. | Use two-pass linear loudnorm. |
| The beat grid is stored but unused | `bpm` is never read when placing anything. `firstBeat` only sets where the track starts playing. Part lengths come from footage and voice (`planParts`). | Music-led timing is new work. |
| Music always starts at the track's opening | `data-media-start` is `firstBeat`. Enter the Party peaks at 168 s, so a 30 s film only ever hears its first 30 s. | Enter at a strong bar and splice an ending. |
| Sound effects exist but cover few events | The Linear render has 16 cues against 23 detected visual events: 7 whoosh, 5 click, 2 pop, 1 riser, 1 hit. Typing, callouts, camera moves and montage clips have none. | Extend the cue sources; the placement code is sound. |
| All effects are synthesised, one take each | `sound.ts` builds them with `aevalsrc`. The HyperFrames sound guide warns against both synthesised tones and repeating one take. | Needs a real sound pack with variations. |
| Beat, section and hit analysis already exists | `hyperframes audio --only beats,downbeats,bpm,sections,moments,loudness --quality local` worked on both tracks, locally. | Don't write an analyser. Don't use `--quality best`, which uploads audio. |
| The beat tracker needs supervision | Enter the Party's beats jitter around 0.5 s (…5.535, 6.025, 6.415…). Electrodoodle's downbeats report `confidence: low`. | Regularise to a constant-tempo grid and respect confidence. |
| `agentcast music add` doesn't exist | `packages/cli/src/index.ts` is 2 lines, though AGENTS.md documents the command. | Build it (Phase 2). |
| Voice-off already works | `voiceover: false` skips the voice stage; the script becomes captions. The default is `true`. | Change the default; suppress the captions. |
| The element is too small to feature from footage | Source is 2880×1800, sharp up to about 1.5× zoom, soft by 2.5×. A 56 px button at 2.5× is about 10% of frame width. A component ≥ 290 CSS px can reach 50%. | Feature components from footage; small buttons need sprites. |
| Footage is thin | The longest recording in the saved jobs is 17 s. Most are clicks and scrolls; typing is rare. | Films will be shorter, and this plan can't fix content (§8). |

## 2. Order of work

```
Phase 0 bench (1 day)
   └─ Phase 1 sound + mix (3–4 days)             ships on its own, helps every video
        └─ Milestone A: hand-built 20 s film     go/no-go on the whole direction (1–2 days)
             ├─ Phase 2 music-led launch (5–7 days)
             └─ Phase 3 motion primitives (8–12 days)
                  └─ Milestone B: compiler output, director off, passes the targets
```

Sound comes first because it needs no schema change and improves voice-led guides too. Music and
primitives come next, together: cutting flat page footage on the beat is still flat, and primitives
timed from a voice line still feel like a walkthrough.

**About 3.5–5 weeks in total for one person, about 2.5–3 for two.**

## Status

- **Phase 0: done.** `pnpm --filter @agentcast/spikes bench --tag <name>`, in `spikes/s9-bench/`.
- **Phase 1: built, not signed off.** Loudness, true peak and falls pass on the bench (`spikes/RESULTS.md`, S9). Sync is
  still 1.1–1.3× chance against a 2× target. The sound pack is empty, so effects are still the synthesised fallback,
  and nobody has listened to the result yet.

- **Checkpoint A: passed.** The hand-built film got the go-ahead (`pnpm --filter @agentcast/spikes checkpoint`, `spikes/RESULTS.md` S10).
- **Phases 2 and 3: built.** See `spikes/RESULTS.md`, S12, for what was verified and what's still open.

## 3. Phase 0: an edit bench

No tasks here spend TinyFish or ElevenLabs quota.

1. Extend `spikes/kaustav-hyperframes/render-job.ts` (`pnpm --filter @agentcast/spikes hf`) with a
   `--rebuild` flag that recomputes the baseline edit from a job's saved artifacts, with the director off.
2. Fix three fixture jobs:
   - `job_mvmno3l73a2772`: Linear, 17 s, 12 clicks
   - `job_mvmoy4njdfc2fa`: shadcn, 3 flows with scrolls
   - `job_mvmek99sacc3eb`: Linear, 6 s, includes typing
3. A script runs `spikes/s8-teardown/analyze.py` and `av.py` on all three and prints the §7 table.
   That table is the before-and-after for every phase. Porting it into `measure.ts` can wait.

## 4. Phase 1: sound engine and mix

Mostly `packages/video`, with no EDL change.

**Mix**
1. **Automation as a pure function:** move the music automation out of `compile.ts` into
   `musicAutomation()` in `audio.ts`, with unit tests.
2. **Ducking:** `duckDb` −13 → −6, attack 150 ms, release 500 ms, and hold across gaps under 1.5 s.
3. **Level matching:** add `lufs` and `truePeak` to `MusicTrack`, and compute gain to a target bed
   level instead of a fixed −6 dB.
4. **Final loudness:** measure, then one gain plus a limiter, corrected until the limited mix is on
   target (−14 LUFS, ≤ −1 dBTP). `loudnorm`'s linear mode isn't used because it silently falls back to
   dynamic when headroom runs out.
5. **Arc:** gain automation that starts 10 dB down, plateaus by 50–75% of the film, and fades on the
   end card.

**Cues**
6. **New cue sources in `sfxCues`:**

   | Event | Sound | Rule |
   | --- | --- | --- |
   | Typing | soft key tick | one per word, not per character |
   | Callout, stat or chip landing | pop | on landing |
   | Camera move | whoosh | large moves only |
   | Montage clip | pop | on each clip's arrival; repeated low hits would turn to mud |
   | Riser and impact | riser into hit | once per film, on the payoff or logo; the title gets a pop instead |

7. **Timing:** place each cue's peak one frame after its picture, using each file's measured peak
   rather than the hand-set `PEAK` table.
8. **Restraint:** per-kind minimum gaps and a per-film cap, with every cue tied to something visible.
9. **Levels:** set hits 3–6 dB over the bed, replacing the fixed `LEVEL` table. Keep them lower under
   a voice.

**Sound pack**
10. Three takes per kind in `assets/sfx/`, chosen by cue index so renders stay deterministic.
    `sound.ts` remains the fallback when the pack isn't installed. The source is decision 2 in §9.

**Done when** the §7 audio targets pass on the fixtures and a person has listened to them. I can
measure audio but not hear it, so that sign-off has to be human.

## 5. Milestone A: prove it before building it

Hand-write one 20 s film for the Linear fixture. Use the `scene` segment kind, which already exists:
3–4 "label card → cropped proof" modules, on the Enter the Party grid, entering at a strong bar, with
the Phase 1 sound and no voice.

Compare it with the current render, side by side, on the §7 numbers and by eye. If it doesn't look clearly
better, stop and rethink before writing the schema and compiler work. The scene files then become the
first primitives.

## 6. Phase 2: music-led launch mode

**Library** (`packages/cli`, `assets/music`)
1. Implement `agentcast music add` and `music analyze`. They run `hyperframes audio` once, parse its
   JSON with zod, and store the result. Renders never run the analyser.
2. `MusicLibrary` schema v2 adds: `lufs`, `truePeak`, a regularised grid (`bpm`, `firstBeat`,
   `confidence`), `sections`, and `entries` (strong bars to start from).
3. Low-confidence tracks are excluded from rapid-fire edits. Their boundaries would have to follow
   sections and hits rather than beats.

**Music plan** (`packages/video/src/musicplan.ts`, pure)
4. `planMusic(track, bars)` picks an entry bar and splices to the film's length on bar lines, using
   the track's real ending where possible. It returns spans, the film's grid and the hit times.
5. Written to `render/music-plan.json`, with a zod schema and registry entry (rule 3).
6. The worker premixes it to `render/audio/music.m4a` with ffmpeg, so the composition still has one
   music element and all languages share it.

**Timing** (`packages/video`)
7. `fitToGrid(edl, plan)`, pure:
   - Allocates each part a whole number of bars from what its footage can support, using trim and
     ramps. **Music length follows the film, and a short film stays short**: no freezing to fill time.
   - Sets part lengths so reveals land on the grid, allowing for transition overlap. `planParts`
     doesn't change.
   - Uses bars and strong hits as the targets, not every beat. Lovable, Arc and Dia cut at chance
     against the beat; only rapid-fire films like Raycast Pro lock tightly.
8. The director can change segments, so the worker snaps its edit back to the grid before the final
   check, the same pattern as `restoreFixed`, and warns if anything moved more than a beat.

**Pipeline**
9. `stages/direct.ts`: pick the track and plan the music before building the baseline; today this
   happens after.
10. `JobConfig`: `voiceover` defaults to `mode === "tutorial"`. Job state v4 keeps saved values as
    they are. Update the composer default in `apps/web/src/lib/compose.ts`.
11. Add `style.timing: "voice" | "music"`. An explicit voice-over on a launch stays on today's voice-led path.
    Blending voice with the grid can come later.

**Story** (`packages/story`)
12. A no-voice prompt path: one short label plus one proof per feature, 1–4 words on a card, about
    0.6–1.2 words/s over the film. Lift the 3-headline limit to 6 here.
13. `Script.segments[].text` stays empty without a schema change, and the word-budget checks are skipped.
14. Captions off in music mode, since the type is the narration. Hindi becomes a text-only
    re-typeset, sharing the music plan.

**UI** (`apps/web`)
15. Gate 2 shows on-screen copy instead of narration when there's no voice, and any "timed to its own
    voiceover" copy gets corrected.

**Done when** a launch job with no flags gives a no-voice film whose parts land within 1 frame of the
grid, and which passes the §7 pacing and loudness targets.

## 7. Targets

Measured on the three fixtures with `spikes/s8-teardown`.

| Metric | Linear render today | Target (rapid-fire) | Phase |
| --- | --- | --- | --- |
| Music automation swing, unit-tested | 13 dB | ≤ 6 dB | 1 |
| Largest loudness fall between neighbouring 2 s windows, before the outro | up to 10 dB | ≤ 5 dB | 1 |
| Integrated loudness | −15.0 LUFS | −14 ± 1 LUFS | 1 |
| True peak | not checked | ≤ −1 dBTP | 1 |
| UI events on audio onsets | 0.17 (chance 0.16) | ≥ 2× chance | 1, 3 |
| Parts landing on the grid | none by design | within 1 frame | 2 |
| Scene changes per 10 s | 1.4 | 3–8 | 2, 3 |
| Still time, end card excluded | 16% | ≤ 5% | 2, 3 |
| Featured subject when it acts | about 5% of frame width | ≥ 15% | 3 |
| Repeated primitive back to back | n/a | never | 3 |

Rises aren't limited: a rise is the music building or a voice coming in, and Framer's voiced film also moves 7 dB.

The chance-level sync metric is noisy on short films. Checkpoint A placed a sound on every designed event by hand and still scored only
1.2× chance, so the 2× row is a poor target: use it to catch regressions, and don't tune to it. Scene changes per 10 s also undercounts on dark,
monochrome brands, because cuts between dark frames barely change the colour histogram (the checkpoint measures 1.0 and has about 7.5 by count).
Both need a better measure before they gate anything.

## 8. Phase 3: motion primitives

**Contract** (`packages/shared`, `packages/director`)
1. EDL v7, additive: a `primitive` segment with `primitive`, typed `params`, `seconds`,
   `transitionIn`, optional `sfx`. Accept versions 5–7 on read, emit 7, and update PRD §10 (rule 3).
2. Remove the legacy Remotion path first (decision 3 in §9). Otherwise every primitive needs a second implementation.

**Registry** (`packages/video/src/primitives/<name>.ts`)
3. Each primitive exports:
   - `needs`: footage, element map or sprite
   - `minSeconds` and `idealSeconds`
   - `vars(segment, input)`: pure, unit-tested
   - `scene(id, size, vars)`: the HTML and GSAP scene
   - `cues(segment, part)`: its sound
   - `moments(segment, part)`: frames for the director's still review
4. `compile.ts`, `sfxCues`, `stillMoments` and `remap.ts` each get one generic `primitive` branch that
   calls the registry. New helpers go in `runtime.js` as `AC.*` and follow the scene contract: no
   clocks, randomness or network.

**Build order: by what each one needs from the recorder**

| Tier | Needs | Primitives |
| --- | --- | --- |
| 0 | Text, brand, footage | `labelCard`, `colourWorld`, `endCard`, `wordSwap`, `rolodex`, `lineToPill`, `irisWipe`, `glyphWipe`, `tiltedGlide` |
| 1 | Footage + existing bboxes | `macroComponent`, `focusPull`, `promptPullBack` |
| 2 | Element map (new, cheap) | `staggerRows`, `wireframeBuild`, `dataTicker` |
| 3 | Sprites (new) | `liftAndPress` on small controls |
| Later | DOM snapshots | `countUp` on real UI numbers, `drawPath` on real charts |

5. **Recorder additions for tiers 2 and 3:** at each settled step, write the visible
   component tree's boxes, roles and text to `record/layers/<flow>.json`. Add a sprite pass afterwards.
   Capturing during the take risks disturbing the screencast, so spike that first, including whether
   CDP `captureScreenshot`'s `clip.scale` gives a sharper re-raster. Sprites of signed-in
   apps follow the same hygiene and redaction rules as footage (rule 5).
6. **No invented content:** primitives show script copy and real captured UI. `dataTicker` uses real
   terms from the product. Never fabricate a number.

**Template compiler** (`packages/video/src/baseline.ts`)
7. A `rapidFire` template: a 4–6 s kinetic opener, then one `labelCard → proof` module per flow, then
   `endCard`. A `oneTake` template follows for products with a single hero interaction.
8. Variety rules: never the same primitive twice in a row, no single treatment past about 6 s,
   choices seeded by job id. `look.ts` maps brand to colour worlds.

**Director** (`packages/director`)
9. Generate `guides/primitives.md` from the registry. The director chooses and tunes primitives and
   writes free scenes only as an exception.
10. Lint additions: subject size, no repeats, on-grid, and a primitive's `needs` being available.

**Testing each primitive**
- Unit tests on `vars`
- `hyperframes check` at 16:9 and 9:16, at 540p and 1080p
- The same frame rendered twice must be identical
- A contact sheet for human review

**Done when (Milestone B)** the compiler alone, with `AGENTCAST_DIRECTOR=off`, passes §7 on all three
fixtures, and 540p render time hasn't more than doubled. Duplicate `<video>` elements in crop
primitives are the likely cost to watch.

## 9. Decisions needed

1. **Music for production.** Two tracks means every video sounds alike, one is unusable for rapid-fire,
   and both require a CC BY credit in customers' videos. Development can use what's there, but launching needs about 20–30
   commercially cleared tracks from a licensed catalogue, or generated ones. **Recommendation:**
   a licensed catalogue, checked for redistribution inside customer videos.
2. **Sound effects.** A licensed pack, or a one-off generated set reviewed by ear and committed.
   **Recommendation:** a licensed pack; it's the quickest way to something a person has actually approved.
3. **Delete the Remotion path?** **Recommendation:** yes, in its own PR before EDL v7. HyperFrames is
   already the default, and Remotion would otherwise need every primitive built twice.
4. **Voice off by default for launches.** This plan assumes yes, since you asked for music-led
   launches. Voice remains a toggle.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Thin footage: nothing here makes a marketing page more interesting | Short films instead of held frames; Tier 0 and type carry more. Better flows come from the explore work, later. |
| Audio can only be measured by tooling, not judged | Human listening sign-off at Phase 1, Milestone A and Milestone B |
| Beat-locked edits feel mechanical | Target bars and hits, not every beat; variety rules; review at Milestone A |
| `hyperframes audio` output changes between versions | Analyse once at library time, validate with zod, store the result; the version is pinned |
| Crop primitives slow rendering | Measure at each tier on the bench; keep the 2× budget |
