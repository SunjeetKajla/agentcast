// The landing page's sample run: the job page's design, acted out with sample data (todomvc.com) so a
// visitor can watch a whole run in a minute. It is a demo only; the real job page reads the worker
// (src/app/jobs/[id]). Ported as-is from the redesign artifact, so it builds DOM from strings.
import { gsap } from "gsap";

const G = gsap;
const RM = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const dpr = typeof devicePixelRatio !== "undefined" ? Math.min(devicePixelRatio || 1, 2) : 1;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const MODES = ["Live", "Studio", "the TinyFish fallback"];

/** The landing page's switches, as the sample run reads them. */
const opts = { hindi: false, vertical: true, music: true, gates: true, mode: 0 };
const variants = () => {
  const langs = opts.hindi ? ["English", "Hindi"] : ["English"];
  const sizes = opts.vertical ? ["16:9", "9:16"] : ["16:9"];
  const out = [];
  for (const size of sizes) for (const lang of langs) out.push({ size, lang });
  return out;
};

const STAGES = [["understand", "Understand"], ["auth", "Sign in"], ["discover", "Explore"], ["flow-runs", "Try flows"], ["gate-flows", "Review flows", 1], ["record", "Record"], ["script", "Script"], ["gate-script", "Review script", 1], ["voice", "Voice"], ["direct", "Direct"], ["preview", "Preview"], ["gate-preview", "Review preview", 1], ["render", "Render"]];
const AGENTS = [
  { goal: "Add three todos and tick one off", start: [], steps: [
    ["open", "Opened todomvc.com/examples/react"], ["focus", "Clicked “What needs to be done?”"],
    ["add", "Typed “Book the venue”, pressed Enter", "Book the venue"], ["add", "Typed “Send the invites”, pressed Enter", "Send the invites"],
    ["add", "Typed “Order the cake”, pressed Enter", "Order the cake"], ["toggle", "Ticked “Book the venue”", 0], ["check", "Checked the outcome: “2 items left”"]] },
  { goal: "Filter by Active, then Completed", start: [["Book the venue", 1], ["Send the invites", 0], ["Order the cake", 0]], steps: [
    ["open", "Opened the list with three todos"], ["filter", "Clicked “Active”: 2 shown", 1], ["filter", "Clicked “Completed”: 1 shown", 2],
    ["filter", "Clicked “All”: 3 shown", 0], ["check", "Checked the address: #/completed, then #/"]] },
  { goal: "Rename a todo in place", start: [["Book the venue", 0], ["Send the invites", 0]], steps: [
    ["open", "Opened the list with two todos"], ["warn", "Double-clicked the row; no editor opened"], ["fix", "Repair: double-clicked the label instead", 1],
    ["rename", "Typed “Send the invites by Friday”", 1, "Send the invites by Friday"], ["commit", "Pressed Enter: the label changed"], ["check", "Checked the outcome: 2 todos, one renamed"]] },
];
function tmHTML(s, opt = {}) {
  const items = s.items.filter((it) => s.filter === 0 || (s.filter === 1 ? !it[1] : it[1]));
  const left = s.items.filter((it) => !it[1]).length;
  return `<div class="tm">${opt.cursor ? `<span class="cursor" style="top:${s.cy}em;left:${s.cx}em"></span>` : ""}
    <div class="tm-h">todos</div>
    <div class="tm-card">
      <div class="tm-in ${s.typing ? "typed" : ""}">${s.typing ? esc(s.typing) : "What needs to be done?"}</div>
      ${items.map((it, i) => `<div class="tm-row ${it[1] ? "done" : ""} ${s.editing === i ? "edit" : ""}"><span class="c">${it[1] ? '<i class="ck"></i>' : ""}</span><span class="l">${esc(it[0])}</span></div>`).join("")}
      ${s.items.length ? `<div class="tm-foot"><span>${left} item${left === 1 ? "" : "s"} left</span><span class="f"><span class="${s.filter === 0 ? "on" : ""}">All</span><span class="${s.filter === 1 ? "on" : ""}">Active</span><span class="${s.filter === 2 ? "on" : ""}">Completed</span></span></div>` : ""}
    </div></div>`;
}

