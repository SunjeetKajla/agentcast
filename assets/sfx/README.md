# Sound effect pack

`tags.json` lists the effects (`SfxPack` in `packages/shared/src/music.ts`): `kind` (`whoosh`, `click`, `pop`, `riser`,
`hit` or `tick`), `file`, `source` and `license`. List two or three takes of each kind; renders rotate through them. Audio
files aren't committed: fetch each from its `source` into this folder under its `file` name. Every sound needs a licence.

A kind with no files here uses the fallback synthesised by `ensureSfx`. The pack is empty today, so every kind does.
