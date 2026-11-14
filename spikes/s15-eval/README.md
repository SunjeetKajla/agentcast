# Eval set

Use this before merging any change to how films are cut (template, primitives, skeletons, director): it shows
whether the change made the films better, and on which product.

```sh
pnpm --filter @agentcast/spikes eval freeze                 # once: copies the set's jobs to ~/.agentcast/eval/jobs/
pnpm --filter @agentcast/spikes eval run --tag before       # on main, or before your change
# ...make the change...
pnpm --filter @agentcast/spikes eval run --tag after
pnpm --filter @agentcast/spikes eval review --a before --b after   # http://127.0.0.1:4180, blind A/B
pnpm --filter @agentcast/spikes eval judge --a before --b after    # optional: the LLM's pick (spends quota)
pnpm --filter @agentcast/spikes eval report --a before --b after   # writes spikes/output/eval/after/vs-before.md
```

- **The set** is `set.json`: saved jobs whose recordings are reused, never re-filmed, so a run spends no provider
  quota and only the edit changes between runs. Each is cut music-led with art direction from the rules table,
  as the worker makes a launch film. `--jobs a,b` limits any command to some of them.
- **A run** renders every job at 540p into `spikes/output/eval/<tag>/<job>/`: the film, its `edl.json`, a
  20-frame contact sheet (`sheet.png`), and in `run.json` the bench's measures (loudness, sound sync, scene
  changes per 10 s, still time) plus the edit's own (transitions, camera moves per proof, parts on the beat,
  repeated moves, the longest part). A job that fails to cut or render is recorded, not fatal.
- **Review** puts the two runs' films side by side with the sides shuffled, and shows which was which only after you
  pick. `Space` plays both, `1`/`2`/`3` pick left/right/same. Picks append to `~/.agentcast/eval/preferences.jsonl`
  with the two runs' ids, so a later run under the same tag doesn't inherit them.
- **The judge** looks at the two contact sheets against `rubric.md`, twice with the order swapped. A pick that
  flips with the order counts as "same". It sees stills, not motion, so it's a check on framing, type and craft,
  and your picks outrank it.
- **The report** lists each job's numbers A → B, your picks and the judge's, and everything that got worse:
  failed renders, numbers newly outside the skeleton's targets, fewer parts on the beat, any job where A won.
- **Held-out jobs** (`"heldOut": true`) are for checking a change, not for tuning one: don't watch them while you work. The report
  tallies them separately.

Picks and judgements in `preferences.jsonl` are the data a learned judge would later be trained on, so add a
note when the reason isn't obvious.

## Growing the set

```sh
pnpm --filter @agentcast/spikes eval add --url <url> --why "<what this product adds to the set>" --focus "<what the video should show>" [--held-out]
```

`add` runs the real pipeline in-process (public access, autopilot, a music-led launch) up to the script, cancels
the job there so the director and renders spend nothing, freezes it and appends it to `set.json`. It spends TinyFish
and LLM quota, about 5–30 minutes a site. Run one site at a time: each job already uses both TinyFish agent slots,
and the worker doesn't queue across jobs. The explore agents stay signed out, never create an account and stop at
any CAPTCHA or bot check. A site that puts a bot check in front of automated Chrome (lovable.dev does) can't be
added.

Check what each job recorded before relying on it: `record/desktop/timeline.json`'s `duration`. Flows that don't
replay locally leave only a guided tour, and a site under ~4 s of footage tests little. When the TinyFish wallet is
empty, `add` still finishes on local Chrome's guided tour; those jobs say so in `why`.