// The job's data. Every figure on the job view is computed from these.
const JOB = { host: "todomvc.com", url: "todomvc.com/examples/react", kind: "Launch video", reported: 11, voice: "Brian (premade)" };
const BEATS = [
  { name: "Title", line: "Your list, kept simple.", s: 4, card: 1 },
  { name: "Add and tick off", line: "Add what’s on your mind, and tick it off when it’s done.", s: 12 },
  { name: "Filter", line: "See only what’s left.", s: 9 },
  { name: "Rename", line: "Changed your mind? Rename it in place.", s: 10 },
  { name: "End card", line: "TodoMVC. One app, every framework.", s: 4, card: 1 },
];
const CUT_S = BEATS.reduce((a, b) => a + b.s, 0);
// Seconds each stage takes (gates: the usual wait, used only as an estimate until they happen).
const DUR = { understand: 21, auth: 0, discover: 108, "flow-runs": 72, "gate-flows": 40, record: 32, script: 22, "gate-script": 25, voice: 18, direct: 26, preview: 16, "gate-preview": 30, render: 30 };
const FLOW_S = [9, 8, 7], JUDGE = [92, 88, 81];
const NOTES = [["Held the add-todo shot 0.4 s longer so the voice lands", "0:06"], ["Moved the cut on “tick it off” to the click frame", "0:13"], ["Spotlight on the Active and Completed filters", "0:19"], ["Motion lint: 0 issues", "all"]];
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const took = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s` : `${Math.floor(s)}s`);
console.assert(CUT_S === 39, "beats should add up to the 0:39 cut");

class JobSim {
  constructor(root, { autopilot }) {
    this.root = root; this.autopilot = autopilot; this.gen = 0; this.visible = false;
    this.io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; }, { threshold: 0.02 });
    this.io.observe(root);
    this.timer = setInterval(() => this.tick(), 100);
    this.start();
  }
  async wait(ms, gen) {
    let left = RM ? Math.min(ms, 300) : ms;
    while (left > 0) { await sleep(100); if (gen !== this.gen) throw 0; if (this.visible) left -= 100; }
  }
  q(s) { return this.root.querySelector(s); }
  start() {
    this.gen++;
    const gen = this.gen;
    this.st = {}; let t = 0;
    for (const [k] of STAGES) this.st[k] = { s: "pending" };
    for (const k of ["understand", "auth", "discover"]) { this.st[k] = { s: k === "auth" ? "skipped" : "done", a: t, b: t + DUR[k] }; t += DUR[k]; }
    this.clock = t; this.rate = 0; this.cur = null; this.picked = 0; this.feedItems = []; this.finished = false;
    this.root.innerHTML = `<div class="app" ${this.autopilot ? "data-ui" : ""}>
      <header class="app-bar"><div class="app-bar-in">
        <a class="wm" href="#top">AgentCast</a>
        <nav aria-label="Sample app"><a href="#top">New video</a><a href="/jobs" aria-current="page">Videos</a><a href="#faq">Help</a></nav>
        <span class="grow"></span>
        <span class="worker"><i></i><span>A sample run</span></span>
      </div></header>
      <div class="app-col">
        <div class="ttl">
          <div class="ttl-l"><p class="crumb"><a href="/jobs">Videos</a> / ${JOB.kind}</p><${this.autopilot ? "h3" : "h1"} class="jt">${JOB.host}</${this.autopilot ? "h3" : "h1"}><p class="finding" data-finding></p></div>
          <div class="ttl-act" data-ttl-act></div>
        </div>
        <dl class="meta">
          <div><dt>Elapsed</dt><dd data-m="elapsed"></dd></div>
          <div><dt>Stage</dt><dd data-m="stage"></dd></div>
          <div><dt>Flows</dt><dd data-m="flows"></dd></div>
          <div><dt>Videos</dt><dd data-m="videos"></dd></div>
          <div><dt>Recording</dt><dd data-m="rec"></dd></div>
        </dl>
        <section class="air" data-state="run" aria-labelledby="air-h-${this.autopilot ? "a" : "b"}">
          <canvas class="air-dust" aria-hidden="true"></canvas>
          <div class="air-in">
            <div class="air-head">
              <div><h2 class="air-h" id="air-h-${this.autopilot ? "a" : "b"}"><span data-air-h></span></h2><p class="air-lead" data-air-lead></p></div>
              <div class="air-clock"><b data-air-clock>0:00</b><span data-air-sub></span></div>
            </div>
            <div class="air-body" data-air-body></div>
          </div>
        </section>
        <section class="blk" aria-label="The run as a timeline">
          <div class="blk-h"><h2>The run</h2><span data-tl-sum></span></div>
          <div class="tl"><div class="tl-ruler" data-ruler></div><div class="tl-track" data-track></div></div>
          <p class="tl-key"><span><i class="k-done"></i>Done</span><span><i class="k-run"></i>Working</span><span><i class="k-gate"></i>Review gate</span><span><i class="k-wait"></i>Waiting on you</span><span><i class="k-next"></i>Still to come, estimated</span><span><i class="k-now"></i>Now</span></p>
        </section>
        <div class="lower">
          <section class="blk"><div class="blk-h"><h2>Activity</h2><span data-feed-n></span></div><ol class="feed2" data-feed></ol></section>
          <section class="blk"><div class="blk-h"><h2>This job</h2><span>change it at the next gate</span></div><dl class="facts" data-facts></dl></section>
        </div>
      </div></div>`;
    this.dust = { c: this.q(".air-dust"), dots: [] };
    this.cancelBtn();
    this.facts();
    const at = (k) => this.st[k].b;
    [[0, "Job started for todomvc.com"], [at("understand"), "Brief written: 1 page read, 5 claims found"], [at("auth"), "Sign in skipped: the site is public"],
     [at("understand"), "Explore started: a scout is mapping the site"], [at("discover"), "Explore finished: 11 flows reported"], [at("discover"), "The judge picked 3 flows to try"]]
      .forEach(([t, m]) => this.log(m, t));
    this.run(gen).catch(() => {});
  }
  cancelBtn() {
    const box = this.q("[data-ttl-act]");
    box.innerHTML = `<button type="button" class="ab ab-ghost" data-cancel>Cancel job</button>`;
    const b = box.firstChild;
    b.addEventListener("click", () => {
      if (b.dataset.sure) return this.cancel();
      b.dataset.sure = 1; b.textContent = "Yes, cancel it";
      setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "Cancel job"; } }, 3000);
    });
  }
  async cancel() {
    this.gen++; this.rate = 0;
    const k = this.cur; if (k) Object.assign(this.st[k], { s: "cancelled", b: this.clock });
    this.log("Job cancelled");
    this.q("[data-ttl-act]").innerHTML = "";
    await this.show({ state: "run", title: "Cancelled", lead: "Nothing more will be filmed. Takes already recorded are kept with the job.", clock: mmss(this.clock), sub: "total time", body: `<button type="button" class="ab ab-f" data-again>Start it again <span class="arr" aria-hidden="true">→</span></button>` });
    this.q("[data-finding]").textContent = `Cancelled during ${STAGES.find(([x]) => x === k)?.[1] ?? "the run"}.`;
    this.q("[data-again]").addEventListener("click", () => this.start());
    this.tl();
  }

  /* ── ticking state ── */
  tick() {
    if (!this.q || !this.cur || !this.rate || !this.visible || this.finished) return;
    this.clock += this.rate * 0.1;
    this.clockUpd();
  }
  clockUpd() {
    const s = this.st[this.cur];
    const c = this.q("[data-air-clock]"); if (c && s && s.a != null && this.cur) c.textContent = mmss(this.clock - s.a);
    this.metaUpd(); this.tl();
  }
  metaUpd() {
    const set = (k, h) => { const el = this.q(`[data-m="${k}"]`); if (el) el.innerHTML = h; };
    const idx = STAGES.findIndex(([k]) => k === this.cur);
    const v = variants();
    set("elapsed", mmss(this.clock));
    set("stage", this.finished ? `13 <small>of 13</small>` : `${idx + 1} <small>of ${STAGES.length}</small>`);
    set("flows", this.picked ? `${this.picked} <small>of ${JOB.reported} approved</small>` : `${JOB.reported} <small>reported</small>`);
    set("videos", `${v.length} <small>at 1080p</small>`);
    set("rec", opts.mode === 2 ? `Fallback <small>4–6 fps</small>` : `${["Live", "Studio"][opts.mode]} <small>60 fps</small>`);
  }
  facts() {
    const v = variants();
    const sizes = [...new Set(v.map((x) => x.size))].join(" and "), langs = [...new Set(v.map((x) => x.lang))].join(" and ");
    const rows = [
      ["Link", JOB.url],
      ["Video", `${JOB.kind}, ${opts.music ? "music-led" : "narrated"}`],
      ["Outputs", `${v.length} ${v.length === 1 ? "video" : "videos"}: ${sizes} in ${langs}`],
      ["Recording", `${MODES[opts.mode][0].toUpperCase() + MODES[opts.mode].slice(1)}, ${opts.mode === 2 ? "4–6" : "60"} fps`],
      ["Voice", opts.music ? "None, the music leads" : JOB.voice],
      ["Review gates", opts.gates ? (this.autopilot ? "On, approved on autopilot here" : "Flows, script and preview") : "Off: runs on autopilot"],
    ];
    this.q("[data-facts]").innerHTML = rows.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join("");
  }
  log(msg, t = this.clock) {
    this.feedItems.unshift([mmss(t), msg]);
    const ol = this.q("[data-feed]"); if (!ol) return;
    ol.innerHTML = this.feedItems.slice(0, 6).map(([t, m]) => `<li><time>${t}</time><span>${esc(m)}</span></li>`).join("");
    this.q("[data-feed-n]").textContent = `${this.feedItems.length} events · latest first`;
  }
  tl() {
    const track = this.q("[data-track]"); if (!track) return;
    let x = 0; const parts = [];
    for (const [k, label, gate] of STAGES) {
      const s = this.st[k];
      let a, b, cls = s.s;
      if (s.s === "pending") { a = x; b = x + DUR[k]; }
      else { a = s.a; b = s.b ?? this.clock; }
      if (k === "voice" && s.s === "pending" && opts.music) b = a;
      x = b;
      parts.push({ k, label, gate, a, b, cls });
    }
    const T = Math.max(60, x), W = track.clientWidth || 1;
    const step = [30, 60, 120, 180, 300, 600].find((st) => (st / T) * W >= 56) ?? 600;
    let ticks = "";
    for (let t = 0; t <= T - step * 0.4; t += step) ticks += `<span style="left:${(t / T) * 100}%">${mmss(t)}</span>`;
    this.q("[data-ruler]").innerHTML = ticks;
    track.innerHTML = parts.map((p) => {
      const w = ((p.b - p.a) / T) * 100, px = (w / 100) * W;
      const state = p.cls === "skipped" || (p.cls === "pending" && p.b === p.a) ? "skipped" : p.cls === "cancelled" ? "done" : p.cls;
      const lab = p.cls === "pending" ? `about ${took(p.b - p.a)}` : p.cls === "skipped" ? "skipped" : took(p.b - p.a);
      return `<div class="clip ${state} ${p.gate ? "gate" : ""} ${px < 44 ? "narrow" : ""}" style="left:${(p.a / T) * 100}%;width:calc(${w}% - 2px)" title="${p.label}: ${lab}"><b>${p.label}</b><span>${lab}</span></div>`;
    }).join("") + (this.finished ? "" : `<div class="playhead" style="left:${(this.clock / T) * 100}%"></div>`);
    this.q("[data-tl-sum]").textContent = this.finished ? `${mmss(this.clock)} start to finish` : `${mmss(this.clock)} so far · about ${mmss(T)} in all`;
  }

  /* ── the field ── */
  async show(o) {
    const gen = this.gen, air = this.q(".air"), inner = this.q(".air-in");
    const animate = G && !RM;
    if (animate) {
      await G.to(inner, { autoAlpha: 0, y: -10, duration: 0.22, ease: "power2.in" });
      if (air.dataset.state !== o.state) {
        const sw = document.createElement("div"); sw.className = "air-sweep"; sw.dataset.state = o.state; air.prepend(sw);
        await G.fromTo(sw, { scaleX: 0 }, { scaleX: 1, duration: 0.75, ease: "expo.inOut" });
        air.dataset.state = o.state; sw.remove();
      }
    } else air.dataset.state = o.state;
    if (gen !== this.gen) return;
    this.q("[data-air-h]").textContent = o.title;
    this.q("[data-air-lead]").textContent = o.lead;
    this.q("[data-air-clock]").textContent = o.clock ?? "0:00";
    this.q("[data-air-sub]").textContent = o.sub ?? "";
    this.q("[data-air-body]").innerHTML = o.body ?? "";
    if (animate) {
      G.fromTo(inner, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "expo.out" });
      G.fromTo(this.q("[data-air-h]"), { yPercent: 105 }, { yPercent: 0, duration: 0.9, ease: "expo.out" });
    }
  }
  begin(k, realMs) {
    this.cur = k; this.st[k] = { s: "running", a: this.clock };
    this.rate = realMs ? DUR[k] / (realMs / 1000) : 1;
    this.metaUpd(); this.tl();
  }
  end(k, msg) {
    const s = this.st[k];
    if (s.s === "running" && DUR[k] && this.rate !== 1) this.clock = s.a + DUR[k];
    Object.assign(s, { s: "done", b: this.clock });
    this.rate = 0;
    if (msg) this.log(msg);
    this.metaUpd(); this.tl();
  }
  finding(t) { this.q("[data-finding]").textContent = t; }
  sub(k, extra) { return `in this stage · ${extra ?? `usually ${took(DUR[k])}`}`; }

  async gate(k, title, lead, body, approveLabel, gen, wire) {
    if (!opts.gates) {
      this.cur = k; this.st[k] = { s: "done", a: this.clock, b: this.clock };
      this.log(`${title}: approved on autopilot`); this.tl();
      return;
    }
    this.cur = k; this.st[k] = { s: "waiting", a: this.clock }; this.rate = 1;
    await this.show({ state: "wait", title, lead, sub: "waiting on you", body: body + `<div class="rv-foot">${wire.extra ?? ""}<span class="spacer"></span><span class="cd" data-cd></span><button type="button" class="ab ab-f" data-approve>${approveLabel} <span class="arr" aria-hidden="true">→</span></button></div>` });
    if (gen !== this.gen) throw 0;
    this.metaUpd(); this.tl();
    const btn = this.q("[data-approve]");
    wire.after?.(btn);
    await new Promise((resolve, reject) => {
      btn.addEventListener("click", resolve, { once: true });
      if (this.autopilot) {
        const cd = this.q("[data-cd]");
        (async () => { for (let n = 4; n > 0; n--) { if (cd) cd.textContent = `Approving on autopilot in ${n} s`; await this.wait(1000, gen); } resolve(); })().catch(reject);
      }
      const chk = setInterval(() => { if (gen !== this.gen) { clearInterval(chk); reject(0); } }, 300);
    });
    if (gen !== this.gen) throw 0;
    Object.assign(this.st[k], { s: "done", b: this.clock }); this.rate = 0;
  }

  async run(gen) {
    const v = () => variants();
    /* Try flows: the multiview */
    const states = AGENTS.map((a) => ({ items: a.start.map((x) => [...x]), filter: 0, typing: "", editing: -1, cx: 18, cy: 2, frames: [] }));
    const realFlows = 11000;
    this.begin("flow-runs", realFlows);
    this.finding("Explore found 11 flows. The judge sent the best 3 to be tried, one agent each.");
    await this.show({
      state: "run", title: "Trying flows", sub: this.sub("flow-runs"),
      lead: "Three agents work through the flows side by side. Each one is replayed in local Chrome before you see it.",
      body: `<div class="mv">${AGENTS.map((a, i) => `<article class="mon" data-agent="${i}">
        <div class="mon-h"><b>Agent ${i + 1}</b><span class="tally" data-tally><i></i><span>waiting</span></span></div>
        <p class="goal">${esc(a.goal)}</p>
        <div class="browser" data-ui><div class="bar"><i></i><i></i><i></i><span>${JOB.url}${i === 1 ? "/#/" : ""}</span></div><div data-view>${tmHTML(states[i], { cursor: true })}</div></div>
        <ol class="alog" data-alog></ol></article>`).join("")}</div>`,
    });
    if (gen !== this.gen) return;
    const pos = (s, kind, arg) => {
      const rowsTop = 6.2, row = 2.3;
      if (kind === "focus" || kind === "add") return [8, 4.9];
      if (kind === "toggle") return [2.1, rowsTop + arg * row];
      if (["fix", "warn", "rename", "commit"].includes(kind)) return [8, rowsTop + (arg ?? 1) * row];
      if (kind === "filter") { const n = s.items.filter((it) => arg === 0 || (arg === 1 ? !it[1] : it[1])).length; return [[17, 21, 26][arg], rowsTop + n * row + 0.6]; }
      return [18, 2];
    };
    const agentRun = async (i) => {
      const a = AGENTS[i], s = states[i], el = this.q(`[data-agent="${i}"]`);
      const view = el.querySelector("[data-view]"), alog = el.querySelector("[data-alog]"), tally = el.querySelector("[data-tally]");
      await this.wait(300 + i * 600, gen);
      for (let k = 0; k < a.steps.length; k++) {
        const [kind, msg, arg, arg2] = a.steps[k];
        tally.className = "tally live"; tally.lastChild.textContent = `live · step ${k + 1} of ${a.steps.length}`;
        [s.cx, s.cy] = pos(s, kind, kind === "warn" ? 1 : arg);
        if (kind === "add") { for (let c = 1; c <= arg.length; c += 3) { s.typing = arg.slice(0, c); view.innerHTML = tmHTML(s, { cursor: true }); await this.wait(70, gen); } s.typing = ""; s.items.push([arg, 0]); }
        if (kind === "toggle") s.items[arg][1] = 1;
        if (kind === "filter") s.filter = arg;
        if (kind === "fix") s.editing = arg;
        if (kind === "rename") s.items[arg][0] = arg2;
        if (kind === "commit") s.editing = -1;
        view.innerHTML = tmHTML(s, { cursor: true });
        view.querySelector(".cursor")?.classList.add("click");
        const li = document.createElement("li"); li.textContent = msg; if (kind === "warn") li.className = "warn"; if (kind === "fix") li.className = "fix";
        alog.append(li); while (alog.children.length > 5) alog.firstChild.remove();
        if (kind === "warn") { this.log(`Agent ${i + 1}: ${msg}`); this.finding("Agent 3 needed one repair: the double-click missed, so it tried the label. The other two ran clean."); }
        if ([0, Math.floor(a.steps.length / 3) + 1, Math.floor(a.steps.length / 2) + 1, a.steps.length - 1].includes(k)) s.frames.push(tmHTML(s));
        await this.wait(1150 + Math.random() * 300, gen);
      }
      tally.className = "tally ok"; tally.lastChild.textContent = "replays locally";
      this.log(`Agent ${i + 1} finished: “${a.goal}”`);
    };
    await Promise.all(AGENTS.map((_, i) => agentRun(i)));
    this.end("flow-runs", "3 flows ready for review");

    /* Gate 1: flows */
    const frames = (i) => states[i].frames.slice(0, 4).map((f) => `<span class="fr" data-ui>${f}</span>`).join("");
    this.finding("3 flows replayed in local Chrome. Nothing is filmed until you approve them.");
    await this.gate("gate-flows", "Review flows", "Pick what gets filmed. These are the frames each flow reached when it replayed.",
      `<div class="rv">${AGENTS.map((a, i) => `<label class="rv-row"><input class="chk" type="checkbox" checked data-pick><span><b>${esc(a.goal)}</b><small>${fmt(FLOW_S[i])} · ${a.steps.length} steps · judge score ${JUDGE[i]}</small></span><span class="frames">${frames(i)}</span></label>`).join("")}</div>`,
      "Approve 3 flows", gen, {
        extra: `<label class="sr" for="another-${this.autopilot ? "a" : "b"}">Describe another flow</label><input id="another-${this.autopilot ? "a" : "b"}" placeholder="Describe another flow, like “clear the completed todos”"><button type="button" class="ab ab-f2" data-add>Send to an agent</button>`,
        after: (btn) => {
          const picks = $$("[data-pick]", this.root);
          picks.forEach((p) => p.addEventListener("change", () => { p.closest(".rv-row").classList.toggle("off", !p.checked); const n = picks.filter((x) => x.checked).length; btn.firstChild.textContent = `Approve ${n} flow${n === 1 ? "" : "s"} `; btn.disabled = n === 0; }));
          this.q("[data-add]").addEventListener("click", () => { const inp = this.q(".rv-foot input"); const t = inp.value.trim(); if (!t) { inp.focus(); return; } this.log(`Sent to a fourth agent: “${t}”`); inp.value = ""; inp.placeholder = "Sent. A fourth agent is trying it now."; });
        },
      });
    const picked = $$("[data-pick]", this.root).map((p, i) => (p.checked ? i : -1)).filter((i) => i >= 0);
    this.picked = picked.length || 3; const use = picked.length ? picked : [0, 1, 2];
    this.log(`Approved ${this.picked} flows`); this.metaUpd();

    /* Record */
    this.begin("record", 3400);
    this.finding(`Filming the ${this.picked} flows you approved${opts.gates ? ". You’ll see the script before any voice is recorded." : "."}`);
    await this.show({
      state: "run", title: "Recording", sub: this.sub("record"),
      lead: `Each approved flow replays in a local Chromium and is filmed in ${MODES[opts.mode]}, at 1920 × 1080.`,
      body: `<div class="takes">${use.map((i) => `<div class="take"><div class="mon-h"><b>Take ${i + 1}</b><span class="tally live" data-rec><i></i><span>rec</span></span></div><p class="goal">${esc(AGENTS[i].goal)}</p><div class="browser" data-ui><div class="bar"><i></i><i></i><i></i><span>${JOB.url}</span></div>${states[i].frames.at(-1)}</div><div class="bar2"><i data-tb></i></div><p class="fc"><span data-fc>frame 0 of ${FLOW_S[i] * 60}</span><span>${fmt(FLOW_S[i])}</span></p></div>`).join("")}</div>`,
    });
    if (gen !== this.gen) return;
    const tbs = $$("[data-tb]", this.root), fcs = $$("[data-fc]", this.root);
    if (G && !RM) tbs.forEach((b, j) => G.to(b, { scaleX: 1, duration: 3.2 * (FLOW_S[use[j]] / 9), ease: "none", onUpdate() { fcs[j].textContent = `frame ${Math.round(this.progress() * FLOW_S[use[j]] * 60)} of ${FLOW_S[use[j]] * 60}`; }, onComplete() { const r = fcs[j].closest(".take").querySelector("[data-rec]"); r.className = "tally ok"; r.lastChild.textContent = "kept"; } }));
    await this.wait(3400, gen);
    this.end("record", `Recorded ${this.picked} takes at 60 fps`);

    /* Script */
    const beatsHTML = (extra = "") => `<div class="beats">${BEATS.map((b, i) => `<div class="beat ${b.card ? "card" : ""}" style="flex:${b.s}" data-beat="${i}"><h3><span>${b.name}</span><span>${fmt(b.s)}</span></h3><p data-line>${extra === "type" ? "" : esc(b.line)}</p>${extra === "wave" ? `<div class="wave">${Array.from({ length: 18 }, (_, k) => `<i style="height:${20 + Math.abs(Math.sin(i * 3 + k * 0.9)) * 80}%"></i>`).join("")}</div>` : ""}</div>`).join("")}</div>`;
    this.begin("script", 2600);
    this.finding(`Writing a ${fmt(CUT_S)} cut: ${BEATS.length} beats, one per approved flow plus a title and an end card.`);
    await this.show({ state: "run", title: "Writing", sub: this.sub("script"), lead: "The storyboard first, then the lines, sized to what each shot can carry.", body: beatsHTML("type") });
    if (gen !== this.gen) return;
    const lines = $$("[data-line]", this.root);
    for (let i = 0; i < BEATS.length; i++) {
      const words = BEATS[i].line.split(" ");
      for (let w = 1; w <= words.length; w++) { lines[i].textContent = words.slice(0, w).join(" "); await this.wait(45, gen); }
      await this.wait(120, gen);
    }
    await this.wait(400, gen);
    this.end("script", `Script written: ${BEATS.length} beats, ${fmt(CUT_S)}`);

    /* Gate 2: script */
    this.finding("The script is ready. Approve it and the voice is recorded next.");
    await this.gate("gate-script", "Review the script", "Read it as it will be heard. Ask for a change in plain words, or approve it.", beatsHTML(), "Approve the script", gen, {
      extra: `<label class="sr" for="sc-${this.autopilot ? "a" : "b"}">Ask for a change to the script</label><input id="sc-${this.autopilot ? "a" : "b"}" placeholder="Ask for a change, like “make the title shorter”">`,
    });
    this.log("Script approved");

    /* Voice */
    if (opts.music) {
      this.cur = "voice"; this.st.voice = { s: "skipped", a: this.clock, b: this.clock }; this.log("Voice skipped: the music leads"); this.tl();
    } else {
      this.begin("voice", 2200);
      this.finding(`Recording ${BEATS.length * (opts.hindi ? 2 : 1)} clips with word timings, so every caption lights up on its word.`);
      await this.show({ state: "run", title: "Voicing", sub: this.sub("voice"), lead: `${JOB.voice.split(" ")[0]} reads each beat${opts.hindi ? " in English and Hindi" : ""}. Every word gets a timestamp.`, body: beatsHTML("wave") });
      if (gen !== this.gen) return;
      if (G && !RM) G.from($$(".wave i", this.root), { scaleY: 0.1, duration: 0.5, ease: "expo.out", stagger: { each: 0.012 } });
      await this.wait(2200, gen);
      this.end("voice", `Voice: ${BEATS.length * (opts.hindi ? 2 : 1)} clips, timings checked`);
    }

    /* Direct */
    this.begin("direct", 3000);
    this.finding("Claude Code is improving the baseline edit, then checking it with the motion lint.");
    await this.show({ state: "run", title: "Directing", sub: this.sub("direct"), lead: "Cuts follow the voice. Shots hold, cards stretch and the spotlight goes where the action is.", body: beatsHTML() + `<ol class="notes" data-notes></ol>` });
    if (gen !== this.gen) return;
    const notes = this.q("[data-notes]");
    for (const [n, t] of NOTES) { notes.insertAdjacentHTML("beforeend", `<li><span>${esc(n)}</span><span>${t}</span></li>`); await this.wait(650, gen); }
    this.end("direct", "Director: 2 repair rounds, motion lint passed");

    /* Preview */
    const screenHTML = `<div class="pv"><div class="screen" data-screen data-ui><span class="tc" data-tc>0:00 / ${fmt(CUT_S)}</span>${states[0].frames.at(-1)}<p class="cap" data-cap></p><span class="prog"><i data-prog style="transform:scaleX(0)"></i></span></div>
      <ol class="blist">${BEATS.map((b, i) => `<li data-bl="${i}"><time>${fmt(BEATS.slice(0, i).reduce((a, x) => a + x.s, 0))}</time><span>${esc(b.line)}</span></li>`).join("")}</ol></div>`;
    this.begin("preview", 2200);
    this.finding("A 540p preview, with captions timed word by word.");
    await this.show({ state: "run", title: "Previewing", sub: this.sub("preview"), lead: "A quick 540p render so you can watch the whole cut before the full one.", body: screenHTML });
    if (gen !== this.gen) return;
    this.play(gen);
    await this.wait(2200, gen);
    this.end("preview", `Preview ready: ${fmt(CUT_S)} at 540p`);

    /* Gate 3: preview */
    this.finding("Watch the preview. Approve it to render every size and language.");
    await this.gate("gate-preview", "Review the preview", "Describe a change in plain words and the director revises the edit, or approve it.", screenHTML, `Approve and render ${v().length}`, gen, {
      extra: `<label class="sr" for="pc-${this.autopilot ? "a" : "b"}">Ask the director for a change</label><input id="pc-${this.autopilot ? "a" : "b"}" placeholder="Ask for a change, like “hold longer on the filters”"><button type="button" class="ab ab-f2" data-rev>Send to the director</button>`,
      after: () => {
        this.play(gen);
        this.q("[data-rev]").addEventListener("click", async () => { const inp = this.q(".rv-foot input"); const t = inp.value.trim(); if (!t) { inp.focus(); return; } inp.value = ""; inp.placeholder = "The director is revising the edit…"; this.log(`Change asked: “${t}”`); await sleep(1600); if (inp.isConnected) { inp.placeholder = "Revised and checked. Watch it again."; this.log("Director revised the edit; motion lint passed"); } });
      },
    });
    this.log("Preview approved");

    /* Render */
    const outs = v();
    this.begin("render", 3200);
    this.finding(`Rendering ${outs.length} ${outs.length === 1 ? "video" : "videos"} at 1080p.`);
    await this.show({ state: "run", title: "Rendering", sub: this.sub("render"), lead: "HyperFrames renders every size and language from the one approved edit.",
      body: outs.map((x) => `<div class="vr"><span><b>${JOB.host.split(".")[0]}-launch-${x.size.replace(":", "x")}-${x.lang.slice(0, 2).toLowerCase()}.mp4</b><small>${x.size === "16:9" ? "1920 × 1080" : "1080 × 1920"} · ${x.lang}</small></span><span class="bar2"><i data-rb></i></span><span class="pct" data-rp>0%</span></div>`).join("") });
    if (gen !== this.gen) return;
    const rbs = $$("[data-rb]", this.root), rps = $$("[data-rp]", this.root);
    if (G && !RM) rbs.forEach((b, j) => G.to(b, { scaleX: 1, duration: 2.6 + j * 0.25, ease: "power1.inOut", onUpdate() { rps[j].textContent = Math.round(this.progress() * 100) + "%"; } }));
    else rps.forEach((p) => (p.textContent = "100%"));
    await this.wait(3200, gen);
    this.end("render", `Rendered ${outs.length} ${outs.length === 1 ? "video" : "videos"}`);

    /* Done */
    this.finished = true; this.cur = null;
    const total = STAGES.reduce((a, [k]) => a + ((this.st[k].b ?? 0) - (this.st[k].a ?? 0)), 0);
    console.assert(Math.abs(total - this.clock) < 0.01, "stage times should add up to the elapsed time", total, this.clock);
    this.q("[data-ttl-act]").innerHTML = "";
    this.finding(`${outs.length} ${outs.length === 1 ? "video" : "videos"} rendered from the real product in ${took(this.clock)}.`);
    this.log("Job finished");
    this.metaUpd(); this.tl();
    await this.show({ state: "done", title: "Ready", clock: fmt(CUT_S), sub: "each video", lead: "Filmed on the real product, cut to the voice, captioned word by word.",
      body: `<div class="done-grid"><div><div class="outs2">${outs.map((x) => `<div class="outv"><button type="button" data-ui class="th ${x.size === "9:16" ? "v" : "w"}" aria-label="Play the ${x.size} ${x.lang} video"><span class="thf">${states[0].frames.at(-1)}</span><span class="thc">${x.lang === "Hindi" ? "आपकी सूची, सरल।" : esc(BEATS[0].line)}</span></button><span><b>${x.size} · ${x.lang}</b><small>${x.size === "16:9" ? "1920 × 1080" : "1080 × 1920"} · ${fmt(CUT_S)}</small></span></div>`).join("")}</div>
        <div class="done-act"><button type="button" class="ab ab-f" data-rerun>Re-run on latest UI <span class="arr" aria-hidden="true">→</span></button><a class="ab ab-f2" href="#top">Make another video</a></div></div>
        <div><h3 class="done-h">In the cut</h3><ol class="blist">${BEATS.map((b, i) => `<li><time>${fmt(BEATS.slice(0, i).reduce((a, x) => a + x.s, 0))}</time><span>${esc(b.line)}</span></li>`).join("")}</ol></div></div>` });
    this.q("[data-rerun]")?.addEventListener("click", () => this.start());
    if (this.autopilot) { await this.wait(8000, gen); this.start(); }
  }
  async play(gen) {
    const cap = this.q("[data-cap]"); if (!cap) return;
    const tc = this.q("[data-tc]"), prog = this.q("[data-prog]"), el = cap;
    let t0 = 0;
    while (el.isConnected && gen === this.gen) {
      for (let i = 0; i < BEATS.length && el.isConnected; i++) {
        const words = BEATS[i].line.split(" ");
        cap.innerHTML = words.map((w) => `<span>${esc(w)}</span>`).join(" ");
        $$("[data-bl]", this.root).forEach((li) => li.classList.toggle("on", +li.dataset.bl === i));
        const spans = $$("span", cap), per = Math.min(420, (BEATS[i].s * 1000) / words.length / 3);
        for (let w = 0; w < spans.length && el.isConnected; w++) {
          spans.forEach((s, k) => s.classList.toggle("on", k === w));
          const vt = t0 + (BEATS[i].s * (w + 1)) / spans.length;
          tc.textContent = `${fmt(Math.floor(vt))} / ${fmt(CUT_S)}`; prog.style.transform = `scaleX(${vt / CUT_S})`;
          await sleep(RM ? 600 : per);
        }
        t0 += BEATS[i].s;
      }
      t0 = 0;
    }
  }
}

/**
 * Mounts the sample run in `root`. `settings` mirrors the landing page's switches; call the returned
 * `update` when they change and `destroy` on unmount.
 */
export function mountDemo(root, settings) {
  Object.assign(opts, settings);
  const sim = new JobSim(root, { autopilot: true });
  let alive = true, raf = 0;
  const dust = (now) => {
    if (!alive) return;
    const d = sim.dust;
    if (d && d.c && d.c.isConnected && sim.visible) {
      const c = d.c, r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
        c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
        d.dots = Array.from({ length: Math.round((r.width * r.height) / 9000) }, () => ({ x: Math.random() * r.width, y: Math.random() * r.height, z: rand(0.3, 1) }));
      }
      const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.height);
      const state = c.parentElement.dataset.state;
      x.fillStyle = state === "wait" ? "#05060f" : state === "done" ? "#1423b8" : "#ffffff";
      const t = now * 0.0002;
      for (const p of d.dots) {
        if (!RM) { const a = Math.sin(p.x * 0.004 + t) * Math.cos(p.y * 0.005 - t) * 6.28; p.x += Math.cos(a) * 0.25 * p.z; p.y += Math.sin(a) * 0.25 * p.z; }
        if (p.x < 0) p.x = r.width; if (p.x > r.width) p.x = 0; if (p.y < 0) p.y = r.height; if (p.y > r.height) p.y = 0;
        x.globalAlpha = 0.12 + 0.3 * p.z; const s = 0.8 + p.z * 1.4; x.fillRect(p.x, p.y, s, s);
      }
    }
    if (!RM) raf = requestAnimationFrame(dust);
  };
  raf = requestAnimationFrame(dust);
  return {
    update(next) {
      Object.assign(opts, next);
      if (root.querySelector("[data-facts]")) { sim.facts(); sim.metaUpd(); sim.tl(); }
    },
    destroy() {
      alive = false; cancelAnimationFrame(raf);
      sim.gen++; clearInterval(sim.timer); sim.io.disconnect();
      root.innerHTML = "";
    },
  };
}
