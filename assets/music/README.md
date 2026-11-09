# Music library

`tags.json` lists the tracks (`MusicLibrary` in `packages/shared/src/music.ts`); the direct stage picks one per
video by personality and grammar (`pickTrack`). Audio files aren't committed: fetch each into this folder under its `file` name, from the download links in
`LICENSES.md`. Every track needs a licence; CC BY tracks need the credit in
`license` shown wherever the video is published. `pnpm agentcast music analyze` measures each track locally: a constant-tempo grid, the bars strong enough to enter at, loudness and true peak. A `low` confidence grid can't drive a music-led film.

Tracks whose audio files are absent locally are excluded from automatic selection. Metadata and `music list` still show them so they can be provisioned later.

The skeleton a film is built on asks for a kind of music (its `music` in `assets/references/skeletons.json`); tag new
tracks with moods from those lists and the personalities' (`MOODS` in `packages/video/src/music.ts`), and an energy
from 1 (a quiet bed) to 5 (driving). Prefer CC0; check each track's licence on its own page, and listen for vocals.
