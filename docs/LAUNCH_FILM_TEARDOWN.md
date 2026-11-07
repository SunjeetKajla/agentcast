# Launch film teardown

What makes the best SaaS launch films good, measured with ffmpeg/ffprobe and read frame by frame,
and how AgentCast's output compares. Written 2026-10-28. The films are other companies' work and
aren't in the repo; the analysis scripts and per-film metrics are in `spikes/s8-teardown/` so
every number here can be re-measured (and run on our own renders as a lint, see §7).

This extends `packages/director/guides/reference-look.md` (LangEase + Lovable 2.0) to 17 films.

## 1. The corpus

All official uploads, downloaded at 1080p with yt-dlp.

| Film | Length | What it is |
| --- | --- | --- |
| Raycast Pro (preview) | 22 s | Rapid-fire feature list: a label card, then 1–2 s of the feature, ×10 |
| New Raycast. Coming 2026 | 39 s | Macro close-ups of single components on a silk backdrop, mono end list |
| Raycast for Windows | 53 s | Nostalgia brand film (archival footage), product only in the last 8 s |
| Lovable 2.0 | 80 s | Hype kinetic type on gradient fields alternating with lifted UI |
| Linear Agent | 55 s | One continuous take gliding over a tilted, dark, rebuilt UI |
| Linear Releases | 30 s | Abstract data viz: branch lines drawing into releases, mono type |
| Linear for Agents | 33 s | Dark rebuilt UI, list staggers, word-swap card, logo |
| Linear launch film (Bhaskar Visuals) | 26 s | Studio concept film, pure abstract 3D, no product |
| LangEase (Zelios studio) | 33 s | One take, near-white, shapes morphing into UI |
| Arc 1.0 | 34 s | Archival montage + serif words on black, product only at the end |
| Framer | 38 s | The product's own canvas as hero; wireframes building up; huge Publish button |
| Notion Mail | 60 s | Warm white, paper-plane mascot wipes, huge cropped UI components |
| Cursor 3 | 90 s | Founders talking + flat screen inserts |
| Ask Attio | 47 s | Almost all type; word swaps, data ticker, iris to black |
| v0 | 48 s | One take, white; a line becomes the prompt pill; zooms into regions |
| Superhuman | 60 s | Suite film: icon orbit, then one colour world per product |
| Dia | 78 s | Live-action narrative with screen close-ups |

Plus two AgentCast renders for comparison: `ours-linear` (job_mvn8okfx618eb0, linear.app) and
`ours-amazon` (job_mvms09epbaba85).

## 2. The numbers

How each column was measured:

- **Scene changes/10 s:** hard cuts (a colour-histogram jump that stands out from its neighbours)
  plus soft transitions (the frame's colour make-up changing ≥ 45% within 0.5 s: crossfades, blurs,
  morphs, whips).
- **Still %:** time in runs of ≥ 0.5 s where the picture changes < 1 luma level over 0.5 s, so
  slow drift counts as motion.
- **Motion:** mean frame-to-frame luma difference at 96×54 (higher = busier).
- **Luma:** 0–255. **Sat:** 0–1.
- **LUFS / LRA:** EBU R128 integrated loudness and loudness range.
- **Cuts on hit:** share of hard cuts within 1.5 frames of a strong audio transient.
- **UI events on audio onset:** share of visual events (a sharp rise in motion: a pop, a click,
  an element starting to move) within 100 ms of an audio onset.
- **Chance:** the expected rate for randomly placed events, from 300 random shuffles.

