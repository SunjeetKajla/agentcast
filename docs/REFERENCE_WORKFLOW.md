# Reference films, beat sheets and scene-by-scene refinement

A proposal, written 2026-11-07. Nothing here is built. It starts from a creator's description of how they
made a launch film: gather pacing references, choose the music, write a timestamped beat sheet, generate a
first draft, then refine one scene at a time before the final render. It covers whether AgentCast should
work the same way, whether the genjutsu skill would help, and whether we should drop our frameworks.

## Status (2026-11-08)

| Part | State |
| --- | --- |
| Reference library | **Built.** Four skeletons in `assets/references/` (`modules`, `rapid`, `glide`, `type-led`), chosen by product shape and seeded by site. The 12-film comparison is in `spikes/RESULTS.md` S13. |
| Beat sheet | **Built.** `script/beat-sheet.json`, written by the script stage before review and rewritten for the final edit. Not yet shown in `apps/web` at script review. |
| Scene refinement | **Built in the worker.** A preview revision with `scene` or `at` is limited to one part, with a 4-minute turn. No single-scene render is needed: a full re-render takes about 22 s. Not yet in `apps/web` (a "change this part" control on the player). |
| genjutsu | **Borrowed.** The copy lint (`copyIssues`) runs in the script writer's repair round. Use `cast` for `apps/web` work, not `paint`. |
| Frameworks | **Unchanged**, as decided below. |
| Competitor text, user-attached references | Not started. |

The doc below is the reasoning, written before the build.

## Decisions at a glance

| Question | Recommendation |
| --- | --- |
| Curated reference library | Yes, as structured skeletons. Test by hand first. |
| Finding reference videos on the fly | No. |
| A reference the user attaches | Yes, later. |
| Reading competitors' sites as text | Yes, cheap. |
| Beat sheet, with music chosen first | Yes. This matters more than the references. |
| Scene-by-scene refinement | Yes, in place of the director's whole-film pass. Needs a spike. |
| genjutsu for film code | No, apart from two ideas. |
| genjutsu for `apps/web` | Yes, `cast` only. |
| Removing HyperFrames or GSAP | No. |

## How the workflow compares to ours

| Their step | AgentCast today | Gap |
| --- | --- | --- |
| Music first | The track is picked in the direct stage, after the script is approved | The music sets the lengths but not the writing |
| Beat sheet with timestamps | None. The storyboard has no times, and the edit is compiled later | The film's structure can't be reviewed before it's built |
| References for pacing | Used once, to design the primitives (`docs/LAUNCH_FILM_TEARDOWN.md`) | Each film comes from the same fixed preference order (`optionsFor` in `packages/video/src/template.ts`) |
| Refine scene by scene | The director reworks the whole film | Its one real music-led run took its full 8 minutes and produced nothing |

The 18 s Linear film shows the cost of the missing beat sheet. "Progress, always in view" reached the
script stage, then the direct stage dropped it because that part of the recording had too little on screen.
Content is measured (`shotContent`) only after the script gate, so a person can approve a line that later
disappears.

## Reference library

**Why it's worth having: variety.** The 17 films in the teardown range from 0 to 7.7 scene changes per 10 s
and split into distinct grammars. Our template makes one shape, so a customer's fifth film will look like
their first.

**What an entry holds.** A skeleton, never footage:

- grammar (rapid-fire or one take), with scene changes per 10 s and median scene length
- moves bar by bar, in terms of our primitives
- type density and how many words each card carries
- loudness arc and where the break falls
- the product shapes it suits: board, chat, editor, dashboard
- a note of the film it was learned from, for our own reference

**What already exists.** `spikes/s8-teardown/metrics/` has measurements for all 17 films. The shot-by-shot
labels still need doing, by a person or a vision model.

**What it can't cover.** At least 5 of the 17 depend on abstract 3D, archival footage or live action: the
Linear concept film, Arc 1.0, Raycast for Windows, Cursor 3 and Dia. Moves we can't make go on a backlog for
new primitives instead of into a skeleton.

**Size and selection.** Start with 6–8 skeletons. Rules on product shape and brand energy, or one LLM choice
from the list, are enough. Vector search isn't justified at this size.

**Copying.** Blend ideas and never follow one film move for move. Keep the films themselves out of the repo
and the product, as we do now.

## Reference sources

| Source | Verdict | Why |
| --- | --- | --- |
| Curated library | Yes | Chosen for taste, instant, and free to use at run time |
| User attaches a film | Yes, later | This is what the creator actually did. An upload needs no scraping, and the `s8` scripts are a starting point. It has to report which moves we can't make. |
| Competitor sites, as text | Yes | Shows what everyone in the category already says, so the copy can avoid it. A search and a fetch, with no video work |
| Auto-found related videos | No | See below |

Finding related videos automatically fails on four counts:

