import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Edl, ShotSegment, TimelineEvent } from "@agentcast/shared";
import { sfxCues } from "../audio.ts";
import { voiceCaptions } from "../captions.ts";
import { cameraAt, project, zoomOf, type Size } from "../camera.ts";
import { contrastOf, ink, luminanceOf, mixHex, readableOn } from "../ink.ts";
import { calloutSeconds, eased } from "../motion.ts";
import { cursorAt, planParts, type Part, type VideoInput } from "../plan.ts";
import { clockOf } from "../retime.ts";
import { localFonts } from "./fonts.ts";
import { run } from "./render.ts";
import {
  SHARED_CSS,
  captionsScene,
  esc,
  groundScene,
  kineticScene,
  montageScene,
  outroScene,
  shotScene,
  statScene,
  titleScene,
  type Vars,
} from "./scenes.ts";

// compileComposition(): one variant of the edit as a HyperFrames project (PRD §9.8, §9.7.5). The plan
// (planParts) places every part, so the voice still sets the timing; the catalogue (scenes.ts) draws
// each part unless the director wrote that part's scene file, which is kept as it is.

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

export type CompiledScene = { id: string; kind: string; start: number; duration: number; custom: boolean };

export type CompileOptions = {
  input: VideoInput;
  /** The job folder the input's paths are relative to. */
  root: string;
  /** The composition folder to write. */
  out: string;
  /**
   * The director's scene files (`<id>.html`), used instead of the catalogue's. A file whose hash is
   * the one `compiled.json` beside the folder recorded is the catalogue's own and is made afresh.
   */
  scenes?: string;
  signal?: AbortSignal;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const textIn = (text: Record<string, string> | undefined, lang: string) =>
  text ? (text[lang] ?? text.en ?? Object.values(text)[0] ?? "") : "";

/** The canvas for a variant: 960×540 for the preview, 1920×1080 for finals, portrait for 9:16. */
export function canvasOf(aspect: VideoInput["aspect"], height: number) {
  const short = height <= 540 ? 540 : 1080;
  const size = aspect === "16x9" ? { w: Math.round((short * 16) / 9), h: short } : { w: short, h: Math.round((short * 16) / 9) };
  return { ...size, u: short / 1080 };
}

const STOP = new Set(
  "the a an and or of to in on for with your you our we is are be it its at by from as that this into every all any one".split(" "),
);

/** The word a headline accents when the storyboard didn't pick one: its last strong word. */
export function accentOf(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!.replace(/[^\p{L}\p{N}-]/gu, "");
    if (w.length >= 4 && !STOP.has(w.toLowerCase())) return w;
  }
  return words.at(-1) ?? "";
}

/** How colourful a colour is (0 grey … 1 pure hue). */
function saturation(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** The brand as CSS custom properties (PRD §9.7.3): the palette, glows, field, chips and inks. */
function themeOf(edl: Edl) {
  const { bg, fg } = edl.style.palette;
  const dark = luminanceOf(bg) < 0.4;
  // An accent that is just the text colour gives no two-tone; dim it instead (LangEase "Turn Books").
  const accent = contrastOf(edl.style.palette.accent, fg) < 1.5 ? mixHex(fg, bg, 0.48) : edl.style.palette.accent;
  const colourful = saturation(accent) > 0.25 && luminanceOf(accent) > 0.03 && luminanceOf(accent) < 0.92;
  const accent2 = edl.style.palette.accent2 ?? (colourful ? mixHex(accent, "#ff4fa3", 0.45) : mixHex(fg, bg, 0.35));
  const surface = edl.style.palette.surface ?? mixHex(bg, fg, 0.04);
  // Greyscale brands alternate the opposite tone: cream on a dark brand, ink on a light one (Lovable).
  const field = colourful ? accent : dark ? mixHex(fg, "#f3efe8", 0.4) : "#111114";
  const chip = colourful ? accent : fg;
  // Dark brands need brighter glows, or dark footage disappears into the backdrop.
  const glow1 = colourful ? accent : mixHex(bg, fg, dark ? 0.3 : 0.16);
  const glow2 = colourful ? accent2 : mixHex(bg, fg, dark ? 0.2 : 0.09);
  const glow3 = colourful ? mixHex(accent, bg, 0.5) : mixHex(bg, fg, dark ? 0.12 : 0.06);
  return {
    colourful,
    vars: {
      "--ac-bg": bg,
      "--ac-fg": fg,
      "--ac-accent": colourful ? readableOn(accent, bg, 1.6) : accent,
      "--ac-accent2": accent2,
      "--ac-accent-dark": readableOn(accent, "#0b0b10", 3),
      "--ac-surface": surface,
      "--ac-field": field,
      "--ac-on-field": ink(field),
      "--ac-chip": chip,
      "--ac-on-chip": ink(chip),
      "--ac-glow1": glow1,
      "--ac-glow2": glow2,
      "--ac-glow3": glow3,
      // Pill buttons (9999) shouldn't make pill windows.
      "--ac-radius": `${Math.min(edl.style.look.radius, 28)}px`,
      // A hairline rim keeps a window's edge readable on its own colour (dark UI on a dark brand).
      "--ac-rim": dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)",
    } as Record<string, string>,
  };
}

