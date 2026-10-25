// @agentcast/video: the edit, rendered by HyperFrames (Remotion legacy behind AGENTCAST_RENDERER). Camera, timing and the baseline edit are pure; renderVideo() renders a variant.
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
export { renderStills, renderVideo, stillMoments, variantDir, type RenderOptions } from "./render.ts";
export * from "./hyperframes/index.ts";
export { sfxCues, type SfxCue, type SfxKind } from "./audio.ts";
export { chooseLook, DEFAULT_LOOK, type Look } from "./look.ts";
export { clockOf, speedAt, type Clock, type Ramp } from "./retime.ts";
export { ensureSfx } from "./sound.ts";

export { loadMusicLibrary, MUSIC_LEVEL, musicDir, pickTrack } from "./music.ts";
export { ink, readableOn, contrastOf, luminanceOf, mixHex } from "./ink.ts";
export { timeMap, boxMap, remapEdl, remapStoryboard, type Retake } from "./remap.ts";
export { measureVideo, type VideoMeasure } from "./measure.ts";