| Film | Len s | Scene changes /10 s | Median scene s | Still % | Motion | Luma | Sat | LUFS | LRA | Cuts on hit (chance) | UI events on audio onset (chance) | Voice-over |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| raycast-pro | 22 | **7.7** | **0.95** | 0.0 | 2.6 | 47 | 0.20 | −21.8 | 4.4 | **0.59 (0.12)** | **0.50 (0.26)** | no |
| raycast-2026 | 39 | 1.0 | 8.9 | 35 | 1.4 | 24 | 0.01 | −13.2 | 13.4 | 0.25 (0.05) | 0.23 (0.11) | no |
| raycast-windows | 53 | 5.9 | 1.1 | 19 | 3.3 | 65 | 0.26 | −16.4 | 5.0 | 0.07 (0.09) | 0.11 (0.16) | yes (letter) |
| lovable-2 | 80 | 4.1 | 1.8 | **1.6** | **5.4** | 152 | 0.25 | −11.8 | 6.1 | 0.23 (0.21) | 0.49 (0.42) | no |
| linear-agent | 55 | 0.2 | 27 | 28 | 0.4 | **13** | 0.11 | −28.9 | 11.4 | – | 0.05 (0.06) | no |
| linear-releases | 30 | 0 | 30 | 17 | 0.5 | **10** | 0.00 | −24.7 | 9.2 | – | 0.20 (0.07) | no |
| linear-for-agents | 33 | 0.6 | 5.0 | 48 | 0.4 | 21 | 0.14 | −17.4 | 6.8 | – | 0.20 (0.22) | no |
| linear-concept | 26 | 2.3 | 3.3 | 6 | 3.9 | 98 | 0.02 | −14.8 | 13.0 | 0.25 (0.04) | 0.27 (0.06) | no |
| langease | 33 | 0.6 | 10.4 | 13 | 3.0 | 237 | 0.05 | −13.8 | 6.9 | – | 0.18 (0.23) | no |
| arc-1 | 34 | 5.5 | 1.4 | 3 | 3.7 | 102 | 0.14 | −11.5 | 2.2 | 0.11 (0.11) | 0.15 (0.22) | no |
| framer | 38 | 1.1 | 2.7 | 11 | 3.1 | 20 | 0.20 | −15.7 | 3.1 | – | 0.18 (0.14) | yes, 1.9 words/s |
| notion-mail | 60 | 1.5 | 3.0 | 19 | 1.3 | 237 | 0.03 | −22.1 | 6.3 | 0.11 (0.07) | 0.28 (0.14) | no |
| attio-ask | 47 | 0.9 | 7.3 | 53 | 1.0 | 211 | 0.04 | −12.3 | 11.4 | 0.50 (0.05) | **0.35 (0.11)** | no |
| v0 | 48 | 0.4 | 17 | 44 | 0.7 | 241 | 0.01 | −16.7 | 4.8 | – | 0.25 (0.16) | no |
| superhuman | 60 | 1.8 | 5.0 | 7 | 1.6 | 196 | 0.24 | −11.6 | 9.3 | – | 0.11 (0.08) | no |
| cursor-3 | 90 | 2.4 | 3.5 | 20 | 2.2 | 158 | 0.22 | −27.3 | 7.3 | – | 0.03 (0.05) | yes (founders) |
| dia | 78 | 5.7 | 1.3 | 8 | 4.7 | 88 | 0.33 | −17.8 | 3.4 | 0.11 (0.11) | 0.21 (0.17) | yes (dialogue) |
| **ours-linear** | 30 | 1.4 | 4.2 | 16 | 1.8 | 61 | 0.27 | −15.0 | 4.6 | – | **0.17 (0.16)** | yes |
| **ours-amazon** | 19 | 2.7 | 2.7 | **35** | 2.4 | 219 | 0.06 | −17.8 | 4.4 | – | **0.08 (0.13)** | yes |

