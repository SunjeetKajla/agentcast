# The reference look

Two launch films set the bar for every trailer AgentCast makes. The files aren't in the repo (they're
someone else's work); this guide is the teardown. Measured with ffmpeg on every frame (motion, stills,
loudness) and read by eye at 1 fps.

- **LangEase** promo by the Zelios studio: 33 s, one continuous take, near-white, one blue family,
  music only.
- **Lovable 2.0** ("Multiplayer vibe coding"): 80 s, 15 hard cuts, brand gradient fields with grain,
  music only.

Build like them. Where this guide and your instinct disagree, this guide wins.

## The rules underneath both

1. **Text is the narrator.** 1–4 words on screen at a time, about 0.9 words a second over the film,
   set huge (110–220 px at 1080p), arriving word by word. One accent word per line in the brand colour
   (LangEase "Turn **Books**", "**Just drop** and go"; Lovable's gradient-filled "Meet", "what", "built").
2. **UI is an object, not a screen.** A single component (a button, a card, a row, a dialog, an input)
   fills 30–60% of the frame, sharp, on the backdrop, with a soft shadow or glow. Full screens appear
   only tilted in 3D, small, moving, or as a backdrop for a lifted component.
3. **Nothing stands still.** 80–94% of frames move. The only hold is the end card (2–4 s). A scene
   that isn't moving its subject drifts its camera (1–3% scale a second), floats, or parallaxes.
4. **Continuity carries the eye.** LangEase never cuts: a ribbon wipes into a progress bar, the bar
   counts 67 → 100, shrinks to a dot, becomes a check, "Done" with confetti, the check becomes a card,
   the card a carousel. Lovable cuts 15 times in 80 s, and its cuts land on the music's drops.
5. **Depth in layers.** A sharp panel over a blurred page (Lovable's Edit Text panel at 47 s);
   cards scattered in 3D (LangEase "Multiple Languages" at 18 s); a tunnel of tilted device screens
   (LangEase 5–10 s).
6. **The whole frame is the brand.** Background, type and accents in the product's palette and font.
   LangEase: #F7F8FC ground, blue #2F6BFF → #8AB6FF accents, saturation 0.05. Lovable: warm cream
   #F6F3EE and gradient fields (blue #4B6BFF → pink #FF3DA6 → orange #FF6A2B) with film grain,
   alternating with near-black frames (18% of the film).
7. **Music sets the structure.** Music from frame 0 to the end at −12 to −14 LUFS. Edits follow the
   music's sections and drops, not every beat (on whole beats they score at chance). Lovable stops the
   music for 0.6 s before the logo reveal at 8 s and hard-cuts as it returns at 50 s.
8. **Proof, not features.** Counters (counting up to 53,980 "new apps every day"), a grid of real outputs,
   the product's own buttons being pressed, state changes (Distribute → done).
9. **One idea per 1.5–3 s.** 15–25 beats in 30 s; median shot 3.7 s in Lovable, but each shot carries
   2–3 motion events.

## Measured targets (a trailer passes these)

| Measure | LangEase | Lovable 2.0 | AgentCast trailer target |
| --- | --- | --- | --- |
| Still time (freezes ≥ 0.5 s), end card excluded | ~1% | ~0% | ≤ 10% |
| On-screen words a second | 0.9 | 0.9 | 0.6–1.2 |
| Screen time: kinetic type only | 36% | 48% | 30–50% |
| Screen time: lifted single components | 36% | ~18% | ≥ 15% |
| Screen time: full UI (tilted, 3D, zoomed) | 21% | ~24% | ≤ 40% |
| Scene length | 1–3 s | 1.5–5 s | median 1.5–3 s |
| Loudness | −13.8 LUFS | −11.8 LUFS | −14 ± 1 LUFS |
| Hard cuts | 0 | 15 / 80 s | ≤ 1 per 4 s, on drops or sections |

## Shot by shot

### LangEase (33 s)

| Time (s) | On screen | Technique | AgentCast scene |
| --- | --- | --- | --- |
| 0.0–3.0 | "Turn · Books · Audio · Any language" | one or two words at a time, accent + ink two-tone, blur and scale in/out, centred | `kinetic` (light) |
| 3.2–5.6 | "Any language [folder card] Instantly"; the card drops into a tilted upload zone | a product icon inline in the sentence; 3D zone | `kinetic` with an inline component |
| 5.8–10.0 | "Just drop and go", then "Books. Audio. Video", "All In One Platform" inside a tunnel of tilted phone/tablet screens | CSS 3D perspective, slow push-in, text centred | `tunnel` (montage) |
| 10.0–11.0 | a blue ribbon sweeps across and becomes a progress bar | shape morph wipe | `morph` transition |
| 11.0–12.8 | progress bar, counter 67 → 81 → … → 100/100 | rebuilt component, animated value | `stat` (progress variant) |
| 12.8–14.4 | bar → dot → check, "Done", confetti | morph chain + particles | `stat` end state + `morph` |
| 14.4–15.6 | the check becomes a card, then a carousel of video cards | morph into a lifted list | `cards` |
| 15.8–17.4 | the full library screen, tilted, camera pushes in, cursor moves | screenshot in perspective + drawn cursor | `shot` (tilted window) |
| 17.4–18.1 | one video card lifts out enlarged; cursor clicks | element lifted from its page | `component` |
| 18.2–20.0 | cards scatter in 3D; "Multiple Languages" | duplicated cards as particles | `cards` (scatter) |
| 20.2–22.0 | list view, steep tilt, cursor | full UI in perspective | `shot` (tilted window) |
| 22.2–24.4 | one row, then a "Distribute To Youtube" button; cursor clicks, button changes state | lifted row and button with hover/active | `component` |
| 24.6–28.4 | logo sparkle bounces; "Translate. Dub. Distribute" types on | logo glyph as a character | `kinetic` + logo |
| 28.6–33.0 | logo lockup; "langease.ai" types on | end card, the only hold | `outro` |

### Lovable 2.0 (80 s)

| Time (s) | On screen | Technique | AgentCast scene |
| --- | --- | --- | --- |
| 0.0–2.5 | brand-coloured bubbles, "Today", "Less than 1% [globe] of the world" | particle field; an icon inside the line | `title` (mesh) + `kinetic` |
| 2.5–6.5 | "knows how to co#|" typed with a caret inside animated braces; "but that's about to change" | typewriter, code glyphs as decoration | `kinetic` (typing) |
| 6.5–8.5 | "Meet" gradient-filled, then logo + "Lovable" on a blue → pink field; music stops 0.6 s | brand reveal on a drop | `title` reveal |
| 9.0–12.5 | "websites · apps · than ever before" | one word per beat on dark, then gradient | `kinetic` (dark / gradient) |
| 12.5–17.9 | "Join other builders creating", a counter climbing past 44,964 to 53,980 riding a glowing line, "day" | counting stat + chart line | `stat` |
| 18.0–22.9 | a star shape opens onto a grid of sites; one site in a laptop | showcase grid, device mockup | `cards` (grid) |
| 23.0–27.0 | glowing pill "Ask Lovable to create…", prompt typed, send clicked, the pill opens into the app | lifted input + morph into the window | `component` (typing) → `shot` |
| 27.0–33.0 | the editor tilted; camera dives onto the chat box; a second prompt typed | full UI, deep zooms | `shot` (tilted, zoom ≥ 1.8×) |
| 33.0–38.5 | "Now with collaboration" with named cursors; Invite / Publish buttons huge; invite dialog; avatars | lifted buttons and dialog | `kinetic` + `component` |
| 41.0–45.0 | "Edit", extreme zoom onto the Edit button, click | vector-sharp 5–6× close-up | `component` |
| 45.0–53.0 | Edit Text panel over a blurred page, text selected, colour picker | layered panel, depth of field | `component` (layered) |
| 53.5–57.0 | "what · built · with your own domains" | huge gradient type on the brand field | `kinetic` (gradient) |
| 57.0–63.0 | Publish clicked; dialog cycles 4 domains; a browser window with the site | value cycling in a lifted dialog | `component` |
| 63.0–69.0 | "Introducing /dev mode", a toggle clicked, the code view tilted | lifted toggle, tilted footage | `component` + `shot` |
| 69.0–76.0 | "Edit code right on the spot or in [GitHub] Github", "Now it's your turn", "What are you building?" | kinetic type on dark and gradient | `kinetic` |
| 76.0–80.5 | heart logo, "Lovable", "lovable.dev" on black with brand glows at the corners | end card, the only hold | `outro` |

## Motion vocabulary (copy these numbers)

- **Word in:** opacity 0 → 1, blur 16–24 px → 0, scale 1.25 → 1 (LangEase) or y +60 px → 0
  (Lovable), 0.35–0.5 s, `power3.out`. Stagger 0.08–0.14 s per word.
- **Word out:** blur 0 → 12–20 px, scale 1 → 0.9 (or → 1.4 "through the camera"), opacity → 0,
  0.25–0.35 s, `power2.in`. Out is faster than in.
- **Accent word:** brand colour or a horizontal gradient fill (`background-clip: text`).
- **Window arrive:** rotateX 24–30°, rotateY −14 to −20°, rotateZ 3–5°, scale 0.8, y +120 px →
  rotateX 6–10°, rotateY −4 to −8°, 1.8–2.4 s, `power3.out`; then keep drifting.
- **Push-in:** scale +0.25–0.45 over the rest of the shot, `power1.inOut`, toward the acted element.
- **Lift:** the component scales 1 → 1.06 and rises 8–14 px as the cursor reaches it; on click it
  presses to 0.96 for 90 ms and springs back; a ring or glow pulses once.
- **Cursor:** a large hand or arrow (48–64 px at 1080p), eased paths, a squish on click.
- **Counter:** an integer tween over 1.2–2.2 s, `power2.out`, tabular figures.
- **Backdrop:** two to three soft radial glows drifting on slow orbits (8–14 s a loop) plus 3–6% film
  grain; never a flat fill except for the end card.

## What we can't copy (and do instead)

- Bespoke morph chains (folder → upload zone) are hand animation. Use `morph` between matching shapes
  (bar → dot, card → window) and write a custom scene only when the beat earns it.
- Staged demo data (Lovable's fake shop, cursors named Lucy and Jonathan) isn't ours to invent. Show
  what the explore agents found on the real product; never fake numbers in a `stat`.
