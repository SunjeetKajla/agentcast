import { access, link, mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  Flow,
  Timeline,
  type ReplayEntry,
  type TimelineEvent,
} from "@agentcast/shared";
import { writeArtifact } from "@agentcast/shared/node";
import {
  recordLive,
  LiveStallError,
  type LiveOptions,
  type LiveRecording,
} from "../live.ts";
import { createActuator, type CursorSample } from "./act.ts";
import { abortable } from "./control.ts";
import { redactor, type RepairContext } from "./heal.ts";
import {
  installRecordingHygiene,
  maskedScreenshot,
  type HygieneOptions,
} from "./hygiene.ts";
import {
  resolveTarget,
  LocatorResolutionError,
  type LocateOptions,
  type ResolvedTarget,
} from "./locate.ts";
import {
  OutcomeError,
  snapshotOutcome,
  verifyOutcome,
  type OutcomeState,
} from "./outcome.ts";
import { cachedLocator, replayKey, saveReplayEntries } from "./replay.ts";
import { trackSettle, waitForSettle } from "./settle.ts";
import { selectMatch } from "./select.ts";

export interface FlowOptions extends LiveOptions {
  /** Defaults to timeline.json/replay-plan.json beside outputPath. */
  timelinePath?: string;
  replayPlanPath?: string;
  recordingId?: string;
  locate?: Omit<
    LocateOptions,
    | "signal"
    | "persist"
    | "repair"
    | "flowId"
    | "formFactor"
    | "replayPlanPath"
    | "secretValues"
  >;
  hygiene?: Omit<HygieneOptions, "signal">;
  settleTimeoutMs?: number;
  outcomeTimeoutMs?: number;
  random?: () => number;
  /** Sanitized progress, suitable for the worker's existing log/event hooks. */
  onTake?: (take: FlowTake) => void;
}
export interface FlowTake {
  attempt: number;
  status: "failed" | "ok";
  stepId?: string;
  reason?: string;
}
export interface FlowRecording extends LiveRecording {
  timeline: Timeline;
  cursorSamples: CursorSample[];
  flowTakes: FlowTake[];
}
export class FlowRecordingError extends Error {
  readonly code = "flow.failed";
  constructor(public readonly takes: FlowTake[]) {
    super(
      `Flow failed after ${takes.length} take(s): ${takes.at(-1)?.reason ?? "unknown failure"}`,
    );
    this.name = "FlowRecordingError";
  }
}
class StepFailure extends Error {
  constructor(
    public readonly stepId: string,
    public readonly repair: RepairContext,
  ) {
    super(repair.reason);
  }
}

