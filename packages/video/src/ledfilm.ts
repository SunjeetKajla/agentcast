import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BeatSheet, FlowsFile, type ArtDirection, type Brand, type BrandKit, type Move, type Primitive, type ProductOutputs, type CreativeBrief, type Edl, type MusicTrack, type ProductBrief, type Script, type Storyboard, type Timeline } from "@agentcast/shared";
import { repairTemporalEdl } from "./quality.ts";
import { shotContent } from "./content.ts";
import { loadMusicLibrary, pickTrack } from "./music.ts";
import { beatsOf, ledStyle } from "./musicplan.ts";
import { planParts } from "./plan.ts";
import { loadReferenceLibrary } from "./references.ts";
import { chooseSkeleton, ledPlan, productShape, type LedPlan, type ShotContent, type StepLabel } from "./template.ts";

// A music-led film planned from a job's recording and script (PRD §9.7.6–9.7.7): the track, what each
// shot's page shows, the skeleton, the edit, and the beat sheet a person reviews. The script stage runs it
// before script review, so a dropped shot shows there; the direct stage runs it again on the approved script.

export type LedFilm = { plan: LedPlan; track?: MusicTrack; content: Record<string, ShotContent>; grid: { beat: number; bar: number } };

export async function planLedFilm(o: {
  recording: string;
  timeline: Timeline;
  storyboard: Storyboard;
  scripts: Record<string, Script>;
  creative: CreativeBrief;
  product?: ProductBrief;
  brand?: Brand;
  /** Picks the track (the job id, as before). */
  seed: string;
  /** Picks the skeleton and its look (the site), so one product keeps its look across jobs. */
  site: string;
  /** A skeleton by id; otherwise the library's pick for the product's shape. */
  skeletonId?: string;
  /** Art direction (PRD §9.7.8): its skeleton, featured and avoided moves, and brand moves. */
  direction?: ArtDirection;
  /** What each shot's page shows, when the caller has measured it already. */
  content?: Record<string, ShotContent>;
  /** The job's folder, which the brand material's paths are relative to. */
  root?: string;
  /** The brand kit (page captures, the logo cloud) and the product's outputs, for brand moves. */
  kit?: BrandKit;
  outputs?: ProductOutputs;
  /** The person allowed other companies' logos in the film. */
  thirdPartyLogos?: boolean;
  signal?: AbortSignal;
}): Promise<LedFilm> {
  const [music, references] = await Promise.all([loadMusicLibrary().catch(() => undefined), loadReferenceLibrary().catch(() => undefined)]);
  const content = o.content ?? (await shotContent(o.recording, o.storyboard, o.timeline, o.signal));
  const wanted = o.direction?.skeletonId ?? o.skeletonId;
  const named = wanted ? references?.skeletons.find((s) => s.id === wanted) : undefined;
  const skeleton = named ?? (references ? chooseSkeleton(references, productShape(o.storyboard, o.timeline, content), o.site) : undefined);
  // The structure first, then the music it wants: a calm one-take and a rapid-fire film don't share a track.
  const track = pickTrack(music, { personality: o.creative.personality, edit: "trailer", seconds: o.creative.targetSeconds, seed: o.seed, led: true, ...(skeleton?.music ? { want: skeleton.music } : {}) });
  const grid = track ? beatsOf(track) : { beat: 0.5, bar: 2 };
  // Each output's length and waveform, read from the file itself.
  const outputs = [];
  for (const out of o.outputs?.outputs ?? []) {
    const shape = o.root ? await audioShape(join(o.root, out.file), o.signal).catch(() => undefined) : undefined;
    if (shape && shape.audible && shape.seconds >= 0.5) outputs.push({ file: out.file, flowId: out.flowId, t: out.t, ...shape });
  }
  // What each step acted on, from the job's flows: the pill wears the real button's words.
  const steps: Record<string, StepLabel> = {};
  if (o.root) {
    const flows = FlowsFile.safeParse(JSON.parse(await readFile(join(o.root, "explore/flows.json"), "utf8").catch(() => "{}")));
    if (flows.success)
      for (const flow of flows.data.flows)
        for (const step of flow.steps)
          steps[`${flow.id}/${step.id}`] = { action: step.action, ...(step.target?.text ? { text: step.target.text } : step.target?.label ? { text: step.target.label } : {}), ...(typeof step.value === "string" && !step.secret ? { value: step.value } : {}) };
  }
  const plan = ledPlan({
    content,
    timeline: o.timeline,
    storyboard: o.storyboard,
    scripts: o.scripts,
    personality: o.creative.personality,
    targetSeconds: o.creative.targetSeconds,
    seed: o.site,
    grid,
    ...(skeleton ? { skeleton } : {}),
    ...(o.direction
      ? { prefer: kindsOf(o.direction.featured), avoid: kindsOf(o.direction.avoid).filter((k) => !kindsOf(o.direction!.featured).includes(k)), motion: o.direction.brand }
      : {}),
    ...(track ? { music: ledStyle(track) } : {}),
    ...(o.product?.keyTerms ? { terms: o.product.keyTerms } : {}),
    assets: {
      captures: (o.kit?.captures ?? []).map((c) => c.file),
      cloud: o.thirdPartyLogos ? (o.kit?.cloud ?? []).map((c) => c.file) : [],
      outputs,
      imagery: (o.kit?.imagery ?? []).map((i) => ({ file: i.file, colour: i.colour, round: i.round })),
      colours: o.kit?.colours ?? [],
    },
    ...(Object.keys(steps).length ? { steps } : {}),
    ...(o.direction && Object.keys(o.direction.shots).length ? { shots: o.direction.shots } : {}),
    ...(o.brand ? { brand: o.brand } : {}),
  });
  plan.edl = repairTemporalEdl(plan.edl, o.timeline).edl;
  return { plan, ...(track ? { track } : {}), content, grid };
}

