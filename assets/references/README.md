# Reference library

`skeletons.json` holds film skeletons: the structure of a launch film learned from the reference films
in `docs/LAUNCH_FILM_TEARDOWN.md`, written in terms of our motion primitives (`packages/video/src/primitives/`).
There is no footage or frame from those films here, and no skeleton follows one film move for move.

The schema is `ReferenceLibrary` in `packages/shared/src/reference.ts`. Each skeleton sets:

- **Timing, in beats of the film's track:** the opener, each module's label and proof, and the end card.
- **Module shape:** whether the module has a label, whether a shot gives a second proof from another region,
  and whether the camera holds one region or travels across the page (`camera: "path"`).
- **Look:** cycles of label openings, grounds and tilts. A brand's seed picks where each cycle starts, so two
  brands on the same skeleton don't match frame for frame.
- **Fit:** the product shapes it suits (`board`, `list`, `prompt`, `panel`, `page`). Empty suits any.
- **Target:** the reference films' scene changes per 10 s and still time, for the film lint.

The `modules` entry must match `DEFAULT_SKELETON` in `packages/video/src/template.ts`. A test checks this.

To add one: read the teardown, pick the films it's learned from, say what was taken from each in `learnedFrom`,
and render it on at least two saved jobs with `pnpm --filter @agentcast/spikes bench --led --skeleton <id>`.
