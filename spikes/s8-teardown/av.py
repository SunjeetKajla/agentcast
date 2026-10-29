import sys, os, json, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from analyze import frames, audio, stft_flux, peaks, near_frac, chance, probe
path = sys.argv[1]; name = os.path.splitext(os.path.basename(path))[0]
dur, fps, *_ = probe(path)
f = frames(path, 30).mean(-1)
diff = np.abs(np.diff(f, axis=0)).mean((1,2))
dt_v = 1/30
# visual event = sharp rise in motion energy (an element starts moving / pops / clicks)
rise = np.maximum(0, np.diff(diff, prepend=diff[0]))
vis = [t for t, _ in peaks(rise, dt_v, k=5.0, min_gap=0.25)]
y, sr = audio(path)
t, flux, low, rms, dt = stft_flux(y, sr)
aud = [x for x, _ in peaks(flux, dt, k=6.0, min_gap=0.15)]
sync = near_frac(vis, aud, 0.1); ch = chance(vis, aud, 0.1, dur)
# energy arc: RMS dB per 2 s, relative to the film's max
win = int(2/dt); db = 20*np.log10(np.array([rms[i:i+win].mean() for i in range(0, len(rms), win)]) + 1e-9)
arc = np.round(db - db.max()).astype(int).tolist()
print(json.dumps({"name": name, "visual_events": len(vis), "vis_per_10s": round(10*len(vis)/dur,1), "vis_on_audio_onset": round(sync,2), "chance": round(ch,2), "arc_db_per_2s": arc}))
