# Motion primitives

A music-led film is built from these moves, in `edl.json` as `{ kind: "primitive", id, primitive, seconds, transitionIn: "cut" }`.
The numbers behind them are in `reference-look.md`. Every `seconds` is a whole number of beats: `style.music.bpm` sets the beat, and the worker
snaps lengths back to it. Rectangles are `[x, y, w, h]` in the recording's CSS pixels. Use only regions and moments that are in `data/timeline.json`:
settled events carry `layout` (`panel`, `component`, `groups` of `rows`, `cards` or `columns`).

| `primitive.type` | Settings | Use it for |
| --- | --- | --- |
| `label` | `text`, `accent?`, `ground: base / invert / field`, `open: rise / slit / iris` | The short line before a proof: 1–4 words. `invert` flips the whole frame, once, around the midpoint. `slit` opens out of a thin line. `field` is the brand's colour world, for colourful brands. |
| `swap` | `lead`, `words` (2–6), `style: swap / rolodex` | One idea, several forms: "See it as a / list / board / timeline". The words change on the beat. |
| `ticker` | `terms` (3–10) | The product's real terms riding a ruled line. |
| `proof` | `flowId`, `in`, `out`, `frame`, `tilt: none / soft / strong`, `hops?`, `ground?` | Real footage lifted off its page as a tilted window. `hops` are rows (usually from a `rows` group) that a highlight lands on, on the last beats. |
| `build` | `flowId`, `at`, `items`, `reveal: rise / wireframe`, `lift?` | The page at one moment arriving piece by piece, usually a `columns` or `cards` group. `lift` is one card that comes forward to the middle. |
| `prompt` | `flowId`, `in`, `out`, `input`, `frame` | A close-up of typing into a field, pulling back to the page around it. |

The title card and end card are `intro: { component: "Opener", props: { line } }` and `outro: { component: "EndCard", props: { line } }`.

## Rules

- Open on the product's own idea, in the first bar. One module: a `label` for about a beat or two, then its proof.
- Never the same move twice in a row. No treatment longer than about 6 s.
- The subject is big: a proof's `frame` is a piece of the page, not the whole screen.
- Show only what was recorded. Never invent a number, a name or a result.
- Effects follow the moves by themselves (`style.sfx: "auto"`). Don't add cues unless a moment truly needs one.
