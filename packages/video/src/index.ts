// @agentcast/video: the Remotion edit. Camera, timing and the baseline edit are pure; renderVideo() renders a variant.
export { baselineEdl, type BaselineInput } from "./baseline.ts";
export { cameraAt, cropFor, inView, onPage, project, zoomOf, type Crop, type Size } from "./camera.ts";
export { scriptCaptions, voiceCaptions } from "./captions.ts";
export { bezier, calloutSeconds, cardSeconds, eased, moveSeconds, readSeconds } from "./motion.ts";
export {
  assignNarration,
  beatParts,
  cursorAt,
  outputSize,
  planParts,
  VOICE_SPACING,
  type Caption,
  type Narration,
  type Part,
  type PlacedClip,
  type VideoInput,
} from "./plan.ts";
export { renderStills, renderVideo, stillMoments, type RenderOptions } from "./render.ts";
export { sfxCues, type SfxCue, type SfxKind } from "./audio.ts";
export { chooseLook, DEFAULT_LOOK, type Look } from "./look.ts";
export { clockOf, speedAt, type Clock, type Ramp } from "./retime.ts";
export { ensureSfx } from "./sound.ts";
