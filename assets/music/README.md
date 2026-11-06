# Music library

`tags.json` lists the tracks (`MusicLibrary` in `packages/shared/src/music.ts`); the direct stage picks one per
video by personality and grammar (`pickTrack`). Audio files aren't committed: fetch each from its `source`
into this folder under its `file` name. Every track needs a licence; CC BY tracks need the credit in
`license` shown wherever the video is published. `pnpm agentcast music analyze` measures each track locally: a constant-tempo grid, the bars strong enough to enter at, loudness and true peak. A `low` confidence grid can't drive a music-led film.