/** The primitives that make each move, in order, without repeats. */
function kindsOf(moves: Move[]): Primitive["type"][] {
  const KIND: Partial<Record<Move, Primitive["type"]>> = { prompt: "prompt", build: "build", cards: "build", panel: "proof", list: "proof", ticker: "ticker", swap: "swap", wall: "wall", "glow-pill": "pill", mockup: "mockup", output: "output", orbit: "orbit" };
  return [...new Set(moves.map((m) => KIND[m]).filter((k): k is Primitive["type"] => Boolean(k)))];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** An audio file's length and a 48-bar waveform (RMS per slice, scaled to the loudest, with a floor). */
export function audioShape(file: string, signal?: AbortSignal): Promise<{ seconds: number; peaks: number[]; audible: boolean }> {
  const rate = 8000;
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "ignore"], ...(signal ? { signal } : {}) });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) return fail(new Error(`ffmpeg couldn't read ${file}`));
      const bytes = Buffer.concat(chunks);
      const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
      const bars = 48;
      // The waveform covers what the move plays: at most its first 4.5 s.
      const shown = Math.min(samples.length, rate * 4.5);
      const size = Math.max(1, Math.floor(shown / bars));
      const rms = Array.from({ length: bars }, (_, i) => Math.sqrt(samples.subarray(i * size, (i + 1) * size).reduce((s, v) => s + v * v, 0) / size));
      const loudest = Math.max(...rms, 1e-6);
      done({ seconds: r2(samples.length / rate), audible: samples.length >= rate * 0.5 && Math.max(...rms) > 0.001, peaks: rms.map((v) => Math.round((0.1 + 0.9 * Math.sqrt(v / loudest)) * 1000) / 1000) });
    });
  });
}
/** A held proof's one push into a region of its own frame (`template.ts` pushFor), not a glide across the page. */
const pushesIn = (p: Extract<Primitive, { type: "proof" }>) => {
  const stop = p.path?.length === 1 ? p.path[0]!.frame : undefined;
  return Boolean(stop && stop[2] < p.frame[2] && stop[0] >= p.frame[0] && stop[1] >= p.frame[1] && stop[0] + stop[2] <= p.frame[0] + p.frame[2] && stop[1] + stop[3] <= p.frame[1] + p.frame[3]);
};
const first = (text: Record<string, string> | undefined) => (text ? (text.en ?? Object.values(text)[0]) : undefined);