async function unused(path: string) {
  await access(path).then(
    () => {
      throw new Error("Recording output already exists");
    },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}

/** Compile one flow into a verified take. All retry causes share a single hard limit of three. */
export async function recordFlow(
  input: Flow,
  options: FlowOptions,
): Promise<FlowRecording> {
  const flow = Flow.parse(input),
    maxTakes = options.maxTakes ?? 3;
  if (!Number.isInteger(maxTakes) || maxTakes < 1 || maxTakes > 3)
    throw new Error("Flow recording needs 1–3 takes");
  if (!flow.steps.some((step) => !["wait", "navigate"].includes(step.action)))
    throw new Error(
      "A flow needs an interaction, not only navigation or waits",
    );
  if (new Set(flow.steps.map((step) => step.id)).size !== flow.steps.length)
    throw new Error("Flow step IDs must be unique");
  if (!["http:", "https:"].includes(new URL(flow.startUrl).protocol))
    throw new Error("Flow start URL must be HTTP(S)");
  for (const budget of [
    options.settleTimeoutMs ?? 4000,
    options.outcomeTimeoutMs ?? 5000,
  ])
    if (!Number.isFinite(budget) || budget <= 0)
      throw new Error("Invalid flow verification budget");
  options.signal?.throwIfAborted();
  const outputPath = resolve(options.outputPath),
    timelinePath = resolve(
      options.timelinePath ?? join(dirname(outputPath), "timeline.json"),
    );
  const replayPlanPath = resolve(
    options.replayPlanPath ?? join(dirname(outputPath), "replay-plan.json"),
  );
  const recordingId = options.recordingId ?? basename(outputPath, ".mp4");
  if (
    new Set([outputPath, timelinePath, replayPlanPath]).size !== 3 ||
    !outputPath.toLowerCase().endsWith(".mp4")
  )
    throw new Error("Flow artifacts need distinct paths and an MP4 output");
  await Promise.all([unused(outputPath), unused(timelinePath)]);
  const secrets = [
    ...(options.hygiene?.secretValues ?? []),
    ...flow.steps
      .filter((step) => step.secret && step.value)
      .map((step) => step.value!),
  ];
  const redact = redactor(secrets),
    formFactor = options.browser?.formFactor ?? "desktop";
  // IDs label schema relationships; reject private IDs rather than corrupting references by redaction.
  for (const id of [flow.id, ...flow.steps.map((step) => step.id), recordingId])
    if (redact(id) !== id)
      throw new Error("Recording identifiers must not contain secrets");
  const takes: FlowTake[] = [];
  let repairStep: string | undefined, repair: RepairContext | undefined;
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(timelinePath), { recursive: true });
  const directory = await mkdtemp(
    join(dirname(outputPath), ".agentcast-flow-"),
  );
  try {
    for (let attempt = 1; attempt <= maxTakes; attempt++) {
      options.signal?.throwIfAborted();
      const stagedVideo = join(directory, `take-${attempt}.mp4`);
      const entries: Record<string, ReplayEntry> = Object.create(null);
      const events: TimelineEvent[] = [],
        dead: [number, number][] = [];
      let cursorSamples: CursorSample[] = [],
        viewport = { w: 1, h: 1, dpr: 1 };
      let preparedTarget: ResolvedTarget | undefined;
      try {
        const recording = await recordLive(
          {
            ...options,
            outputPath: stagedVideo,
            maxTakes: 1,
            prepare: async (session, _innerAttempt, signal) => {
              const hygiene = await installRecordingHygiene(session.page, {
                ...options.hygiene,
                secretValues: secrets,
                signal,
              });
              if (options.prepare)
                await options.prepare(session, attempt, signal);
              else
                await session.page.goto(flow.startUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: 45000,
                });
              await abortable(hygiene.ready(), signal);
              await waitForSettle(session.page, {
                signal,
                timeoutMs: options.settleTimeoutMs,
              });
              // Hydration/initial locator healing belongs before the source-video clock.
              // Keep learning staged; the same semantic locator is revalidated during capture.
              const first = flow.steps[0]!;
              if (first.target) {
                try {
                  preparedTarget = await resolveTarget(session.page, first, {
                    ...options.locate,
                    settle: false,
                    signal,
                    flowId: flow.id,
                    formFactor,
                    replayPlanPath,
                    persist: false,
                    secretValues: secrets,
                    repair: first.id === repairStep ? repair : undefined,
                  });
                } catch (error) {
                  signal.throwIfAborted();
                  if (!(error instanceof LocatorResolutionError)) throw error;
                  const state = await snapshotOutcome(
                    session.page,
                    secrets,
                  ).catch(() => undefined);
                  throw new StepFailure(first.id, {
                    reason: redact(error.message),
                    before: state?.aria ?? "",
                    after: state?.aria ?? "",
                  });
                }
              }
              const size = session.page.viewportSize()!;
              viewport = {
                w: size.width,
                h: size.height,
                dpr: await session.page.evaluate(() => devicePixelRatio),
              };
              await session.page.mouse.move(size.width / 2, size.height / 2);
            },
          },
          async (controls) => {
            const { page, signal, now } = controls;
            const actuator = createActuator(page, {
              signal,
              now,
              motion: controls.motion,
              random: options.random,
            });
            cursorSamples = actuator.samples;
            for (const step of flow.steps) {
              signal.throwIfAborted();
              let before: OutcomeState | undefined,
                beforeImage: Buffer | undefined,
                target: ResolvedTarget | undefined;
              const tracker = trackSettle(page, {
                signal,
                now,
                timeoutMs: options.settleTimeoutMs,
              });
              try {
                const lookupStart = now();
                if (step === flow.steps[0] && preparedTarget) {
                  const verified = await abortable(
                    selectMatch(
                      page,
                      preparedTarget.locator,
                      step,
                      options.locate?.maxCandidates ?? 100,
                    ),
                    signal,
                  );
                  if (verified.match)
                    target = { ...preparedTarget, ...verified.match };
                }
                if (step.target && !target)
                  target = await resolveTarget(page, step, {
                    ...options.locate,
                    signal,
                    flowId: flow.id,
                    formFactor,
                    replayPlanPath,
                    persist: false,
                    secretValues: secrets,
                    repair: step.id === repairStep ? repair : undefined,
                  });
                if (now() - lookupStart > 600)
                  dead.push([(lookupStart + 600) / 1000, now() / 1000]);
                if (step.secret && target)
                  await target.locator.evaluate(
                    (element) =>
                      element.setAttribute("data-agentcast-redact", ""),
                    undefined,
                    { timeout: 1000 },
                  );
                before = await abortable(
                  snapshotOutcome(page, secrets),
                  signal,
                );
                if (options.locate?.heal)
                  beforeImage = await maskedScreenshot(page, secrets, signal);
                const url = redact(page.url());
                const action = await actuator.run(step, target);
                const waitStart = now();
                const immediate = await abortable(
                  snapshotOutcome(page, secrets),
                  signal,
                );
                let firstChangeMs =
                  immediate.signature !== before.signature ||
                  immediate.url !== before.url
                    ? waitStart
                    : undefined;
                const settled = await tracker.wait();
                firstChangeMs ??= settled.firstChangeMs;
                for (const window of settled.motion)
                  controls.markMotion(window.startMs, window.endMs);
                const previous = await cachedLocator(
                  replayPlanPath,
                  formFactor,
                  replayKey(step.id, flow.id),
                );
                const outcome = await verifyOutcome(page, step, before, {
                  signal,
                  timeoutMs: options.outcomeTimeoutMs,
                  secretValues: secrets,
                  locator: target?.locator,
                  selectedValue: action.selectedValue,
                  learned: previous?.learnedExpect,
                  onObservation: (state) => {
                    if (
                      state.signature !== before!.signature ||
                      state.url !== before!.url
                    )
                      firstChangeMs ??= now();
                  },
                });
                // Conservatively cut only genuinely static waits, never observed animation/result changes.
                if (
                  !settled.motion.length &&
                  (firstChangeMs === undefined ? now() : firstChangeMs - 200) >
                    waitStart + 600
                )
                  dead.push([
                    (waitStart + 600) / 1000,
                    (firstChangeMs === undefined
                      ? now()
                      : firstChangeMs - 200) / 1000,
                  ]);
                const label = redact(
                  step.narrationHint ??
                    step.target?.text ??
                    step.target?.label ??
                    step.expected ??
                    step.action,
                );
                events.push({
                  t: action.at,
                  flowId: flow.id,
                  stepId: step.id,
                  kind: step.action,
                  label,
                  url,
                  ...action,
                  value:
                    step.value === undefined
                      ? undefined
                      : step.secret || redact(step.value) !== step.value
                        ? { redacted: true }
                        : step.value,
                });
                events.push({
                  t: now() / 1000,
                  flowId: flow.id,
                  stepId: step.id,
                  kind: "settled",
                  label,
                  url: outcome.after.url,
                  bbox: action.bbox,
                });
                const entry =
                  target?.entry ??
                  (!step.target
                    ? {
                        strategy: "text" as const,
                        locator: "",
                        lastOk: new Date().toISOString(),
                      }
                    : undefined);
                if (entry)
                  entries[replayKey(step.id, flow.id)] = {
                    ...entry,
                    learnedExpect: outcome.learned,
                  };
              } catch (error) {
                signal.throwIfAborted();
                // Corrupt artifacts/provider/configuration errors must not be misreported as UI failures.
                if (!before && !(error instanceof LocatorResolutionError))
                  throw error;
                const after =
                  error instanceof OutcomeError
                    ? error.after
                    : await snapshotOutcome(page, secrets).catch(() => before);
                const reason = redact(
                  error instanceof Error ? error.message : "Action failed",
                ).slice(0, 2000);
                const afterImage = options.locate?.heal
                  ? await maskedScreenshot(page, secrets, signal).catch(
                      () => undefined,
                    )
                  : undefined;
                throw new StepFailure(step.id, {
                  reason,
                  before: before?.aria ?? "",
                  after: after?.aria ?? "",
                  beforeImage,
                  afterImage,
                });
              } finally {
                tracker.dispose();
              }
            }
          },
        );
        options.signal?.throwIfAborted();
        const duration = recording.duration;
        const timeline = Timeline.parse({
          schemaVersion: 1,
          recordingId,
          formFactor,
          viewport,
          fps: 30,
          duration,
          flows: [{ flowId: flow.id, in: 0, out: duration }],
          events,
          dead: dead
            .map(([a, b]) => [Math.max(0, a), Math.min(duration, b)])
            .filter(([a, b]) => b! > a!),
        });
        const stagedTimeline = join(directory, "timeline.json");
        await writeArtifact(stagedTimeline, Timeline, timeline);
        let videoPublished = false,
          timelinePublished = false;
        try {
          // Exclusive links prevent overwriting a recording published by a concurrent caller.
          await link(stagedVideo, outputPath);
          videoPublished = true;
          await link(stagedTimeline, timelinePath);
          timelinePublished = true;
          await saveReplayEntries(
            replayPlanPath,
            formFactor,
            entries,
            options.signal,
          );
        } catch (error) {
          if (videoPublished) await rm(outputPath, { force: true });
          if (timelinePublished) await rm(timelinePath, { force: true });
          throw error;
        }
        const take: FlowTake = { attempt, status: "ok" };
        takes.push(take);
        options.onTake?.(take);
        return {
          ...recording,
          path: outputPath,
          timeline,
          cursorSamples,
          flowTakes: takes,
        };
      } catch (error) {
        options.signal?.throwIfAborted();
        if (
          !(error instanceof StepFailure) &&
          !(error instanceof LiveStallError)
        )
          throw error;
        const take: FlowTake = {
          attempt,
          status: "failed",
          stepId: error instanceof StepFailure ? error.stepId : undefined,
          reason: redact(error.message),
        };
        takes.push(take);
        options.onTake?.(take);
        if (error instanceof StepFailure) {
          repairStep = error.stepId;
          repair = error.repair;
        }
      }
    }
    throw new FlowRecordingError(takes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Planned flow-compiler name, retained alongside the recording-oriented API. */
export const compileFlow = recordFlow;
