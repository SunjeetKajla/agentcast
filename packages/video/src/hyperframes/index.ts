// The HyperFrames renderer (PRD §9.7.5, §9.8): compile an edit to a composition, render, snapshot, check.
export { accentOf, canvasOf, compileComposition, type CompiledScene, type CompileOptions } from "./compile.ts";
export { checkComposition, renderComposition, snapshotComposition, type CheckFinding } from "./render.ts";
export { hyperframes, HyperframesError } from "./cli.ts";
