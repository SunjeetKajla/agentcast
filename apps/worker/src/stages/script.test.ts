import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CreativeBrief,
  FlowsFile,
  JobConfig,
  ProductBrief,
  Script,
  Storyboard,
  Timeline,
  jobPaths,
} from "@agentcast/shared";
import {
  FIXTURE_JOB_DIR,
  readArtifact,
  writeArtifact,
} from "@agentcast/shared/node";
import type { Llm } from "@agentcast/llm";
import { candidateSpans } from "@agentcast/story";
import type { StageContext } from "../context";
import { script } from "./script";

let dir: string;
let ctx: StageContext;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentcast-script-stage-"));
  vi.stubEnv("AGENTCAST_STAGE_MODE", "real");
  const io: Pick<StageContext, "read" | "write" | "path"> = {
    read: (file, schema) => readArtifact(join(dir, file), schema),
    write: (file, schema, data) => writeArtifact(join(dir, file), schema, data),
    path: (file) => join(dir, file),
  };
  ctx = {
    ...io,
    dir,
    config: JobConfig.parse({
      url: "https://demoboard.vercel.app/",
      variants: {
        aspects: ["16x9"],
        langs: ["en", "hi"],
        formFactors: ["desktop"],
      },
    }),
    signal: new AbortController().signal,
    artifact: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
  } as unknown as StageContext;
  for (const file of [
    jobPaths.productBrief,
    jobPaths.creativeBrief,
    jobPaths.flows,
    jobPaths.timeline("desktop"),
    jobPaths.recording("desktop"),
  ]) {
    await mkdir(dirname(ctx.path(file)), { recursive: true });
    await copyFile(join(FIXTURE_JOB_DIR, file), ctx.path(file));
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("recorded footage to bilingual scripts", () => {
  it("shows real footage frames to the storyboard writer and writes validated EN/HI artifacts", async () => {
    const file = await ctx.read(jobPaths.flows, FlowsFile);
    const flow = file.flows[0]!;
    file.flows.push({...flow,id:"unrecorded-fashion",title:"Unrecorded Fashion",selected:true});
    await ctx.write(jobPaths.flows,FlowsFile,file);
    const timeline = await ctx.read(jobPaths.timeline("desktop"), Timeline);
    const spans = candidateSpans([
      { flowId: flow.id, title: flow.title, timeline },
    ]);
    let imageCount = 0;
    let calls = 0;
    const json = vi.fn(
      async (task: {
        prompt: string;
        images?: string[];
        schema: z.ZodType;
      }) => {
        calls++;
        if (task.prompt.includes("You are planning the storyboard")) {
          imageCount = task.images?.length ?? 0;
          expect(imageCount).toBeGreaterThan(0);
          const jpeg = await readFile(task.images![0]!);
          expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
          expect(task.prompt).toContain("spans.json");
          const beat = (role: string, spanId?: string) => ({
            role,
            ...(spanId ? { spanId } : {}),
            onScreen: [],
            motion: { kind: "hold", emotion: "calm" },
            intent: "Show the product outcome",
          });
          return task.schema.parse({
            beats: [beat("hook"), beat("core", spans[0]!.id), beat("cta")],
          });
        }
        expect(task.prompt).toContain("voiceover script");
        const hindi = task.prompt.includes("Write the Hindi voiceover");
        const board = await ctx.read(jobPaths.storyboard, Storyboard);
        return task.schema.parse({
          hook: hindi ? "शुरू करें।" : "Get started.",
          titleCard: "DemoBoard",
          cta: hindi ? "अभी आज़माएं।" : "Try now.",
          posting: { title: "DemoBoard", description: "", hashtags: [] },
          lines: board.beats.map((beat) => ({
            beatId: beat.id,
            text: hindi ? "शुरू करें।" : "Get started.",
            onScreen: [],
          })),
        });
      },
    );
    ctx.llm = { json: json as unknown as Llm["json"] } as Llm;
    await script(ctx);
    const board = await ctx.read(jobPaths.storyboard, Storyboard);
    expect(board.beats[1]?.flowId).toBe(flow.id);
    expect(calls).toBe(3);
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("1 approved flow(s) that did not record"),"warn");
    for (const lang of ["en", "hi"]) {
      const written = await ctx.read(jobPaths.script(lang), Script);
      expect(written.lang).toBe(lang);
      expect(written.segments.map((segment) => segment.beatId)).toEqual(
        board.beats.map((beat) => beat.id),
      );
    }
    expect(ctx.artifact).toHaveBeenCalledWith("script/frames/beat-2.jpg");
    // Inputs remain untouched and valid after frame capture and model planning.
    await ctx.read(jobPaths.productBrief, ProductBrief);
    await ctx.read(jobPaths.creativeBrief, CreativeBrief);
  }, 30_000);
  it("rejects a missing flow/timeline handoff before invoking a model", async () => {
    await ctx.write(jobPaths.flows, FlowsFile, { schemaVersion: 1, flows: [] });
    const json = vi.fn();
    ctx.llm = { json } as unknown as Llm;
    await expect(script(ctx)).rejects.toThrow(
      "No recorded actions match the approved flows",
    );
    expect(json).not.toHaveBeenCalled();
  });
});