/** Links a job file into the composition (a hard link on the same disk, else a copy). */
async function place(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  await rm(to, { force: true });
  await link(from, to).catch(() => copyFile(from, to));
}

const sha = (text: string) => createHash("sha1").update(text).digest("hex");

/**
 * The scene files the director changed or added, read before the composition is rebuilt (the folder
 * may be the composition's own). Their canvas size is set to this variant's.
 */
async function customScenes(dir: string | undefined, size: Size): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!dir) return out;
  const names = await readdir(dir).catch(() => [] as string[]);
  const compiled = await readFile(join(dir, "..", "compiled.json"), "utf8").then(
    (text) => JSON.parse(text) as Record<string, string>,
    () => ({}) as Record<string, string>,
  );
  for (const name of names.filter((n) => n.endsWith(".html"))) {
    const id = name.slice(0, -".html".length);
    const text = await readFile(join(dir, name), "utf8");
    if (compiled[id] === sha(text)) continue;
    out.set(id, text.replace(/data-width="\d+"/g, `data-width="${size.w}"`).replace(/data-height="\d+"/g, `data-height="${size.h}"`));
  }
  return out;
}

const sceneIdOf = (id: string, i: number) =>
  /^[a-z][a-z0-9-]*$/i.test(id) && !["ground", "captions", "main", "root"].includes(id) ? id : `part-${i}`;

/** The page's address at source second `t`, without the scheme. */
function urlAt(events: TimelineEvent[], t: number) {
  let url = "";
  for (const e of events) if (e.t <= t && e.url) url = e.url;
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/^www\./, "").replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * A shot's paths, sampled at 10 Hz on the output clock: the camera over the footage, the window's
 * tilt and opening, the cursor, clicks, callouts and lower thirds (all in canvas pixels).
 */
