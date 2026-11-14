import type { Edl } from "@agentcast/shared";
import { planParts } from "@agentcast/video";

// What a film's edit does, read from its EDL: how much moves, whether it keeps to the beat, how varied
// it is. Cheap and exact, unlike the pixel metrics, so a change in the template shows up here first.

export type EditMeasure = {
  parts: number;
  /** Parts that arrive with a transition rather than a cut, and the kinds used. */
  transitions: number;
  transitionKinds: string;
  /** Share of parts starting on a beat of the film's track (music-led films only). */
  onBeat: number | null;
  /** How far the furthest part start sits from its beat, in ms: frame rounding adds up over a film. */
  driftMs: number | null;
  /** Proofs and shots that move the camera (a path, row hops, or camera keys), out of all of them. */
  cameraMoves: number;
  footageParts: number;
  /** Different moves used, and how often a move follows itself. */
  moveKinds: number;
  repeats: number;
  /** The longest part, in seconds. */
  longest: number;
};

const moveOf = (s: Edl["segments"][number]) => (s.kind === "primitive" ? s.primitive.type : s.kind);

export function editMeasure(edl: Edl): EditMeasure {
  const { parts } = planParts(edl, []);
  const fps = edl.fps;
  const beat = edl.style.timing === "music" && edl.style.music.bpm ? 60 / edl.style.music.bpm : undefined;
  const segments = edl.segments;
  const moves = segments.map(moveOf);
  const footage = segments.filter((s) => s.kind === "shot" || (s.kind === "primitive" && s.primitive.type === "proof"));
  const moving = footage.filter((s) =>
    s.kind === "shot"
      ? s.camera.length > 1
      : s.kind === "primitive" && s.primitive.type === "proof" && Boolean(s.primitive.path?.length || s.primitive.hops?.length),
  );
  const transitions = segments.filter((s) => s.transitionIn !== "cut");
  const offBeat = beat ? parts.map((p) => Math.abs(p.from / fps - Math.round(p.from / fps / beat) * beat)) : [];
  const onBeat = beat ? offBeat.filter((d) => d <= 1 / fps + 1e-6).length / parts.length : null;
  return {
    parts: parts.length,
    transitions: transitions.length,
    transitionKinds: [...new Set(transitions.map((s) => s.transitionIn))].join(" "),
    onBeat: onBeat === null ? null : Math.round(onBeat * 100) / 100,
    driftMs: beat ? Math.round(Math.max(...offBeat) * 1000) : null,
    cameraMoves: moving.length,
    footageParts: footage.length,
    moveKinds: new Set(moves).size,
    repeats: moves.slice(1).filter((m, i) => m === moves[i]).length,
    longest: Math.round(Math.max(...parts.map((p) => p.frames / fps)) * 10) / 10,
  };
}
