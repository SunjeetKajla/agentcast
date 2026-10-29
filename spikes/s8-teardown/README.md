# s8-teardown: measuring launch films

Measures pacing, stillness, brightness, loudness, music, and how cuts and UI events line up with
the audio, for any MP4. The findings are in `docs/LAUNCH_FILM_TEARDOWN.md`. The reference films
aren't committed (they're other companies' work); `films.txt` lists the YouTube ids.

Needs ffmpeg/ffprobe and Python 3 with numpy.

```sh
# a reference film (yt-dlp: 1080p mp4 with audio) and its auto-captions (json3) for voice-over detection
yt-dlp -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]" --merge-output-format mp4 -o films/lovable-2.mp4 https://www.youtube.com/watch?v=xDwR1_vrIg8
yt-dlp --skip-download --write-auto-subs --sub-langs "en.*" --sub-format json3 -o subs/lovable-2 https://www.youtube.com/watch?v=xDwR1_vrIg8

python3 analyze.py films/lovable-2.mp4 subs metrics   # cuts, scenes, stills, look, LUFS, beat/hit alignment -> metrics/<name>.json
python3 av.py films/lovable-2.mp4                     # UI events vs audio onsets, loudness arc per 2 s
python3 analyze.py ~/.agentcast/jobs/<id>/out/16x9-en.mp4 subs metrics   # the same numbers for one of our renders
```

`metrics/` holds the measurements from 2026-10-28 (17 references plus `ours-linear` and `ours-amazon`).