/** A film's beat sheet: each part on the bar grid, what it shows and says, and the shots left out. */
export function beatSheetOf(edl: Edl, o: { skeletonId: string; thesis: string; grid: { beat: number; bar: number }; dropped: LedPlan["dropped"] }): BeatSheet {
  const { parts, frames } = planParts(edl, []);
  const fps = edl.fps;
  const beats = parts.map((part) => {
    const at = part.from / fps;
    const seconds = part.frames / fps;
    const bars: [number, number] = [Math.floor(at / o.grid.bar + 1e-6) + 1, Math.max(Math.floor(at / o.grid.bar + 1e-6) + 1, Math.ceil((at + seconds) / o.grid.bar - 1e-6))];
    if (part.kind !== "segment") {
      const card = part.kind === "intro" ? edl.intro : edl.outro;
      const line = first((card.props as { line?: Record<string, string> }).line);
      return { id: part.kind, at: r2(at), seconds: r2(seconds), bars, move: card.component === "Opener" ? "opener" : card.component === "EndCard" ? "end card" : card.component, ...(line ? { copy: line } : {}) };
    }
    const segment = edl.segments[part.index]!;
    const base = { id: segment.id, at: r2(at), seconds: r2(seconds), bars, ...("beatId" in segment && segment.beatId ? { beatId: segment.beatId } : {}) };
    if (segment.kind !== "primitive") return { ...base, move: segment.kind };
    const p = segment.primitive;
    switch (p.type) {
      case "label":
        return { ...base, move: `label (${p.ground}, ${p.open})`, copy: first(p.text)! };
      case "swap":
        return { ...base, move: "word swap", copy: `${first(p.lead)} ${p.words.map(first).join(" / ")}` };
      case "ticker":
        return { ...base, move: "ticker", copy: p.terms.map(first).join(" · ") };
      case "build":
        return { ...base, move: `build (${p.items.length} pieces${p.lift ? ", one lifted" : ""})`, source: { flowId: p.flowId, from: p.at, to: p.at } };
      case "proof":
        return { ...base, move: pushesIn(p) ? "proof (push in)" : p.path?.length ? `one take (${p.path.length + 1} regions)` : `proof${p.hops?.length ? ` (${p.hops.length} hops)` : ""}`, source: { flowId: p.flowId, from: p.in, to: p.out, frame: p.frame } };
      case "prompt":
        return { ...base, move: "typing close-up", source: { flowId: p.flowId, from: p.in, to: p.out, frame: p.frame } };
      case "wall":
        return { ...base, move: `wall of ${p.pages.length} pages` };
      case "pill":
        return { ...base, move: `glow pill${p.press ? ", the hand sends" : ""}`, copy: p.text, source: { flowId: p.flowId, from: p.at, to: p.at } };
      case "mockup":
        return { ...base, move: "laptop mockup", source: { flowId: p.flowId, from: p.in, to: p.out, frame: p.frame } };
      case "output":
        return { ...base, move: `the product's own output (${p.seconds.toFixed(1)} s)` };
      case "orbit":
        return { ...base, move: `${p.logos.length} logos orbiting` };
    }
  });
  return BeatSheet.parse({
    schemaVersion: 1,
    skeletonId: o.skeletonId,
    thesis: o.thesis,
    ...(edl.style.music.trackId ? { trackId: edl.style.music.trackId } : {}),
    bpm: edl.style.music.bpm ?? 120,
    beat: r2(o.grid.beat),
    bar: r2(o.grid.bar),
    seconds: r2(frames / fps),
    beats,
    dropped: o.dropped,
  });
}

/** One line per beat, for a log or a review: "bars 3–4 · 4.0 s · label · Plan it". */
export function describeBeatSheet(sheet: BeatSheet): string[] {
  return [
    `${sheet.skeletonId} · ${sheet.seconds.toFixed(1)} s at ${Math.round(sheet.bpm)} BPM · ${sheet.thesis}`,
    ...sheet.beats.map((b) => `bars ${b.bars[0]}${b.bars[1] > b.bars[0] ? `–${b.bars[1]}` : ""} · ${b.at.toFixed(1)} s · ${b.move}${b.copy ? ` · ${b.copy}` : ""}`),
    ...sheet.dropped.map((d) => `left out: ${d.title ?? d.beatId} (${d.reason})`),
  ];
}
