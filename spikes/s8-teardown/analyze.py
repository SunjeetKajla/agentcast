import json, subprocess, sys, os, re
import numpy as np

def probe(path):
    d = json.loads(subprocess.check_output(["ffprobe","-v","error","-show_entries","stream=codec_type,width,height,r_frame_rate:format=duration","-of","json",path]))
    v = [s for s in d["streams"] if s["codec_type"]=="video"][0]
    n, m = v["r_frame_rate"].split("/")
    return float(d["format"]["duration"]), float(n)/float(m), int(v["width"]), int(v["height"])

def frames(path, fps, w=96, h=54):
    raw = subprocess.check_output(["ffmpeg","-v","error","-i",path,"-vf",f"fps={fps},scale={w}:{h}:flags=area","-f","rawvideo","-pix_fmt","rgb24","-"])
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.float32)

def audio(path, sr=22050):
    raw = subprocess.check_output(["ffmpeg","-v","error","-i",path,"-ac","1","-ar",str(sr),"-f","f32le","-"])
    return np.frombuffer(raw, np.float32), sr

def loudness(path):
    out = subprocess.run(["ffmpeg","-hide_banner","-nostats","-i",path,"-af","ebur128=peak=true","-f","null","-"],capture_output=True,text=True).stderr
    tail = out[out.rfind("Summary:"):]
    g = lambda k: float(re.search(k+r":\s+(-?[\d.]+)", tail).group(1))
    return {"lufs": g("I"), "lra": g("LRA"), "truePeak": g("Peak")}

