# Brand motion: logos, layers, motion graphics and art direction

Written 2026-11-08. The gap between our films and the reference films is now less about pacing and more about
motion graphics:

- the logo animating
- walls of pages
- cards rising
- sliding UI and mockups
- mascots and product logos
- a hand cursor that clicks

This doc covers why we can't make these today, how each becomes possible, and how the director decides which
design suits which product. It starts with a hand-built checkpoint (§9). Nothing in §3–§8 is built yet.

Related:

- `docs/LAUNCH_FILM_TEARDOWN.md`: the measured reference films.
- `docs/REFERENCE_WORKFLOW.md`: skeletons and the beat sheet.
- `docs/MOTION_SOUND_MUSIC_PLAN.md`: the motion primitives.

## 1. What the reference films do that we don't

Each was stepped through at 3–6 fps (Lovable 2.0, Superhuman, Notion Mail, Raycast 2026, Linear for Agents, Attio).

| Move | Where | What happens | Ours |
| --- | --- | --- | --- |
| Lockup reveal | Lovable 8 s and 76 s; Superhuman's end | The mark lands first; the wordmark slides out from behind it, letter by letter, blurring in | A static PNG fades in |
| Logo morph | Lovable 8–9 s, 75–76 s | A heart shape becomes the real mark | None |
| Logo as light | Lovable 73–76 s | The closing gradient glow is shaped like the mark, then sharpens into it | None |
| Logo as shape and transition | Lovable 0–3 s | A field of brand dots; one dot zooms in and becomes an icon inline in a sentence ("Less than 1% (icon) of the world") | None |
| Mascot | Notion Mail 0–3 s | The paper plane flies a curve through the headline and turns into the cursor | None |
| Product logos | Superhuman | Icons orbit a person, each becomes a section's header, then they line up and merge into the wordmark | None |
| Wall of sites | Lovable 19–21 s | A dozen real pages tiled on a tilted plane, sliding; the camera lands on one | None |
| Device mockup | Lovable 21–23 s | That page drops into a laptop, which turns in 3D | None |
| Glow pill | Lovable 23–26 s | A black pill grows from a line inside a glowing brand ring and types the prompt | Our close-up uses the footage |
| Cards and panels moving | Lovable, Notion, Linear for Agents | Cards rise from below, panels slide from their edge, a dock slides up, rows check off in a wave | Only a tilted window and a column build |
| Hand cursor | Lovable 37–46 s, Notion | A big pointing hand glides, hovers, presses ("Invite", "Publish", "Edit") with the button reacting | None in music-led films |
| Animated type | Lovable | Gradient-filled words, letters bouncing on a wave, braces sliding in to wrap a line, a gradient caret | Blur-in words only |
| Brand world | Lovable, Superhuman | The gradient field blooms up from the bottom on a cut, with grain; each section gets its own colour world | Plain ground |

## 2. Why we can't do it today

1. **The logo is a picture.** `packages/explore/src/logo.ts` finds the logo, often an inline SVG, and screenshots it into
   `brief/logo.png`. It drops the vector on purpose, because site markup is untrusted. A PNG can fade, scale and
   blur. It can't draw on, split into mark and wordmark, morph, mask, or reveal letter by letter. Of the 11 brands
   saved in our jobs, 4 had an inline SVG; the rest were images, touch icons or a CSS sprite.
2. **We keep one recording and a few boxes.** Sliding cards, walls of pages and mockups need the pieces separately.
   You can't make a dashboard animate up from a video of a dashboard.
3. **Our motion vocabulary is six moves joined by hard cuts.** Morphs, zoom-throughs, mascot wipes and hand-offs are
   transitions, and music-led films have none.
4. **One template picks the design.** Even with skeletons, the moves are picked by fixed rules. Nothing decides
   that a voice AI product should look different from a project tracker.

## 3. Layers: capture the pieces, not just video

The recorder has the live page open at every settled moment, and the understand stage visits the site's pages. Both
can capture layers there.

