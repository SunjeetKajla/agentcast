// agentcast.js: the motion vocabulary every AgentCast scene uses (PRD §9.7.4, guides/reference-look.md).
// Loaded once by index.html, after GSAP. Deterministic: everything is a tween on the scene's paused
// timeline, so a frame is a function of time alone. Scenes the director writes may use it too.
(function () {
  var AC = {};

  /**
   * A mount's variables (copy, dur, data), by its composition id. HyperFrames keeps each mount's
   * values in __hfVariablesByComp; getVariables() alone answers for whichever scene it thinks is
   * current, which isn't this one when a shared helper asks.
   */
  AC.vars = function (id) {
    var byComp = window.__hfVariablesByComp;
    if (id && byComp && byComp[id]) return byComp[id];
    return (window.__hyperframes && window.__hyperframes.getVariables && window.__hyperframes.getVariables()) || {};
  };

  /** A variable holding JSON (camera samples, captions), parsed; `fallback` when absent or broken. */
  AC.json = function (value, fallback) {
    if (value == null || value === "") return fallback;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  };

  /** Pixels per design unit: 1 at 1080 px on the short side. */
  AC.u = function () {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ac-u"));
    return v > 0 ? v : 1;
  };

  /** The canvas: width, height and whether it's portrait. */
  AC.size = function () {
    var s = getComputedStyle(document.documentElement);
    var w = parseFloat(s.getPropertyValue("--ac-w")) || 1920;
    var h = parseFloat(s.getPropertyValue("--ac-h")) || 1080;
    return { w: w, h: h, tall: h > w };
  };

  /**
   * A scene's handles: its variables, a paused timeline, `el(name)` for `#<id>-<name>`, and `done()`,
   * which pads the timeline to the scene's length and registers it.
   */
  AC.scene = function (id, vars) {
    var byComp = window.__hfVariablesByComp;
    var v = (byComp && byComp[id]) || vars || AC.vars(id);
    var dur = Number(v.dur) || 3;
    var tl = gsap.timeline({ paused: true });
    return {
      id: id,
      v: v,
      dur: dur,
      tl: tl,
      el: function (name) {
        return document.getElementById(id + "-" + name);
      },
      done: function () {
        tl.set({}, {}, dur);
        window.__timelines = window.__timelines || {};
        window.__timelines[id] = tl;
      },
    };
  };

  /**
   * How a scene arrives over the one before it (the incoming scene does the work). `el` is a wrapper,
   * never a .clip. Kinds: cut, fade, slide, zoom-through, blur-zoom (Lovable), ribbon (LangEase).
   */
  AC.enter = function (tl, el, kind, secs, ribbon) {
    if (!secs || !kind || kind === "cut") return;
    if (kind === "fade") tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: secs, ease: "power2.out" }, 0);
    else if (kind === "slide") tl.fromTo(el, { xPercent: 100 }, { xPercent: 0, duration: secs, ease: "power3.out" }, 0);
    else if (kind === "zoom-through")
      tl.fromTo(el, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: secs, ease: "power3.out" }, 0);
    else if (kind === "blur-zoom")
      tl.fromTo(
        el,
        { opacity: 0, scale: 1.3, filter: "blur(24px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: secs, ease: "power3.out" },
        0,
      );
    else if (kind === "ribbon") {
      tl.fromTo(
        el,
        { clipPath: "inset(0% 100% 0% 0%)" },
        { clipPath: "inset(0% 0% 0% 0%)", duration: secs, ease: "power3.inOut" },
        0,
      );
      if (ribbon)
        tl.fromTo(
          ribbon,
          { xPercent: -110, opacity: 1 },
          { xPercent: 110, opacity: 1, duration: secs * 1.1, ease: "power3.inOut" },
          0,
        );
    }
  };

  /** How a scene leaves under the next one, over its last `secs`. */
  AC.exit = function (tl, el, kind, secs, dur) {
    if (!secs || !kind || kind === "cut") return;
    var at = Math.max(0, dur - secs);
    var o = { immediateRender: false };
    // The next scene may not cover this one (a shot's window floats on the ground): fade out under it.
    if (kind === "fade" || kind === "ribbon")
      tl.fromTo(el, { opacity: 1 }, Object.assign({ opacity: 0, duration: secs * 0.6, ease: "power1.in" }, o), at + secs * 0.4);
    if (kind === "slide")
      tl.fromTo(el, { xPercent: 0 }, Object.assign({ xPercent: -30, duration: secs, ease: "power3.in" }, o), at);
    else if (kind === "zoom-through")
      tl.fromTo(
        el,
        { scale: 1, opacity: 1 },
        Object.assign({ scale: 1.25, opacity: 0, duration: secs, ease: "power2.in" }, o),
        at,
      );
    else if (kind === "blur-zoom")
      tl.fromTo(
        el,
        { scale: 1, opacity: 1, filter: "blur(0px)" },
        Object.assign({ scale: 1.5, opacity: 0, filter: "blur(24px)", duration: secs, ease: "power2.in" }, o),
        at,
      );
  };

  /** Splits a line into groups of 1–3 words (at most ~14 characters), the way the reference films do. */
  AC.groups = function (text, maxWords, maxChars) {
    maxWords = maxWords || 3;
    maxChars = maxChars || 14;
    var words = String(text || "")
      .split(/\s+/)
      .filter(Boolean);
    var out = [];
    var cur = [];
    words.forEach(function (w) {
      var len = cur.join(" ").length + w.length + (cur.length ? 1 : 0);
      if (cur.length && (cur.length >= maxWords || len > maxChars)) {
        out.push(cur.join(" "));
        cur = [];
      }
      cur.push(w);
    });
    if (cur.length) out.push(cur.join(" "));
    return out;
  };

  var norm = function (w) {
    return String(w)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  };

  /** A font size (px) that fits `chars` characters across `share` of the canvas width. */
  AC.fit = function (chars, max, share) {
    var s = AC.size();
    var u = AC.u();
    return Math.max(40 * u, Math.min((max || 200) * u, (s.w * (share || 0.84)) / (Math.max(chars, 3) * 0.56)));
  };

  /**
   * Kinetic type into `el` between `from` and `to` seconds. `mode` "build" lays the words out on one
   * line, each arriving in turn and staying (LangEase "Any language · Instantly"); "swap" shows the
   * groups one after another in the same place (Lovable "websites · apps · than ever before"). Words in
   * `accent` take the accent class. Returns the word spans.
   */
  AC.words = function (tl, el, text, accent, from, to, mode, max, share) {
    var accents = String(accent || "")
      .split(/\s+/)
      .map(norm)
      .filter(Boolean);
    var groups = mode === "build" ? [String(text || "")] : AC.groups(text, 3, AC.size().tall ? 12 : 18);
    var all = [];
    var slot = Math.max(0.45, (to - from) / Math.max(1, groups.length));
    groups.forEach(function (g, gi) {
      var line = document.createElement("div");
      line.className = "ac-line";
      var words = g.split(/\s+/).filter(Boolean);
      line.style.fontSize = AC.fit(g.length, max, share) + "px";
      el.appendChild(line);
      var start = from + gi * slot;
      // Each line keeps growing while it's up, so a landed word never stands still (LangEase 0–3 s).
      var stay = mode === "build" ? to - from : slot;
      tl.fromTo(line, { scale: 1 }, { scale: 1.07, duration: Math.max(0.3, stay), ease: "none" }, start);
      words.forEach(function (w, wi) {
        var span = document.createElement("span");
        span.className = "ac-word" + (accents.indexOf(norm(w)) >= 0 ? " ac-accent" : "");
        span.textContent = w;
        line.appendChild(span);
        if (wi < words.length - 1) line.appendChild(document.createTextNode(" "));
        all.push(span);
        var at = mode === "build" ? from + Math.min(wi * 0.16, (to - from) * 0.4) : start + wi * 0.09;
        tl.fromTo(
          span,
          { opacity: 0, scale: 1.25, filter: "blur(20px)", y: 0 },
          { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "power3.out" },
          at,
        );
      });
      // A swapped group leaves before the next arrives; the last one stays for the scene's exit.
      if (mode !== "build" && gi < groups.length - 1)
        tl.fromTo(
          line.children,
          { opacity: 1, scale: 1, filter: "blur(0px)" },
          {
            opacity: 0,
            scale: 0.9,
            filter: "blur(14px)",
            duration: 0.28,
            ease: "power2.in",
            immediateRender: false,
          },
          start + slot - 0.3,
        );
    });
    return all;
  };

  /**
   * Applies samples `[[t, a, b, …], …]` to `el` as consecutive linear tweens on the properties named
   * in `keys` (the camera and window paths the compiler sampled at 10 Hz).
   */
  AC.path = function (tl, el, samples, keys) {
    if (!samples || !samples.length) return;
    var props = function (s) {
      var p = {};
      keys.forEach(function (k, i) {
        p[k] = s[i + 1];
      });
      return p;
    };
    tl.set(el, props(samples[0]), 0);
    for (var i = 1; i < samples.length; i++) {
      var dt = samples[i][0] - samples[i - 1][0];
      if (dt <= 0) continue;
      tl.to(el, Object.assign(props(samples[i]), { duration: dt, ease: "none" }), samples[i - 1][0]);
    }
  };

  /** Types `text` into `el` over `secs` from `at`, with a caret that stays after. */
  AC.typeOn = function (tl, el, text, at, secs) {
    var state = { n: 0 };
    text = String(text || "");
    el.textContent = "";
    tl.fromTo(
      state,
      { n: 0 },
      {
        n: text.length,
        duration: secs,
        ease: "none",
        onUpdate: function () {
          el.textContent = text.slice(0, Math.round(state.n));
        },
      },
      at,
    );
  };

  /** Counts `el` from `from` to `to` (tabular figures), Lovable's builders counter. */
  AC.count = function (tl, el, from, to, at, secs, decimals, prefix, suffix) {
    var state = { n: from };
    var fmt = function (n) {
      return (
        (prefix || "") +
        Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 }) +
        (suffix || "")
      );
    };
    el.textContent = fmt(from);
    tl.fromTo(
      state,
      { n: from },
      {
        n: to,
        duration: secs,
        ease: "power2.out",
        onUpdate: function () {
          el.textContent = fmt(state.n);
        },
      },
      at,
    );
  };

  /** A slow push-in so nothing holds still: scale by `amount` over the scene. */
  AC.drift = function (tl, el, dur, amount) {
    var a = amount || 0.08;
    tl.fromTo(el, { scale: 1 - a * 0.25, y: 6 * AC.u() }, { scale: 1 + a, y: -6 * AC.u(), duration: dur, ease: "none" }, 0);
  };

  window.AC = AC;
})();
