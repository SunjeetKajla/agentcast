import { access } from "node:fs/promises";
import { join } from "node:path";
import { BrandKit, type Timeline } from "@agentcast/shared";
import { collectImagery } from "./imagery";
import { cutOut, logoParts } from "./logokit";

// The brand kit (PRD §9.7.8, docs/BRAND_MOTION_PLAN.md §3) from what understand's inspection captured: the logo's
// parts for revealing it piece by piece, its vector when the site had one, its cut-out when it didn't, the site's
// own pages, other companies' logos, and the brand's own objects and colours from its hero and pages.

export async function brandKitOf(o: {
  /** The job's folder; every path in and out is relative to it. */
  dir: string;
  logo?: { file: string; plate?: boolean };
  hero?: string;
  captures: { file: string; url: string }[];
  cloud: BrandKit["cloud"];
  signal?: AbortSignal;
}): Promise<BrandKit> {
  const at = (rel: string) => join(o.dir, rel);
  const parts = o.logo ? await logoParts(at(o.logo.file), o.signal) : undefined;
  const svg = await access(at("brief/logo.svg")).then(() => "brief/logo.svg", () => undefined);
  // A raster logo sat on the page's colour: keyed out, it sits on any ground. An app icon keeps its plate.
  const cut = o.logo && !svg && !o.logo.plate && (await cutOut(at(o.logo.file), at("brief/logo-cut.png"), o.signal).catch(() => false)) ? "brief/logo-cut.png" : undefined;
  const sources = [...(o.hero ? [o.hero] : []), ...o.captures.map((c) => c.file)].map((file) => ({ file: at(file), from: "page" as const }));
  const imagery = await collectImagery({ sources, dir: at("brief/imagery"), rel: "brief/imagery", ...(o.signal ? { signal: o.signal } : {}) }).catch(() => ({ imagery: [], colours: [] }));
  return BrandKit.parse({
    schemaVersion: 1,
    ...(o.logo && parts ? { logo: { png: o.logo.file, ...(svg ? { svg } : {}), ...(cut ? { cut } : {}), ...parts } } : {}),
    captures: o.captures,
    cloud: o.cloud,
    imagery: imagery.imagery,
    colours: imagery.colours,
  });
}

/**
 * The kit with the brand's objects as the product shows them added (Sarvam's orbs live on its TTS page, not the
 * home page): frames of the recording as it opens and as each action settles. Undefined when nothing changed.
 */
export async function withRecordingImagery(o: { kit: BrandKit; dir: string; recording: string; timeline: Timeline; signal?: AbortSignal }): Promise<BrandKit | undefined> {
  if (o.kit.imagery.some((i) => i.from === "recording")) return undefined;
  const times: number[] = [];
  // The opening second (scroll-in animations), then as each action settles.
  const samples = o.timeline.flows.flatMap((flow) => [flow.in + 0.1, flow.in + 0.6, ...o.timeline.events.filter((e) => e.flowId === flow.flowId && e.kind === "settled").map((e) => Math.min(flow.out - 0.1, e.t + 0.1))]);
  // Sample every flow before spending the remaining budget on later states.
  const perFlow = o.timeline.flows.map((f) => f.in + 0.6);
  for (const t of [...perFlow, ...samples]) if (t < o.timeline.duration - 0.2 && !times.some((x) => Math.abs(x - t) < 0.4)) times.push(t);
  const more = await collectImagery({
    sources: [{ file: o.recording, at: times.slice(0, 18), from: "recording" }],
    dir: join(o.dir, "brief/imagery"),
    rel: "brief/imagery",
    have: { imagery: o.kit.imagery, colours: o.kit.colours },
    ...(o.signal ? { signal: o.signal } : {}),
  }).catch(() => undefined);
  if (!more || (more.imagery.length === o.kit.imagery.length && more.colours.join() === o.kit.colours.join())) return undefined;
  return BrandKit.parse({ ...o.kit, imagery: more.imagery, colours: more.colours });
}