function shotVars(input: VideoInput, shot: ShotSegment, part: Extract<Part, { kind: "segment" }>, canvas: Size & { u: number }) {
  const { edl, footage, lang } = input;
  const { motion, look } = edl.style;
  const fps = edl.fps;
  const src: Size = { w: footage.timeline.viewport.w, h: footage.timeline.viewport.h };
  const aspect = canvas.w / canvas.h;
  const view: Size = { w: canvas.w, h: canvas.h };
  const clock = clockOf(shot);
  const dur = part.frames / fps;
  const lastSource = Math.max(0, (part.frames - part.hold - 1) / fps);
  const sourceAt = (o: number) => clock.toSource(Math.min(o, lastSource));
  const tall = input.aspect === "9x16";
  const windowed = edl.style.frame !== "none" && !tall;
  const tilt = edl.style.frame === "tilt" && windowed;
  const enter = part.enter.frames / fps;
  const events = footage.timeline.events;
  const cam: number[][] = [];
  const win: number[][] = [];
  const bar: number[][] = [];
  const cursor: number[][] = [];
  const times: number[] = [];
  for (let o = 0; o < dur; o += 0.1) times.push(r3(o));
  times.push(r3(dur));
  for (const o of times) {
    const t = sourceAt(o);
    const crop = cameraAt(shot.camera, t, src, aspect, motion);
    const s = canvas.w / crop.w;
    cam.push([o, r1(-crop.x * s), r1(-crop.y * s), r3(s)]);
    const open = windowed ? Math.min(1, Math.max(0, eased(motion, (zoomOf(crop, src, aspect) - 1.02) / 0.23))) : 1;
    const closed = 1 - open;
    // The window arrives from depth over ~1.6 s (LangEase 15.8 s), drifts while wide, flattens open.
    const arrive = Math.min(1, Math.max(0, eased(motion, (o - enter * 0.5) / 1.6)));
    const drift = Math.sin((part.from / fps + o) / 4);
    // Always pushing in a little (more while wide), so a held or static page never stands still.
    // Past the footage (the voice still talking) the push speeds up, so the held frame keeps moving.
    const held = Math.max(0, o - lastSource);
    const push = (1 + (0.035 + closed * 0.03) * (o / dur)) * (1 + 0.05 * held);
    if (tilt)
      win.push([
        o,
        r3(closed * (7 + 1.5 * drift) + (1 - arrive) * 20),
        r3(closed * (-10 + 2 * drift) - (1 - arrive) * 10),
        r3(closed * 1.5 + (1 - arrive) * 3),
        r3((0.8 + 0.2 * open) * push * (0.9 + 0.1 * arrive)),
        r1((1 - arrive) * 120 * canvas.u),
        r1(Math.min(look.radius, 28) * 1.4 * canvas.u * closed),
      ]);
    else if (windowed)
      win.push([o, 0, 0, 0, r3((0.86 + 0.14 * open) * push), r1((1 - arrive) * 50 * canvas.u), r1(Math.min(look.radius, 28) * 1.4 * canvas.u * closed)]);
    // Full bleed (9:16): a slow push-in so the frame never holds still.
    else win.push([o, 0, 0, 0, r3(1 + 0.035 * (o / dur)), 0, 0]);
    bar.push([o, r3(look.chrome === "browser" && windowed ? closed : 0)]);
    if (shot.cursor === "auto") {
      const c = cursorAt(events, t);
      const [x, y] = project([c.x, c.y], crop, view);
      cursor.push([o, r1(x), r1(y), c.visible ? 1 : 0]);
    }
  }
  const inShot = (t: number) => t >= shot.in && t <= shot.out;
  const pointAt = (t: number): [number, number] => {
    const crop = cameraAt(shot.camera, t, src, aspect, motion);
    const c = cursorAt(events, t);
    return project([c.x, c.y], crop, view);
  };
  const clicks =
    shot.cursor === "auto"
      ? events.filter((e) => e.kind === "click" && inShot(e.t)).map((e) => {
          const [x, y] = pointAt(e.t);
          return [r3(clock.toOutput(e.t)), r1(x), r1(y)];
        })
      : [];
  const vars: Vars = {
    cam: JSON.stringify(cam),
    win: JSON.stringify(win),
    bar: JSON.stringify(bar),
    cursor: JSON.stringify(cursor),
    clicks: JSON.stringify(clicks),
    chrome: look.chrome,
    url: urlAt(events, shot.in + 0.01),
  };
  const callouts = (shot.callouts ?? []).map((c, i) => {
    const crop = cameraAt(shot.camera, c.t, src, aspect, motion);
    const [x, y] = project([c.anchor[0], c.anchor[1]], crop, view);
    const text = textIn(c.text, lang);
    vars[`co${i}`] = text;
    return {
      t: r3(clock.toOutput(c.t)),
      secs: r3(calloutSeconds(text)),
      x: r1(Math.min(canvas.w * 0.7, Math.max(canvas.w * 0.04, x))),
      y: r1(Math.min(canvas.h * 0.85, Math.max(canvas.h * 0.08, y - 90 * canvas.u))),
    };
  });
  vars.callouts = JSON.stringify(callouts);
  const lowerThirds = (shot.lowerThirds ?? []).map((l, i) => {
    vars[`lt${i}`] = textIn(l.text, lang);
    return { t: r3(clock.toOutput(l.t)), secs: 2.2 };
  });
  vars.lowerThirds = JSON.stringify(lowerThirds);
  if (shot.title) {
    vars.title = textIn(shot.title.text, lang);
    vars.titleSecs = shot.title.seconds;
    vars.titleAccent = accentOf(String(vars.title));
  }
  // One footage clip per speed ramp; the last runs to the end of the part and holds its frame.
  const cuts = [shot.in, ...(shot.ramps ?? []).flatMap((r) => [r.from, r.to]), shot.out]
    .filter((t) => t >= shot.in && t <= shot.out)
    .sort((a, b) => a - b);
  const clips: { start: number; duration: number; mediaStart: number; rate: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i]!, cuts[i + 1]!];
    if (b - a < 0.02) continue;
    const ramp = (shot.ramps ?? []).find((r) => r.from <= a + 1e-6 && r.to >= b - 1e-6);
    const start = r3(clock.toOutput(a));
    clips.push({ start, duration: r3(clock.toOutput(b) - clock.toOutput(a)), mediaStart: r3(a), rate: ramp?.speed ?? 1 });
  }
  if (!clips.length) clips.push({ start: 0, duration: r3(dur), mediaStart: r3(shot.in), rate: 1 });
  const last = clips.at(-1)!;
  last.duration = r3(Math.max(last.duration, dur - last.start));
  return { vars, clips, src };
}

