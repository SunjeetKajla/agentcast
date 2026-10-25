# Music library

`tags.json` lists the tracks (`MusicLibrary` in `packages/shared/src/music.ts`); the direct stage picks one per
video by personality and grammar (`pickTrack`). Audio files aren't committed: fetch each from its `source`
into this folder under its `file` name. Every track needs a licence; CC BY tracks need the credit in
`license` shown wherever the video is published. Tempo and first beat come from `hyperframes beats`.