def hist(f):
    q = (f // 32).astype(np.int32)
    idx = q[...,0]*64 + q[...,1]*8 + q[...,2]
    return np.stack([np.bincount(i.ravel(), minlength=512) for i in idx]).astype(np.float32) / idx[0].size

def video_metrics(path, fps):
    f = frames(path, fps)
    gray = f.mean(-1)
    diff = np.abs(np.diff(gray, axis=0)).mean((1,2))  # motion energy per frame (0-255)
    h = hist(f)
    hd = 0.5*np.abs(np.diff(h, axis=0)).sum(1)        # histogram distance 0..1
    # cut: histogram jump that is large and stands out from its neighbourhood (rejects steady fast motion)
    cuts = []
    for i in range(len(hd)):
        lo, hi = max(0,i-4), min(len(hd), i+5)
        nb = np.concatenate([hd[lo:i], hd[i+1:hi]])
        if hd[i] > 0.28 and hd[i] > 3*np.median(nb) + 0.08 and diff[i] > 6:
            if not cuts or (i+1)/fps - cuts[-1] > 0.25: cuts.append((i+1)/fps)
    # stills: runs of near-zero motion
    still = diff < 0.35
    mx, mn = f.max(-1), f.min(-1)
    sat = np.where(mx>0, (mx-mn)/np.maximum(mx,1), 0).mean((1,2))
    luma = gray.mean((1,2))
    # soft transitions: the picture's colour make-up changes a lot within ~0.5 s (crossfade, blur, morph, whip)
    k = max(1, int(round(fps*0.5)))
    hk = 0.5*np.abs(h[k:] - h[:-k]).sum(1)
    soft = []
    for i in range(len(hk)):
        lo, hi = max(0,i-k), min(len(hk), i+k+1)
        if hk[i] >= 0.45 and hk[i] == hk[lo:hi].max():
            t = (i + k/2)/fps
            if all(abs(t-c) > 0.6 for c in cuts) and (not soft or t - soft[-1] > 0.6): soft.append(t)
    # still over 0.5 s windows (catches slow drift that frame-to-frame differences miss)
    dk = np.abs(gray[k:] - gray[:-k]).mean((1,2))
    still2 = np.concatenate([dk < 1.0, np.zeros(k, bool)])
    return dict(cuts=cuts, soft=soft, diff=diff, still=still2[:len(diff)], sat=sat, luma=luma, n=len(f))

def stft_flux(y, sr, n=1024, hop=256):
    win = np.hanning(n).astype(np.float32)
    frames_ = np.lib.stride_tricks.sliding_window_view(y, n)[::hop] * win
    S = np.abs(np.fft.rfft(frames_, axis=1))
    L = np.log1p(10*S)
    flux = np.maximum(0, np.diff(L, axis=0)).sum(1)
    freqs = np.fft.rfftfreq(n, 1/sr)
    low = np.maximum(0, np.diff(L[:, (freqs>30)&(freqs<160)], axis=0)).sum(1)
    rms = np.sqrt((frames_**2).mean(1))
    t = (np.arange(len(flux))+1)*hop/sr
    return t, flux, low, rms[1:], hop/sr

def tempo(flux, dt):
    x = flux - np.convolve(flux, np.ones(int(1/dt))/int(1/dt), "same")
    x = np.maximum(x, 0)
    ac = np.correlate(x, x, "full")[len(x)-1:]
    lags = np.arange(len(ac))*dt
    ok = (lags >= 60/190) & (lags <= 60/70)
    # prefer 90-150 bpm a little (log-gaussian weighting, like librosa's prior)
    bpm_all = 60/np.maximum(lags, 1e-9)
    prior = np.exp(-0.5*(np.log2(bpm_all/120)/1.0)**2)
    score = np.where(ok, ac*prior, 0)
    lag = int(np.argmax(score))
    period = lag*dt
    # phase: comb sum
    best, phase = -1, 0
    for p in range(lag):
        s = x[p::lag].sum()
        if s > best: best, phase = s, p
    beats = np.arange(phase*dt, len(x)*dt, period)
    # strength of periodicity
    strength = float(ac[lag]/ac[0]) if ac[0] > 0 else 0
    return 60/period, beats, strength

def peaks(env, dt, k=2.5, min_gap=0.12):
    med = np.convolve(env, np.ones(int(1.5/dt))/int(1.5/dt), "same")
    mad = np.convolve(np.abs(env-med), np.ones(int(1.5/dt))/int(1.5/dt), "same")
    out = []
    for i in range(1, len(env)-1):
        if env[i] >= env[i-1] and env[i] >= env[i+1] and env[i] > med[i] + k*mad[i] + 1e-6:
            t = i*dt
            if not out or t - out[-1][0] > min_gap: out.append((t, env[i]))
            elif env[i] > out[-1][1]: out[-1] = (t, env[i])
    return out

def near_frac(events, targets, tol):
    if not len(events) or not len(targets): return 0.0
    targets = np.asarray(targets)
    return float(np.mean([np.min(np.abs(targets - e)) <= tol for e in events]))

def chance(events, targets, tol, dur, n=300, rng=np.random.default_rng(0)):
    if not len(events): return 0.0
    vals = [near_frac(rng.uniform(0, dur, len(events)), targets, tol) for _ in range(n)]
    return float(np.mean(vals))

def speech(name, subdir):
    for suffix in (".en-orig.json3", ".en.json3"):
        p = os.path.join(subdir, name+suffix)
        if os.path.exists(p): break
    else: return None
    d = json.load(open(p))
    words = []
    for ev in d.get("events", []):
        t0 = ev.get("tStartMs", 0)
        for s in ev.get("segs", []) or []:
            w = s.get("utf8","").strip()
            if w and w != "\n" and not w.startswith("["):
                words.append(((t0 + s.get("tOffsetMs",0))/1000, w))
    return words

def main(path, subdir, outdir):
    name = os.path.splitext(os.path.basename(path))[0]
    dur, fps, W, H = probe(path)
    afps = min(fps, 30)
    v = video_metrics(path, afps)
    y, sr = audio(path)
    t, flux, low, rms, dt = stft_flux(y, sr)
    bpm, beats, strength = tempo(flux, dt)
    hits = peaks(flux, dt, k=6.0, min_gap=0.2)
    hit_t = [h[0] for h in hits]
    big = sorted(hits, key=lambda h: -h[1])[:max(3, int(len(hits)*0.25))]
    big_t = sorted(h[0] for h in big)
    db = 20*np.log10(rms + 1e-9)
    med_db = np.median(db[db > -80]) if (db > -80).any() else -80
    quiet = db < med_db - 15
    drops = []
    i = 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]: j += 1
            if (j-i)*dt >= 0.2 and i*dt > 0.5 and j*dt < dur - 0.5: drops.append((round(i*dt,2), round((j-i)*dt,2)))
            i = j
        else: i += 1
    cuts = v["cuts"]
    shots = np.diff([0] + cuts + [dur])
    trans = sorted(cuts + v["soft"])
    scenes = np.diff([0] + trans + [dur])
    tol = max(1.5/afps, 0.05)
    words = speech(name, subdir)
    vo = None
    if words:
        span = words[-1][0] - words[0][0] if len(words) > 1 else 0
        vo = {"words": len(words), "wps_over_film": round(len(words)/dur, 2), "first": round(words[0][0],1), "last": round(words[-1][0],1), "text": " ".join(w for _, w in words)[:600]}
    # still runs >= 0.5 s
    st = v["still"]; runs=[]; i=0
    while i < len(st):
        if st[i]:
            j=i
            while j<len(st) and st[j]: j+=1
            if (j-i)/afps >= 0.5: runs.append((round(i/afps,2), round((j-i)/afps,2)))
            i=j
        else: i+=1
    still_time = sum(r[1] for r in runs)
    # motion energy per second
    per_sec = [float(v["diff"][int(s*afps):int((s+1)*afps)].mean()) for s in range(int(dur)) if int(s*afps) < len(v["diff"])]
    res = {
        "name": name, "duration": round(dur,2), "fps": round(fps,2), "size": f"{W}x{H}",
        "cuts": len(cuts), "cuts_per_10s": round(10*len(cuts)/dur, 2),
        "shot_median": round(float(np.median(shots)),2), "shot_mean": round(float(np.mean(shots)),2),
        "shot_p10": round(float(np.percentile(shots,10)),2), "shot_p90": round(float(np.percentile(shots,90)),2),
        "cut_times": [round(c,2) for c in cuts],
        "soft_transitions": len(v["soft"]), "scene_changes_per_10s": round(10*len(trans)/dur,2), "scene_median": round(float(np.median(scenes)),2), "soft_times": [round(c,2) for c in v["soft"]],
        "still_runs": runs, "still_pct": round(100*still_time/dur,1),
        "moving_frames_pct": round(100*float((v["diff"] >= 0.35).mean()),1),
        "motion_mean": round(float(v["diff"].mean()),2), "motion_per_sec": [round(x,1) for x in per_sec],
        "luma_mean": round(float(v["luma"].mean()),1), "dark_pct": round(100*float((v["luma"]<60).mean()),1), "light_pct": round(100*float((v["luma"]>170).mean()),1),
        "sat_mean": round(float(v["sat"].mean()),3),
        **loudness(path),
        "bpm": round(bpm,1), "beat_strength": round(strength,3),
        "hits_per_10s": round(10*len(hits)/dur,2), "big_hits": [round(x,2) for x in big_t],
        "audio_drops": drops,
        "cuts_on_beat": round(near_frac(cuts, beats, tol),2), "cuts_on_beat_chance": round(chance(cuts, beats, tol, dur),2),
        "cuts_on_hit": round(near_frac(cuts, hit_t, tol),2), "cuts_on_hit_chance": round(chance(cuts, hit_t, tol, dur),2),
        "cuts_on_bighit": round(near_frac(cuts, big_t, tol),2), "cuts_on_bighit_chance": round(chance(cuts, big_t, tol, dur),2),
        "voiceover": vo,
    }
    json.dump(res, open(os.path.join(outdir, name+".json"), "w"), indent=1)
    print(json.dumps({k: res[k] for k in res if k not in ("motion_per_sec","cut_times","big_hits","still_runs","voiceover")}))

if __name__ == "__main__":
    main(*sys.argv[1:4])