- **Time.** It adds minutes to a timeline we're trying to shorten.
- **Terms.** Downloading breaks YouTube's terms, which is a much bigger problem in a product than in one-off
  research.
- **Reliability.** Cloud IPs are often blocked.
- **Signal.** Being in the same category doesn't make a film good, and it pushes customers to look like
  their competitors. Product shape predicts a good structure better than category does.

## Beat sheet

A new artifact, made before the script gate and reviewed in its place:

1. Record, as now.
2. Pick the track and measure what each candidate shot shows on screen.
3. Choose a skeleton.
4. Write the beat sheet: a one-sentence thesis, then per beat its bars and timestamps, its copy, its move and
   the recording's content behind it.
5. The person reviews this. Copy is written for slots that are known to exist.

Changes this implies:

- `pickTrack` and `shotContent` move earlier than `gate-script`.
- A shot with too little on screen is replaced or removed before review, never after.
- The artifact needs a zod schema, an entry in PRD §10 and a change to `StoryboardReview`.
- Voiced tutorials can keep today's order. Only music-led films need this.

## Scene-by-scene refinement

Replace the director's whole-film pass on music-led films with revisions scoped to one scene:

- The compiled film stands by default, so a slow or failed agent run costs nothing.
- At the preview gate, a person (or an optional agent pass) picks a scene and says what to change.
- The agent gets that scene's data and a short time limit. Only that scene is reworked and re-rendered.
- If a revision fails its checks, the previous version of the scene stays.

**Open question.** `compileComposition` builds a whole film, and re-rendering a single scene is untested. It
needs a spike that renders one scene and joins it back into the film without visible or audible seams.

**Licence check.** GSAP's standard licence allows commercial use and AI-generated code, but prohibits use in
no-code visual animation builders that compete with Webflow. Prompt-based revisions fit that. If this grows
into a visual timeline editor, get the licence reviewed first.

## Should we use genjutsu?

genjutsu is a set of agent skills for interface motion and art direction: `cast` for animating what exists,
`paint` for a whole visual identity, `bunshin` for a whole site built by a team of agents.

**Not for film code, because its rules assume a live interface:**

- A 500 ms limit and "the more often it plays, the subtler it should be" describe UI used daily. A launch
  film plays once.
- Reduced-motion handling and jank rules mostly don't apply to frames rendered offline into a video file.
- Our teardown has measured numbers for launch films, which are more specific than its general UI timings.
- It waits for a person's approval and runs long. Its site records 45 turns and $1.88 for one `cast` run.
  That doesn't belong in a worker whose director already times out.

**Use it for `apps/web` and the landing page,** through `cast`. Avoid `paint`, since `DESIGN.md` is already
the agreed look.

**Two ideas to borrow (MIT licensed, so keep the credit if text is copied):**

1. **A thesis approved before building.** One sentence at the top of the beat sheet.
2. **Its four checks, as a film lint:**
   - Invented information: does this come from the product or the recording?
   - Decorative filler: does this carry information, or only texture?
   - Reflex convergence: did the idea call for this choice, or did habit?
   - Hollow copy: is this true of this product and no other?

   "Build with momentum" and "Get started with Linear" from the Linear film would both fail the last check.

## Should we drop the frameworks?

| Layer | Decision | Why |
| --- | --- | --- |
| Renderer (HyperFrames) | Keep, behind one interface | Frame-accurate seeking, parallel capture and audio mixing are hard to get right and aren't what makes a film good. It's pre-1.0, so stay pinned. |
| Animation (GSAP) | Keep | The right fit for scenes in plain HTML and CSS. Rewriting timelines and staggers wouldn't improve a frame. |
| React or similar | Stay without | Scenes are already plain HTML, and removing Remotion was the right call. |

**The more useful question is hand-written scenes versus primitives.** The hand-built checkpoint film set the
ceiling, and the primitives give a reliable floor. Use primitives by default and let the agent write one
custom hero moment per film, with a time limit and a fallback to a primitive if it fails. Primitive files hold
one canvas's pixels and are rebuilt for each size (PRD §9.7.5), so a hero moment has to be a `scene` segment
sized in `--ac-u` units.

## Order of work

1. **Hand-test skeletons.** Write 3 and film the same Linear recording with each. If none clearly beats
   today's template, don't build the library. Roughly a day, with no schema changes.
2. **Beat sheet, with music first.** This fixes dropped shots whatever happens with the library.
3. **Scene revisions,** after the single-scene render spike. This removes the director's full pass.
4. **Library of 6–8 skeletons,** if step 1 passes.
5. **Competitor text pass and film lint.** Small, and can go in at any point.
6. **User-attached references,** if the library proves its value.

## What would change this

- **Licensed music:** with only one track that has a dependable grid, every film shares a tempo and feel,
  which limits how much variety skeletons alone can add. A real catalogue raises the library's value.
- **Blind test:** if viewers can't tell skeleton-driven films from the template's, stop at the beat sheet.
