export {
  launchRecorderBrowser,
  withRecorderBrowser,
  type FormFactor,
  type RecorderBrowser,
  type RecorderBrowserOptions,
  type RecorderStorageState,
} from "./browser.ts";
export type {
  GpuAdapter,
  GpuAttempt,
  GpuBackend,
  GpuInfo,
  GpuPreference,
} from "./gpu.ts";
export {
  recordLive,
  LiveStallError,
  type LiveOptions,
  type LiveControls,
  type LiveRecording,
} from "./live.ts";
export {
  startScreencast,
  type CaptureOptions,
  type CaptureResult,
  type Screencast,
} from "./screencast.ts";
export {
  encodeCfrMp4,
  type EncodingOptions,
  type EncodedVideo,
  type VideoEncoder,
} from "./encode.ts";
export { checkStalls, type StallReport, type MotionWindow } from "./timing.ts";
export {
  resolveTarget,
  LocatorResolutionError,
  type LocateOptions,
  type ResolvedTarget,
} from "./flow/locate.ts";
export { replayKey } from "./flow/replay.ts";
export {
  parseLocator,
  serializeLocator,
  type SemanticLocator,
} from "./flow/semantic.ts";
export {
  recordFlow,
  compileFlow,
  FlowRecordingError,
  type FlowOptions,
  type FlowRecording,
  type FlowTake,
} from "./flow/compile.ts";
export {
  createActuator,
  cursorDuration,
  cubicPoint,
  type CursorSample,
  type ActuatorOptions,
  type ActionResult,
} from "./flow/act.ts";
export {
  trackSettle,
  waitForSettle,
  type SettleOptions,
  type SettleReport,
} from "./flow/settle.ts";
export {
  snapshotOutcome,
  verifyOutcome,
  OutcomeError,
  type OutcomeOptions,
  type OutcomeState,
} from "./flow/outcome.ts";
export {
  installRecordingHygiene,
  type HygieneOptions,
} from "./flow/hygiene.ts";