| Layer | How | For |
| --- | --- | --- |
| Element cut-outs | Each box in the element map (cards, panels, rows, components, buttons), captured at 3× with a clipped zoomed screenshot, as `sharpLogo` does, or cropped from the 2× recording | Rising cards, sliding panels, lifts, exploded views, pressed buttons |
| DOM snapshot | The page's HTML at a settled moment, with computed styles inlined, images and fonts copied locally, and scripts, iframes and event handlers removed. HyperFrames renders HTML, so a scene loads it and animates its real children | Rows staggering in, a button pressing, a field typing at any zoom, all vector-sharp. The largest single step |
| Page captures | Viewport screenshots of 6–20 pages: the site's nav and sitemap pages, or each settled state of the app | Wall of sites, page flips, scrolling pages, mockup screens |
| Logo kit | The vector logo, cleaned and split (§4) | Every logo move |
| Glyphs | Inline SVG illustrations and icons from the site, cleaned | Mascots, icon accents |
| Logo cloud | Rows of small, similar-height images or SVGs in an "Integrates with" or "Trusted by" section, found from the page's structure | Orbits, docks, constellations. Third-party marks are opt-in (§10) |
| Product output | What the product makes: generated audio (a voice product), an image, a chart, a deployed page. Kept from the recording session itself, by watching its responses and media elements as the flow runs. A fresh automated session may be refused (Sarvam's playground answers "Could not verify your browser"), and we never work around that. The site's own published samples are the fallback | The product's own output, played or shown in the film |
| Things we draw | Device frames (laptop, phone, browser, tablet) themed to the brand, gradient fields, shapes, an MIT-licensed icon set, the hand and arrow cursors (§6) | Mockups, backgrounds, transitions, cursors |

### The layer list

`render/layers.json` (a new schema) lists every layer with:

- an id and kind (svg, cut-out, snapshot, page, footage crop, audio)
- its source and its box on the page
- its parts (a logo's mark and letters, a list's rows)
- its pixel density, and a quality score

The template, the director and the scenes refer to layers by id.

### Quality check

Render each snapshot and compare it with a real screenshot (SSIM). Below about 0.9 (canvas, WebGL, shadow DOM,
missing fonts), use the cut-out instead. If the cut-out is softer than 1.25× its source pixels, use the footage.

### Safety

- **Untrusted content:** snapshots and SVGs are cleaned to an allowlist and kept local, so the scene contract holds:
  no network, no scripts, local files only.
- **Secrets:** secret fields are blanked in snapshots and cut-outs, as they are in the recording.
- **Real user data:** signed-in apps should use demo workspaces, because a snapshot holds whatever data the page had.

## 4. The brand kit

A brand kit kept per site (`~/.agentcast/brands/<site>/`), reused by every job and editable, instead of being
recaptured each time into `brief/brand.json`.

### Logo sources, best first

1. The person's upload (SVG or PNG).
2. The site's inline SVG, kept this time and cleaned.
3. `favicon.svg`, or an `<img>` whose source is an SVG.
4. The site's brand or press-kit page.
5. The raster logo, traced to a vector. `vtracer` is MIT licensed; avoid `potrace`, which is GPL.

### What the kit holds

- **The cleaned logo.** Only shape elements and gradients survive, with colours resolved to fixed values.
- **The logo's parts:**
  - the mark and the wordmark, split at the largest gap between shape groups
  - each wordmark letter, split at the column gaps
  - The gap split also works on a raster logo, so letter-by-letter reveals work without a vector.
- **The mark's silhouette,** for masks, glows and patterns.
- **The brand's style:** gradient stops, palette, fonts and corner radius.
- **The hero's imagery,** cut out by shape. On a light ground, a multiply blend hides the white around it, so a
  brand world needs no vectors (Sarvam's orbs).
- **Fonts for every script the film shows,** declared and bundled. HyperFrames refuses a family without an
  `@font-face`, and Tamil or Devanagari type needs its own Noto family.
- **Any glyph or mascot,** plus the chosen logo motion.

### The brand kit page (`apps/web`)

- **Logo:** shows the captured parts, and lets the person approve, replace or upload the logo.
- **Style:** set the gradient.
- **Logo motion:** pick from rendered previews.
- **Why presets:** picking from rendered presets keeps us clear of the GSAP licence's clause on visual animation
  builders that compete with Webflow. A free-form timeline editor would not.

### Brand-safety rules, enforced by the scenes

- A multi-colour mark is never recoloured.
- A logo keeps its proportions.
- A morph only goes into the mark's own silhouette.
- A logo never goes below a minimum size.

## 5. Motion vocabulary

### Behaviours in `runtime.js`

Today each primitive hand-writes its GSAP. Instead, behaviours any layer can use:

- **Enter:** rise, slide in from an edge, pop with overshoot, blur in, mask wipe, draw on, assemble from parts, morph.
- **Hold:** float, parallax drift, orbit, marquee scroll, slow push.
- **Exit:** slide out, push, collapse, zoom through.
- **Hand-off:** an element carries from one scene into the next (a match cut or zoom-through). This needs scenes that
  overlap or a layer above both, which music-led films don't have yet.
- **Depth:** CSS 3D (perspective, z-stacking) with a virtual camera that dollies over a set of layers, plus
  HyperFrames' motion blur.
- **Plugins:** GSAP's now-free MotionPath, MorphSVG, Flip and SplitText.

### New moves, by what they need

| Move | Needs | How it moves |
| --- | --- | --- |
| Logo lockup | Logo kit | Mark first, wordmark out from behind it |
| Logo letters | Logo kit (letters) | Glyph by glyph, rising and blurring in |
| Logo draw | Vector logo | Strokes trace, then fill |
| Logo assemble | Vector logo with several parts | Parts fly in and lock |
| Logo morph | Vector mark | From a circle, pill or dot into the mark |
| Mark iris | Mark silhouette | A transition shaped like the mark |
| Mark glow | Mark silhouette | The blurred mark as the background light |
| Inline mark | Logo kit | The mark as a glyph inside a line of type |
| Wall of sites | 6+ page captures | Tiled on a tilted plane; columns scroll in opposite directions; the camera pushes into one, which becomes the next scene |
| Cards rising | A card group (cut-outs or snapshot) | Rise from below with blur and overshoot, staggered in reading order; the shadow grows as each lifts |
| Panel slide | A panel box | Enters from its natural edge (the box says which); rows stagger in |
| Exploded view | Header, sidebar, content and cards boxes | The page separates in depth, then closes up |
| Mockup | A screen (footage, page or snapshot) | A device frame we draw turns into view, then the camera zooms through its screen into full-frame UI |
| Glow pill | A typing event | The input rebuilt as a brand pill in a glowing ring types the real text, then match-cuts to the footage |
| Mascot flight | A glyph (or the mark) | Flies a planned curve over the headline; letters it crosses jolt; it can wipe into the next scene or become the cursor |
| Product orbit | Logo cloud or sidebar icons | Orbit around the mark (staying upright), dock slide, lines drawing on, or flying in to the lockup |
| Output | Product output | A waveform of the product's own audio, played; a generated image developing in; a chart drawing on |
| Spotlight, loupe, callout | Any box | The rest dims and blurs; a magnifier over a detail; an arrow drawing itself on |
| Counter | A number the product states | Rolling up with a line drawing under it. Never an invented number |
| Split, before/after, flip | Two screens | Side by side, a slider, a 3D card flip |

### Brand world

- **Gradient fields** from the palette that bloom on a cut, with grain.
- **One colour world per section** for colourful brands.
- **Grounds by theme:** near-black planes for dark brands, paper and grid for light ones.

### Type

- gradient-filled words
- letter waves
- braces wrapping a line
- word swaps inside the UI's own inputs
- a brand-coloured caret

## 6. The hand cursor

The references use a big, smooth cursor that turns into a pointing hand over anything clickable, presses, and makes
the button react. Lovable's is about 3% of the frame width. Music-led films have no cursor at all; voice-led shots
draw a small one (`.ac-cursor`).

### Drawing it

- Our own SVG arrow and pointing hand: original drawings in a neutral style, not a copy of an operating system's
  cursors.
- A soft shadow, sized about 3–4% of the frame width (larger on 9:16).
- Light or dark to suit the ground.

### Where it goes

The recorder already logs each action's target box and the cursor's journey (`cursor.t0`/`t1`). Each click becomes a
waypoint at the centre of its target, in the move's own time. No cursor positions are ever invented.

### How it moves

- **Path:** it glides on an eased curve, not a straight line, and arrives two or three frames before the action.
- **Hover:** it becomes the hand over a clickable target.
- **Press:**
  - the hand shrinks to 0.9 for about 100 ms
  - a ring ripples from the point
  - the button itself presses and releases (a cut-out or snapshot of the button scales 0.96 to 1)
  - a click sound plays on the press frame (`sfxCues` already does this)
- **Typing:** the cursor hides while a field types, and a caret takes over.

### Where it appears

- in proofs and typing close-ups, over the footage
- over rebuilt UI (glow pill, a "Publish" button)
- crossing between scenes when two moves share a target

## 7. Art direction: the director decides the design

The design should vary by what the product is and what we actually filmed. Linear (a project tracker, dark, a
board, an SVG logo) and Sarvam (a voice AI product, light, a typing field, its output is speech) should not get the
same film.

### Inputs

| Input | From |
| --- | --- |
| **A. Product type** | The product brief and the pages: dev tool, AI or prompt product, voice or audio, design or canvas, project or productivity, data or analytics, commerce, fintech, infra or API, consumer app, marketplace |
| Brand traits | The brand kit: theme, colourful or monochrome, gradient, radius, logo kind (wordmark, mark plus wordmark, mark only), mascot or not; the creative brief's personality |
| **B. What we have** | The layer list and the timeline: typing events, boards, lists, panels, card groups, page captures, vector logo or raster, logo cloud, product output; recording density; signed in or marketing pages; usable seconds per shot |

### Output

`brief/art-direction.json`, a new schema, one per job:

- **Treatment:** a skeleton, a brand world, a logo motion, a cursor style, the transitions allowed, and a type style.
- **Featured moves:** the two or three signature moves this film is built around, plus moves it won't use.
- **Reasons:** a one-line reason for each choice, shown with the beat sheet at script review.

### Who decides

- **The director chooses, in a short `json` turn** (fast tier, schema-checked) with the inputs above. Website text
  stays wrapped as untrusted data.
- **The worker checks the choice:**
  - every move it features must have its layers (no glow pill without a typing event, no wall without 6 pages, no
    morph without a vector mark)
  - its skeleton must suit the recording
  - an unsupported choice is replaced and the reason noted
- **With the director off,** a rules table (below) makes the same call deterministically.
- **Variety:** the site's seed picks between equally good options, so two products of the same type differ, and one
  product keeps its look across jobs.

### Starting tendencies

**B overrides A:** if the layers aren't there, the move isn't either.

| Product type | Leans toward | Because |
| --- | --- | --- |
| Project and productivity | Rapid or modules; cards rising, panel slides, board build; hand cursor on actions | The work is cards, lists and boards |
| AI and prompt products | Glow pill, typing close-up, streamed output, one take | The product is the prompt and its answer |
| Voice and audio | The product's output played, a waveform, type-led around it | A silent film of a voice product misses the point |
| Design and canvas | Wireframe build, exploded view, mockups | The product is a canvas of layers |
| Dev tools and infra | Dark plane, mono type, terminal or code reveal, one take | The look of the tool |
| Data and analytics | Counters and charts from the product's own numbers, spotlight | The payoff is the number |
| Commerce and marketplace | Wall of pages and products, product cards rising, mockups | Breadth of catalogue |
| Consumer apps | Phone mockup, hand cursor as taps, colour worlds | A phone app is seen on a phone |
| Suites and integrations | Product-logo orbit, dock, colour world per product | The story is "everything together" |

**Examples from our jobs:**

- **Linear** (project tool, dark, board, rows and panels, vector logo, 2× recording): rapid or modules, with cards
  rising, a panel slide, a board build, a hand cursor, a wall of linear.app pages and a lockup reveal of the vector
  mark.
- **Sarvam** (voice AI, light, typing field, speech output, raster wordmark, 1.33× recording): type-led around a glow
  pill that types Tamil and plays the generated voice, a waveform, and a letters reveal of the raster wordmark split
  at its gaps.

## Status (2026-11-08)

The checkpoints (§9) are built. Steps 2 and 5 of §8 have started (PRD §9.7.8):

- **Brand kit, by the understand stage:**
  - the logo's vector when the site has one
  - a keyed cut-out for raster logos
  - its kind and the spans of its mark and letters
  - up to eight page captures
- **Layers, by the script stage:** cut from the recording's element map.
- **The inventory.**
- **Art direction:** the director's turn, the rules table and the check. It writes `brief/art-direction.json` before
  script review.
- **The first brand moves the compiler draws:**
  - the end card's lockup and letter reveals
  - the hand cursor on proofs
  - the ground's world

Verified on two saved jobs with `bench --art` (`spikes/RESULTS.md` S16, S17). Since then:

- **Product output:** audio the page fetches while the flow is recorded (`packages/recorder/src/flow/output.ts`,
  `record/outputs.json`).
- **Logo cloud:** captured with a margin and keyed. Used only with `thirdPartyLogos`.
- **Logo motion in the opener.**
- **The moves:** wall of pages, glow pill, laptop mockup, the product's own output (music ducked under it) and the logo
  orbit.
- **Script review:** the design and the beat sheet are shown there (`FilmPlan`).

After comparing the pipeline's Sarvam film with the hand-built one frame by frame (S18), four more:

- **Brand imagery** (`packages/explore/src/imagery.ts`, `kit.ts`): the brand's own objects found in its hero, pages
  and recording frames, split apart where they touch, dropped when clipped, bitten or carrying UI, cut from the
  full-resolution picture; and the brand's colours from them. In the brand kit as `imagery` and `colours`.
- **The imagery world:** those objects float in around the opener, move on every cut and ring the end card; the kit's
  colours light the glow, chips and waveform.
- **Moves in the recording's own words:** the pill's button label and chips (a language in its own script), the
  output's title and an orb as its disc, headlines over proofs. Cookie and consent banners are hidden while
  recording and capturing.
- **Shot calls:** the director crops a shot and gives it a headline, which is kept only if the site or the script
  says it.

Still to do:

- the mascot
- a toggle for `thirdPartyLogos` in the composer (it's settable through the API only)
- a ticker and a site-headline beat in the one-take skeleton (the hand-built film has "Listen." and the terms)
- the imagery world's objects can pass over the middle of the frame on a cut; keep them to the edges

## 8. Order of work

1. **Checkpoint (§9).** Hand-built, no schema work. Judge whether the look lands.
2. **Capture:**
   - element cut-outs and page captures in the recorder and understand stages
   - the logo kit
   - the logo cloud
   - product output where a flow produces one (audio, image)
   - the layer list
3. **Motion behaviours and led-film transitions** in `runtime.js`, including the scene-to-scene hand-off; the hand
   cursor.
4. **Moves, tier 1:** logo moves, cards rising, panel slide, glow pill.
5. **Art direction:** the schema, the director's turn, the worker's check and the rules table; brand slots in the
   skeletons.
6. **Moves, tier 2:** wall of sites, mockups, output, counter. **Tier 3:** mascot, product orbit, exploded view.
7. **DOM snapshots** with the quality check.
8. **The brand kit page** in `apps/web`: approval, uploads, logo motion previews.

## 9. Checkpoint B: a hand-built brand-motion film

Like Checkpoint A (`spikes/s10-checkpoint`), one film is built by hand from a real job's assets, with no schema or
compiler changes, to judge the look before building the system.

- **Product:** Linear. Job `job_e2eled0001` from the end-to-end run: a 2880×1800 recording with the element map. The
  logo is captured live from linear.app as an SVG.
- **Music:** "Enter the Party", 120 BPM: a strong bar in, the track's own ending out, 24 s.
- **Moves:** logo lockup opener on a gradient bloom; wall of linear.app pages pushing into one; cards rising from
  the board; the panel sliding in with rows staggering and the hand cursor pressing; a laptop mockup zooming through
  into full-frame footage; a lockup end card.
- **Assets** are captured by `spikes/s14-brand/capture.ts` and built by `spikes/s14-brand/film.ts`. They're written
  to `spikes/output/brand-checkpoint/`, which isn't committed.

A second checkpoint for a different product type (Sarvam: glow pill, voice output, raster letters) follows if this
one lands, to test that the art direction really changes the film.

**Checkpoint C, Sarvam: built**, to test that a different product gets a different film.

- **Run:** `brand-capture-sarvam`, then `brand-sarvam`, writes `spikes/output/brand-sarvam/brand-sarvam-1080.mp4`.
- **Treatment, chosen as §7 would choose it for a voice AI product with a typing field and a wordmark-only logo:**
  - a light paper ground
  - the hero's orbs as the brand world
  - type-led
  - a glow pill typing the recorded Tamil line
  - the hand pressing Generate
  - the real playground
  - one of the product's own voice samples playing over its waveform, with the music ducked. Its file is named
    `deck-classroom-tamil.mp3`, but the excerpt used is English: it was picked by name, unheard
  - the code card sliding in over a ticker of real product terms
  - the wordmark's letters rising
- **What it taught:** results are in `spikes/RESULTS.md` S15, and the learnings are folded into §3 and §4.

**Status (2026-11-08): built, waiting for a viewing.** `pnpm --filter @agentcast/spikes brand-capture`, then
`brand-checkpoint`, renders `spikes/output/brand-checkpoint/brand-checkpoint-1080.mp4` (24 s, −14.2 LUFS, about 50 s
to render). The results are in `spikes/RESULTS.md`, S14.

## 10. Risks

- **About half of sites won't give a clean vector logo.** Traced logos can look wrong, so the brand kit page needs
  approval before first use.
- **DOM snapshots fail on canvas, WebGL and shadow DOM.** The quality check falls back, but those products get fewer
  of the snapshot moves.
- **Morphs only look good between similar silhouettes.** Each logo motion needs a fallback.
- **Third-party logos** in a logo cloud belong to other companies. Using them is the customer's call, since they
  already show them on their own site. Make it opt-in and never default.
- **The customer's own logo is fine:** they're authorised to demo the site (rule 8). We copy techniques, never another
  film's identity.
- **Photoreal mockups** (Lovable's laptop on a rock) would need three.js with a CC0 model and a video texture. GPU
  frames are less deterministic, so later.
- **Render time** grows with DOM snapshots and 3D. It's about 22 s for an 18 s film at 1080p now; measure it at the
  checkpoint.
- **GSAP licence:** a visual animation editor could fall under the Webflow clause. Presets and prompts are safer.