Loudness over the film (RMS dB per 2 s, relative to the film's loudest 2 s):

```
v0             -12 -6 -4 -3 -3 -3 -3 -2 -2 -2 -2 -1 -1 -1  0  0  0 -1  0 -1 -2 -3 -14 -36
superhuman     -14 -15 -9 -12 -12 -15 -13 -6 -3 -5 0 -4 -3 -1 -4 -3 -4 -2 -2 -4 -6 -14 -3 -2 -4 0 -4 -3 -7 -8 -20
linear-agents  -13 -11 -10 -10 -4 -1 -2 -3 -3  0 -2 -2 -2 -6 -15 -18 -25
lovable-2      -10 -10 -9 -8 -6 -3 ... -4 -7 [-15 = the 1.2 s break] -1  0 -1  0  0 ... 0 -7 -67
ours-linear     -1 -10 -4 -11 -2 -13 -1 -7 -6 -4 -6 -12  0 -7 -13
ours-amazon      0 -4 -14 -2 -5 -3 -9 -10  0 -24
```

## 3. What the numbers say

1. **There are two winning grammars. We sit in the dead zone between them.**
   - **Rapid-fire / hype** (Raycast Pro, Lovable, Arc, Dia): 4–8 scene changes per 10 s,
     median scene 1–1.8 s, still time ≤ 3% (Raycast Pro 0%), loud (−11.5 to −13.8 LUFS, except
     Raycast Pro).
   - **One-take glide** (Linear Agent, Linear Releases, v0, LangEase, Raycast 2026, Attio):
     0–1 changes per 10 s with a continuously moving camera over a rebuilt UI. These films are
     *allowed* 30–50% holds because the hold is the UI doing something: text typing, an agent
     streaming an answer.
   - **Ours** is 1.4–2.7 changes per 10 s with 16–35% still time. That is too slow to feel like a
     trailer, and we hold on frames where nothing happens, so we don't read as a calm glide either.
2. **Music narrates, type carries the words.** 12 of 16 product films have **no voice-over** (the
   concept film is excluded; YouTube's captions on Lovable, Superhuman and Attio are music
   misheard as "heat"). The four with voice are a tutorial-style film (Framer, 1.9 words/s), a
   letter (Raycast Windows), dialogue (Dia) and founders talking (Cursor). Our launch pipeline is
   voice-first: the voice sets every timing (cards stretch, shots hold). That is the main reason
   the pacing feels like a narrated walkthrough rather than a launch.
3. **Sound is locked to picture, not to the beat grid.**
   - **Cuts:** hard cuts land on strong transients far above chance in Raycast Pro (59% vs 12%),
     Attio (50% vs 5%), Raycast 2026 and the Linear concept film (25% vs 4–5%). Lovable, Arc and
     Dia cut at chance, as the existing guide found: whole-beat cutting is not the trick.
   - **UI events:** pops, clicks and arrivals land on a sound 2–3× above chance in Attio, Notion,
     the Linear films, Raycast and v0. That is designed sound effects: a click on every click, a
     tick per typed word, a whoosh per move, a pop per reveal.
   - **Ours:** at chance (0.17 vs 0.16; 0.08 vs 0.13). Clicks, transitions and headlines do have
     frame-placed cues (`packages/video/src/audio.ts`; 16 in the Linear render). But typing, callouts,
     camera moves and montage clips have none, and a soft click under the voice may not register
     as an onset.
4. **The soundtrack builds; ours pumps.**
   - **Shape:** every reference has an arc. It starts 10–15 dB down, builds steadily to a plateau
     at 50–75% of the film, then a hit or a sting on the logo and a decay to silence in the final
     1–2 s.
   - **Breaks:** Lovable cuts the music for a 1.2 s break (−15 dB) right before the logo reveal.
   - **Ours:** swings ±10 dB every 2 s. That is the voice ducking turning the music down and up
     between lines, which reads as amateur.
5. **The subject fills the frame.**
   - **References:** a single component (prompt pill, button, list, dialog) takes 30–90% of the
     frame width. Lovable's prompt pill is about 2× frame width and cropped. Raycast 2026's search
     bar is cropped by both frame edges. Notion's "Auto label" control is about 40% of the width.
   - **Ours:** the acted element in the Linear render is 56×24 px on a 1440×900 page (0.1% of the
     frame). Our camera's 1.4× zoom leaves it at about 0.2%. The viewer can't see what we clicked.
6. **The UI is rebuilt, not screen-recorded.**
   - **Rebuilt:** Linear Agent, Linear for Agents, Raycast 2026, v0, Notion and Superhuman all show
     vector-sharp UI with no compression mush, no scrollbars, no browser chrome, and only the parts
     that matter. Their elements animate on their own: rows highlight in sequence, results stream
     in, pills grow from lines, cards rise from below.
   - **Screen-recorded:** only the founder/tutorial films (Cursor, parts of Framer) show flat
     recordings.
   - **Why it matters:** you cannot make "the dashboard animate up" from a video of a dashboard.
     You need its parts.
7. **Brightness is a brand decision, held for the whole film.**
   - **Dark:** Linear is near-black throughout (luma 10–21), so its tilted UI reads as light on
     dark.
   - **Light:** v0, LangEase, Notion and Attio are near-white (luma 210–241, saturation ≈ 0.03).
   - **Gradient:** Lovable and Superhuman put saturated brand-gradient worlds behind white UI cards.
   - **Ours:** the Linear render is mid-grey (luma 61) with dim, low-contrast captures. It is
     neither crisp dark nor crisp light.

## 4. The four archetypes

| Archetype | Films | Structure | Fit for AgentCast |
| --- | --- | --- | --- |
| **A. Feature rapid-fire** | Raycast Pro, Superhuman, Linear for Agents, Notion Mail | Repeating module: label card (0.5–1 s) → UI proof (1–3 s), ×N; each feature can get its own colour world; logo end card | **Best.** Each explored flow becomes one module. Fully templatable. |
| **B. One-take product glide** | Linear Agent, v0, Raycast 2026, LangEase, Attio | One continuous camera move over rebuilt UI; zooms into the active component; type appears inside the UI's own inputs | **Good** for a single hero flow (an AI prompt → result). Needs UI-as-layers (§6.1). |
| **C. Hype kinetic** | Lovable 2.0, Arc 1.0 | Huge words, one per beat, on gradient fields, alternating with lifted UI; music break before the logo | Good as the opener (5–8 s) for archetype A or B. |
| **D. Narrative / live action** | Dia, Raycast Windows, Cursor 3 | People, story, archival footage | **Not automatable.** Out of scope. |

Recommendation: a launch video is **C as a 4–6 s opener → A for the features (or B when the product has one
hero interaction) → a logo end card**. A tutorial or guide stays voice-led.

## 5. Signature moves with measured timings

Each was stepped through at 5–10 fps. Each one becomes a primitive in the motion system (§6.2).

| Move | Film | What happens, with timings |
| --- | --- | --- |
| **Prompt close-up → pull-back** | Lovable 23–26 s | Hard cut to the prompt pill at about 3× (only its left half in frame) inside a brand glow. It types at **~27 chars/s** (deliberately faster than a human). Then the camera pulls back 3× → 1× in **0.3 s** (strong ease-out), the cursor clicks send, and the pill collapses horizontally in **0.2 s** into the next scene. |
| **Line → pill birth** | v0 0.8–3.1 s | Logo blurs out (0.5 s). Words fade in grey → black with a **0.15 s** stagger. A 2-px line grows from the centre to full width in **0.1 s**, thickens into a pill in **0.1–0.2 s**, and the text inverts to white. Icons pop in **0.3 s** later. |
| **Wireframe build-up** | Framer 20–26 s | 1-px outlines in the accent colour (~40% alpha) draw the layout, subdivide in 3 steps over ~1 s, and content fades into the boxes in **0.2 s**. This is the "lines opening up" look. |
| **Mascot wipe** | Notion 10–13 s | The brand glyph (paper plane) flies an arc across the headline in **~1.4 s**; letters it passes distort. Then a 0.6 s hold, and the UI card slides up from below the frame in **0.3 s** (decelerating), cropped huge. |
| **Rolodex placeholder** | v0 5–12 s | Example prompts cycle vertically about every **1 s**: current line dark, neighbours at ~30% grey, a slight vertical blur in motion. |
| **Word swap** | Attio 10–28 s; Linear for Agents 23–27 s | Fixed prefix with the noun swapped every **0.7–1 s** ("Every email / call / note", "Agents for Coding / DevOps / Triage / Planning"). App icons sit inline in the sentence. |
| **Data ticker** | Attio 24–28 s | A horizontal rule with tick marks scrolls left; labels ride it ("User record · Stripe payment · Company record · Deal"). |
| **Iris to black** | Attio 5–8 s | A "Thinking…" dot grows to a circle (~30% of the frame) then fills the frame in about **1 s**, switching from the light section to the dark one. |
| **Macro component** | Raycast 2026 0–17 s | One component at 3–5×, cropped by the frame edges, on a soft silk backdrop. Typing happens in it. The emoji grid's selection ring hops cell to cell, one hop per sound. |
| **Staggered rows** | Linear for Agents 2–8 s | List rows get checked one after another (**~50 ms** stagger), then an assign dropdown opens and the status icons update in a wave. |
| **Drawn branches** | Linear Releases 0–22 s | SVG strokes draw along branching paths, with issue-ID labels riding the tips. Mono caps type on with a block cursor ("RELEASES ▌", "AVAILABLE NOW ▌"). |
| **Icon orbit → colour world** | Superhuman 6–50 s | Product icons arc around a cursor glyph; the active icon scales up and becomes the section header. Cut to that product's own gradient world with a white UI card at 40–55% width and a two-line headline above. |
| **Tilted glide** | Linear Agent whole film | The whole UI is a plane at about rotateX 25°, rotateZ −8°. The camera dollies across it and dives toward the active input; the output streams in; the plane re-angles between beats. Dark, low contrast, one light accent. |
| **Label card ↔ proof** | Raycast Pro | Label card ("AI Commands", "Cloud Sync"…) 0.5–1 s on a dark pink blob → floating UI window on the brand wallpaper 1–1.5 s, on the beat. 17 hard cuts in 22 s. |
| **End card** | all | Logo blur-in (**0.4–0.6 s**), then a 2–4 s hold with the URL below in small type. The audio decays to < −35 dB in the final 1–2 s. Lovable inserts a 1.2 s music break right before the logo. |

## 6. What this means for AgentCast

### 6.1 Capture UI as layers, not just pixels (the big one)

You can't animate "the dashboard building up", "buttons popping out" or "lines opening up" from an
MP4 of a page. The recorder has to capture the UI's **structure** as well as the video:

- **Element map per step:**
  - the bounding box, role and text of the acted element, its container and its siblings (list
    rows, cards, chart SVGs, inputs)
  - DPR-3 element screenshots (sprites) of each, for lift, pop, macro and stagger shots
- **DOM snapshot of the key states:** static HTML with inlined CSS, local copies of fonts and
  images, scripts removed, at the moments the storyboard needs.
  - HyperFrames renders HTML, so a scene can load that snapshot and animate its real children:
    - rows rise in with a 40–60 ms stagger
    - numbers count up
    - SVG chart paths draw via stroke-dashoffset
    - borders draw in as wireframes, then fill
    - a button scales 1 → 1.08 with a glow, presses to 0.96
    - a pill grows from a line
  - This gives vector-sharp UI at any zoom: macro shots at 4× stay crisp, unlike a 1080p
    recording.
- **Fidelity guard:** render the snapshot and compare it with a real screenshot (SSIM).
  - Below about 0.9 (canvas, WebGL, shadow DOM, cross-origin fonts), fall back to sprites.
  - If sprites aren't usable either, fall back to the recorded video.
- **Footage still matters** for real motion: typing, streaming answers, page transitions. Use
  layers for reveals and emphasis, footage for proof.

Architecture details and costs are in `docs/ARCHITECTURE_REVIEW.md` §3.

### 6.2 A motion system instead of free-form scenes

Turn §5 into about 20 parameterised primitives the director picks per beat. Names are illustrative:
`labelCard`, `macroComponent`, `promptPullBack`, `lineToPill`, `wireframeBuild`, `staggerRows`,
`countUp`, `drawPath`, `wordSwap`, `rolodex`, `dataTicker`, `irisWipe`, `glyphWipe`, `tiltedGlide`,
`colourWorld`, `liftAndPress`, `focusPull` (blur everything but the component), `endCard`.

- **Every primitive carries:**
  - timings and eases from §5
  - the layer types it needs (sprite or snapshot or footage)
  - its sound-effect cue
  - its minimum subject size
- **The director's job:** choose and order primitives against the music's sections. Free-form
  scenes stay as an escape hatch.

### 6.3 Music-led timing for launches; the voice is optional

- **Launch (trailer) mode:**
  - **Timing:** the music track's beat grid and sections (intro, build, drop, outro) set the beats.
  - **Text:** on-screen type carries the words, 1–4 at a time, about 0.6–1.2 words/s.
  - **Voice:** off by default, available as an option.
- **Guide / tutorial mode:** stays voice-led, as now.
- **This also removes the voice stage from the default launch path** (time and cost, see the
  architecture review).

### 6.4 Sound design bound to events, and a proper mix

- **Sound-effect cues from the timeline, sample-accurate:**
  - every click, keypress (soft ticks, one per word, not per character)
  - every reveal (pop), camera move (whoosh, starting 2–3 frames *before* the move)
  - every card change (hit on the cut)
  - a riser into the logo
- **Target:** visual events landing on audio onsets at ≥ 2× chance (§2).
- **Music arc:** start −10 to −15 dB below peak, build to a plateau by 50–75% of the film,
  optionally a 0.6–1.2 s break before the reveal, then a hit on the logo and a decay to silence.
- **Voice ducking (when there is a voice):** −6 dB with about 150 ms attack and 400–600 ms
  release, held across gaps shorter than 1.5 s so the music never pumps.
- **Loudness:** −14 LUFS for the web; −12 for hype films, matching Lovable, Arc and Superhuman.

### 6.5 Content: the footage has to have something worth animating

The Linear render is 15 s of clicking tabs on linear.app's marketing pages, because the real product
is behind sign-in. The references show the product *doing its job*: a prompt producing a result, a
list being triaged, a design being published. The explore planner should prefer flows that end in a
visible state change, and treat navigation-only tours as filler. Signed-in or demo-seeded workspaces
should be the default for production (architecture review §2.4).

## 7. Film lint (automated taste checks)

`spikes/s8-teardown/analyze.py` and `av.py` measure the table in §2 for any MP4. Run them on every
preview and feed failures back to the director as issues, the same way the motion lint works:

| Check | Trailer target | One-take target |
| --- | --- | --- |
| Scene changes / 10 s | 3–8 | 0.3–1.5, with camera motion ≥ 1.0 mean |
| Still % (≥ 0.5 s runs, end card excluded) | ≤ 5% | ≤ 35%, and each hold has typing or streaming |
| UI events on audio onset | ≥ 2× chance | ≥ 2× chance |
| Loudness | −12 to −14 LUFS | −14 to −18 LUFS |
| Arc | peak 2 s window at 50–80% of the film; no swing > 6 dB between neighbouring 2 s windows before the outro | same |
| Subject size | acted component ≥ 15% of frame width when it acts | same |
| Ending | logo hold 2–4 s, audio < −35 dB relative in the last second | same |