/** Compiles one variant; returns the composition's length and its scenes in playing order. */
export async function compileComposition(o: CompileOptions): Promise<{ duration: number; scenes: CompiledScene[] }> {
  const { input } = o;
  const { edl, lang } = input;
  const fps = edl.fps;
  const canvas = canvasOf(input.aspect, input.height);
  const size = { w: canvas.w, h: canvas.h };
  const { parts, clips, frames } = planParts(edl, input.narration);
  const duration = frames / fps;
  const theme = themeOf(edl);
  const personality = edl.style.motion.personality;
  const lively = personality === "energetic" || personality === "playful";

  const custom = await customScenes(o.scenes, size);
  const written: Record<string, string> = {};
  await rm(join(o.out, "compositions"), { recursive: true, force: true });
  await mkdir(join(o.out, "compositions"), { recursive: true });
  await mkdir(join(o.out, "assets"), { recursive: true });

  // Assets: GSAP and our runtime, the footage, the brand's logo and hero, the voice and the effects.
  await copyFile(require.resolve("gsap/dist/gsap.min.js"), join(o.out, "assets", "gsap.min.js"));
  await copyFile(join(here, "runtime.js"), join(o.out, "assets", "agentcast.js"));
  await place(join(o.root, input.footage.src), join(o.out, "assets", "footage.mp4"));
  const logo = input.brand.logo;
  if (logo) await place(join(o.root, logo.src), join(o.out, "assets", "logo.png"));
  const hero = input.brand.hero;
  if (hero) await place(join(o.root, hero), join(o.out, "assets", "hero.jpg"));

  // Fonts: the brand's families as local files; Inter always, Devanagari for Hindi.
  const { display, text } = edl.style.fonts;
  const fonts = await localFonts([display, text, "Inter", ...(lang === "hi" ? ["Noto Sans Devanagari"] : [])], o.out, o.signal);
  const stack = (family: string) =>
    [fonts.families.includes(family) ? family : undefined, "Inter", lang === "hi" ? "Noto Sans Devanagari" : undefined, "sans-serif"]
      .filter(Boolean)
      .map((f) => (f === "sans-serif" ? f : `"${f}"`))
      .join(", ");

  // Statements alternate grounds the way Lovable does (field, dark, clear); calm brands stay clearer.
  let statements = 0;
  const statementGround = () => {
    const cycle = lively ? ["field", "dark", "clear"] : ["clear", "dark", "clear"];
    const g = cycle[statements++ % cycle.length]!;
    // On a dark brand, "dark" is its own ground: alternate with the light field instead.
    return g === "dark" && edl.style.look.theme === "dark" ? "field" : g;
  };
  const openingGround = theme.colourful && lively ? "field" : edl.style.look.theme === "dark" ? "dark" : "clear";

  const scenes: CompiledScene[] = [];
  const hosts: string[] = [];
  for (const [i, part] of parts.entries()) {
    const id = sceneIdOf(part.id, i);
    const start = r3(part.from / fps);
    const dur = r3(part.frames / fps);
    const common: Vars = {
      dur,
      enter: part.enter.kind,
      enterSecs: r3(part.enter.frames / fps),
      exit: part.exit.kind,
      exitSecs: r3(part.exit.frames / fps),
    };
    let kind: string;
    let vars: Vars;
    let file: string | undefined;
    if (part.kind === "intro") {
      kind = "title";
      const title = input.copy.title && input.copy.title.trim() !== input.brand.name.trim() ? input.copy.title : "";
      // The split layout needs the hero and a wide frame; 9:16 centres.
      const wanted = edl.style.look.title === "split" && (!hero || input.aspect === "9x16") ? "center" : edl.style.look.title;
      const layout = input.aspect === "9x16" && wanted === "editorial" ? "center" : wanted;
      vars = {
        ...common,
        ground: openingGround,
        name: input.brand.name,
        title,
        accent: accentOf(title),
        site: input.brand.site,
        layout,
        // A wordmark logo already says the name (Linear's): show it big instead of typing it beside.
        logoHasName: Boolean(logo && logo.width / logo.height > 2.6),
      };
      file = titleScene(id, size, vars, { logo: Boolean(logo), hero: Boolean(hero) && layout === "split" });
    } else if (part.kind !== "segment") {
      kind = "outro";
      const cta = input.copy.cta ?? "";
      vars = {
        ...common,
        ground: openingGround,
        name: input.brand.name,
        cta,
        accent: accentOf(cta),
        site: input.brand.site,
        logoHasName: Boolean(logo && logo.width / logo.height > 2.6),
      };
      file = outroScene(id, size, vars, { logo: Boolean(logo) });
    } else {
      const segment = edl.segments[part.index]!;
      kind = segment.kind;
      if (segment.kind === "shot") {
        const shot = shotVars(input, segment, part, canvas);
        vars = { ...common, ...shot.vars };
        file = shotScene(id, size, vars, { clips: shot.clips, src: shot.src });
      } else if (segment.kind === "statement") {
        const line = textIn(segment.text, lang);
        vars = {
          ...common,
          ground: statementGround(),
          text: line,
          accent: textIn(segment.accent, lang) || accentOf(line),
          kicker: textIn(segment.kicker, lang),
        };
        kind = "kinetic";
        file = kineticScene(id, size, vars);
      } else if (segment.kind === "stat") {
        const label = textIn(segment.label, lang);
        vars = {
          ...common,
          ground: "clear",
          value: segment.value,
          prefix: segment.prefix ?? "",
          suffix: segment.suffix ?? "",
          decimals: segment.decimals ?? 0,
          label,
          accent: accentOf(label),
        };
        file = statScene(id, size, vars);
      } else if (segment.kind === "montage") {
        const line = textIn(segment.text, lang);
        vars = { ...common, ground: "clear", text: line, accent: accentOf(line) };
        file = montageScene(id, size, vars, {
          clips: segment.clips.map((c) => ({ duration: dur, mediaStart: r3(c.in), rate: 1 })),
        });
      } else {
        // A director-written scene: its copy as variables; without its file, the copy as kinetic type.
        const copy = Object.fromEntries(Object.entries(segment.copy ?? {}).map(([k, t]) => [k, textIn(t, lang)]));
        vars = { ...common, ground: "clear", ...copy };
        const line = String(copy.text ?? Object.values(copy)[0] ?? "");
        file = kineticScene(id, size, { ...vars, text: line, accent: accentOf(line), kicker: "" });
      }
    }
    const own = custom.get(id);
    await writeFile(join(o.out, "compositions", `${id}.html`), own ?? file);
    if (!own) written[id] = sha(file);
    scenes.push({ id, kind, start, duration: dur, custom: Boolean(own) });
    hosts.push(
      `<div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${start}" data-duration="${dur}" data-track-index="${i + 1}" data-track-kind="graphics" data-width="${size.w}" data-height="${size.h}" style="z-index: ${i + 2}" data-variable-values='${esc(JSON.stringify(vars))}'></div>`,
    );
  }

  // The ambient ground under everything, for the whole video.
  const groundVars: Vars = { dur: r3(duration), enter: "cut", enterSecs: 0, exit: "cut", exitSecs: 0 };
  const groundFile = groundScene("ground", size, groundVars);
  await writeFile(join(o.out, "compositions", "ground.html"), custom.get("ground") ?? groundFile);
  if (!custom.has("ground")) written.ground = sha(groundFile);
  hosts.unshift(
    `<div id="ground" data-composition-id="ground" data-composition-src="compositions/ground.html" data-start="0" data-duration="${r3(duration)}" data-track-index="0" data-track-kind="graphics" data-width="${size.w}" data-height="${size.h}" style="z-index: 1" data-variable-values='${esc(JSON.stringify(groundVars))}'></div>`,
  );

  // Captions in the bottom band. A trailer's headlines, title and outro carry their own words, so
  // captions stay off while those are up (the reference films have none at all).
  const covered = parts
    .filter((p) => p.kind !== "segment" || (edl.style.edit === "trailer" && edl.segments[p.index]!.kind !== "shot"))
    .map((p) => [p.from / fps, (p.from + p.frames) / fps] as const);
  // With a voice, captions follow its words on this edit's plan (the director may have retimed it).
  const captions = input.narration.length ? voiceCaptions(clips) : input.captions;
  const lines = captions
    .filter((c) => !covered.some(([a, b]) => c.start < b - 0.05 && c.end > a + 0.05 && (Math.min(b, c.end) - Math.max(a, c.start)) / (c.end - c.start) > 0.3))
    .map((c) => ({
      s: r3(c.start),
      e: r3(c.end),
      text: c.text,
      ...(c.words ? { words: c.words.map((w) => ({ t: w.text, s: r3(w.start), e: r3(w.end) })) } : {}),
    }));
  if (lines.length) {
    const captionVars: Vars = {
      dur: r3(duration),
      enter: "cut",
      enterSecs: 0,
      exit: "cut",
      exitSecs: 0,
      style: edl.style.captionStyle,
      lines: JSON.stringify(lines),
    };
    const captionFile = captionsScene("captions", size, captionVars);
    await writeFile(join(o.out, "compositions", "captions.html"), custom.get("captions") ?? captionFile);
    if (!custom.has("captions")) written.captions = sha(captionFile);
    hosts.push(
      `<div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${r3(duration)}" data-track-index="${parts.length + 1}" data-track-kind="captions" data-width="${size.w}" data-height="${size.h}" style="z-index: ${parts.length + 2}" data-variable-values='${esc(JSON.stringify(captionVars))}'></div>`,
    );
  }

  // Sound: each voice line where the plan put it (its own length), the effects on their cues, and
  // the music bed ducked under the voice. Each clip on its own lane, so none overlap on a track.
  const audio: string[] = [];
  let lane = parts.length + 3;
  const lengths = new Map(input.narration.map((n) => [n.src, n.seconds]));
  for (const [i, clip] of clips.entries()) {
    const name = `vo-${i + 1}${clip.src.slice(clip.src.lastIndexOf("."))}`;
    await place(join(o.root, clip.src), join(o.out, "assets", "voice", name));
    audio.push(
      `<audio id="vo-${i + 1}" src="assets/voice/${name}" data-start="${r3(clip.from / fps)}" data-duration="${r3(lengths.get(clip.src) ?? clip.frames / fps)}" data-volume="1" data-track-index="${lane++}"></audio>`,
    );
  }
  const sfx = input.audio?.sfx ?? {};
  const cues = sfxCues(edl, parts, input.footage.timeline, frames).filter((cue) => sfx[cue.kind]);
  const sfxSeconds = new Map<string, number>();
  for (const kind of new Set(cues.map((c) => c.kind))) {
    const file = join(o.out, "assets", "sfx", basename(sfx[kind]!));
    await place(join(o.root, sfx[kind]!), file);
    const probed = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).catch(() => "1.5");
    sfxSeconds.set(kind, Number(probed.trim()) || 1.5);
  }
  cues.forEach((cue, i) =>
    audio.push(
      `<audio id="sfx-${i + 1}" src="assets/sfx/${basename(sfx[cue.kind]!)}" data-start="${r3(cue.frame / fps)}" data-duration="${r3(Math.min(sfxSeconds.get(cue.kind) ?? 1.5, duration - cue.frame / fps))}" data-volume="${r3(cue.gain)}" data-track-index="${lane++}"></audio>`,
    ),
  );
  if (input.audio?.music) {
    await place(join(o.root, input.audio.music), join(o.out, "assets", "music.mp3"));
    const music = edl.style.music;
    const level = 10 ** ((music.gainDb ?? -6) / 20);
    const ducked = 10 ** (((music.gainDb ?? -6) + music.duckDb) / 20);
    // Down 0.15 s before each line, back up 0.3 s after (PRD §9.7.2); lines closer than that stay
    // ducked between them. A full-level point at 0, since a lane holds its first value back.
    const spans: [number, number][] = [];
    for (const clip of clips) {
      const [s, e] = [Math.max(0, clip.from / fps - 0.15), Math.min(duration, (clip.from + clip.frames) / fps + 0.3)];
      const prev = spans.at(-1);
      if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
      else spans.push([s, e]);
    }
    const points = [{ t: 0, v: r3(level) }];
    for (const [s, e] of spans)
      points.push({ t: r3(s), v: r3(level) }, { t: r3(s + 0.15), v: r3(ducked) }, { t: r3(e - 0.3), v: r3(ducked) }, { t: r3(e), v: r3(level) });
    const automation = { version: 1, lanes: [{ target: "volume", points: points.slice(0, 512) }] };
    audio.push(
      `<audio id="music" data-timeline-role="music" src="assets/music.mp3" data-start="0" data-duration="${r3(duration)}" data-media-start="${r3(music.firstBeat ?? 0)}" data-fade-in="0.5" data-fade-out="1.6" data-automation='${esc(JSON.stringify(automation))}' data-track-index="${lane++}"></audio>`,
    );
  }

  const rootVars = {
    "--ac-w": `${size.w}px`,
    "--ac-h": `${size.h}px`,
    "--ac-u": `${canvas.u}px`,
    "--ac-display": stack(display),
    "--ac-text": stack(text),
    ...theme.vars,
  };
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${size.w}, height=${size.h}" />
<script src="assets/gsap.min.js"></script>
<script src="assets/agentcast.js"></script>
<style>
${fonts.css}
:root { ${Object.entries(rootVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ")} }
${SHARED_CSS}
</style>
</head>
<body class="${theme.colourful ? "ac-grad" : ""}">
<div id="root" data-composition-id="main" data-start="0" data-duration="${r3(duration)}" data-width="${size.w}" data-height="${size.h}">
${[...hosts, ...audio].map((h) => `  ${h}`).join("\n")}
</div>
<script>
window.__timelines = window.__timelines || {};
window.__timelines["main"] = gsap.timeline({ paused: true });
</script>
</body>
</html>
`;
  await writeFile(join(o.out, "index.html"), html);
  await writeFile(join(o.out, "meta.json"), JSON.stringify({ id: "agentcast", name: "agentcast" }));
  // Which scene files are the catalogue's, so a later compile can tell the director's apart.
  await writeFile(join(o.out, "compiled.json"), JSON.stringify(written, null, 2));
  return { duration, scenes };
}
