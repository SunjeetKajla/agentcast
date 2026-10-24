export {
  ElevenLabs,
  VoiceError,
  ELEVENLABS_API,
  type Alignment,
  type Speech,
  type SpeakRequest,
  type Transcript,
  type VoiceSettings,
  type ElevenLabsOptions,
} from "./client";
export {
  alignmentToWords,
  checkAlignment,
  charErrorRate,
  spokenForm,
  withText,
  type Word,
  type AlignmentCheck,
} from "./words";
export { PREMADE, pickVoice, usableOnPlan, type PickedVoice } from "./voices";
export {
  renderNarration,
  audioSeconds,
  voiceCacheKey,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  type NarrationOptions,
} from "./render";
