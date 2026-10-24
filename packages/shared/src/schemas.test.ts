import { describe, expect, test } from "vitest";
import { Beat, GATE_DECISIONS, GateName, JobConfig, MOTION_PRESETS, MotionTokens, Personality, STAGES, StageName, variantMatrix } from "./index.ts";

describe("stages", () => {
  test("STAGES lists every stage once, each after the ones it waits for", () => {
    expect(STAGES.map((s) => s.name)).toEqual(StageName.options);
    const seen = new Set<string>();
    for (const s of STAGES) {
      for (const dep of s.after) expect(seen, `${s.name} waits for ${dep}`).toContain(dep);
      seen.add(s.name);
    }
  });

  test("gates are the stages flagged as gates, each with a decision schema", () => {
    expect(STAGES.filter((s) => s.gate).map((s) => s.name)).toEqual(GateName.options);
    expect(Object.keys(GATE_DECISIONS).sort()).toEqual([...GateName.options].sort());
  });
});

describe("JobConfig", () => {
  test("a bare URL gets the composer's defaults", () => {
    expect(JobConfig.parse({ url: "https://example.com" })).toEqual({
      url: "https://example.com",
      auth: { mode: "public" },
      stylePrompt: "",
      mode: "launch",
      variants: { aspects: ["16x9"], langs: ["en"], formFactors: ["desktop"] },
      autopilot: false,
    });
  });

  test("rejects non-http URLs", () => {
    expect(JobConfig.safeParse({ url: "file:///etc/passwd" }).success).toBe(false);
    expect(JobConfig.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
  });
});

test("a beat's footage span is all or nothing", () => {
  const beat = { id: "b", role: "core", onScreen: [], motion: { kind: "hold", emotion: "calm" }, intent: "x", maxSeconds: 2 };
  expect(Beat.safeParse(beat).success).toBe(true);
  expect(Beat.safeParse({ ...beat, flowId: "f", in: 0, out: 2 }).success).toBe(true);
  expect(Beat.safeParse({ ...beat, flowId: "f", in: 0 }).success).toBe(false);
  expect(Beat.safeParse({ ...beat, flowId: "f", in: 2, out: 1 }).success).toBe(false);
});

test("motion presets are valid tokens for their personality", () => {
  for (const p of Personality.options) {
    const tokens = MotionTokens.parse(MOTION_PRESETS[p]);
    expect(tokens.personality).toBe(p);
  }
});

describe("variantMatrix", () => {
  const ids = (v: Parameters<typeof variantMatrix>[0]) => variantMatrix(v).map((x) => x.id);

  test("desktop footage serves both aspects in every language", () => {
    expect(ids({ aspects: ["16x9", "9x16"], langs: ["en", "hi"], formFactors: ["desktop"] })).toEqual([
      "16x9-en",
      "9x16-en",
      "16x9-hi",
      "9x16-hi",
    ]);
  });

  test("mobile footage adds native 9:16 variants only", () => {
    expect(ids({ aspects: ["16x9", "9x16"], langs: ["en"], formFactors: ["desktop", "mobile"] })).toEqual([
      "16x9-en",
      "9x16-en",
      "9x16-en-mobile",
    ]);
    expect(ids({ aspects: ["16x9", "9x16"], langs: ["en"], formFactors: ["mobile"] })).toEqual(["9x16-en-mobile"]);
  });

  test("duplicates collapse", () => {
    expect(ids({ aspects: ["16x9", "16x9"], langs: ["en", "en"], formFactors: ["desktop"] })).toEqual(["16x9-en"]);
  });
});
