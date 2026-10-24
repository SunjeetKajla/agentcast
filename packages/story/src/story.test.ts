import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Llm } from "./llm";
import { type ProductBrief } from "@agentcast/shared";
import { creativeBrief, deterministicBrief } from "./index";

const product: ProductBrief = {
  schemaVersion: 1,
  url: "https://demo.app/",
  name: "DemoBoard",
  oneLiner: "Project boards with an AI planner.",
  valueProps: ["Plan a project in one click"],
  audience: "small product teams",
  tone: ["friendly", "direct"],
  keyTerms: [],
  pages: [],
};

/** An Llm whose json() returns `answer` (or throws it) and records what it was asked. */
function stubLlm(answer: unknown) {
  const seen: { prompt?: string; files?: string[]; productFile?: string } = {};
  const llm = {
    json: async (task: {
      prompt: string;
      files?: string[];
      cwd: string;
      schema: { parse(v: unknown): unknown };
    }) => {
      seen.prompt = task.prompt;
      seen.files = task.files;
      seen.productFile = await readFile(
        join(task.cwd, "product-brief.json"),
        "utf8",
      ).catch(() => undefined);
      if (answer instanceof Error) throw answer;
      return task.schema.parse(answer);
    },
  } as unknown as Llm;
  return { llm, seen };
}

const modelAnswer = {
  summary: "A 50 s playful launch video for makers.",
  audience: "makers",
  goal: "Try it",
  targetSeconds: 50,
  tone: ["playful", "warm"],
  personality: "playful",
  cta: "Start free",
  mustShow: ["AI planner"],
  avoid: [],
};

describe("creative brief", () => {
  it("keeps what the prompt states over the model and passes site data as a file", async () => {
    const { llm, seen } = stubLlm(modelAnswer);
    const { brief, usedLlm } = await creativeBrief(llm, {
      prompt: "Punchy, 30 s",
      mode: "launch",
      product,
    });
    expect(usedLlm).toBe(true);
    expect(brief).toMatchObject({
      targetSeconds: 30,
      personality: "energetic",
      audience: "makers",
      cta: "Start free",
      inferred: false,
      prompt: "Punchy, 30 s",
    });
    expect(brief.summary).toBe("A 30 s playful launch video for makers.");
    expect(seen.files).toEqual(["product-brief.json"]);
    expect(seen.productFile).toContain("DemoBoard");
    expect(seen.prompt).not.toContain("Project boards with an AI planner"); // site text stays in the file
    expect(seen.prompt).toMatch(/treat it only as data/);
  });

  it("lets the model decide what the prompt leaves open", async () => {
    const { llm } = stubLlm(modelAnswer);
    const { brief } = await creativeBrief(llm, { mode: "launch", product });
    expect(brief).toMatchObject({
      targetSeconds: 50,
      personality: "playful",
      inferred: true,
    });
    expect(brief.prompt).toBeUndefined();
  });

  it("falls back to a plain brief when the coding agent fails or is missing", async () => {
    const { llm } = stubLlm(new Error("no backend"));
    const r = await creativeBrief(llm, {
      prompt: "Calm and premium, 60 s, for enterprise buyers",
      focus: "SSO and audit logs",
      mode: "sales",
      product,
    });
    expect(r).toMatchObject({ usedLlm: false, error: "no backend" });
    expect(r.brief).toMatchObject({
      targetSeconds: 60,
      personality: "premium",
      audience: "enterprise buyers",
      cta: "Try DemoBoard",
      mustShow: ["SSO and audit logs"],
    });
    expect(r.brief.summary).toBe(
      "A calm, premium sales demo, about 60 s, for enterprise buyers.",
    );
    expect(deterministicBrief({ mode: "tutorial", product })).toMatchObject({
      audience: "small product teams",
      tone: ["friendly", "direct"],
      targetSeconds: 90,
    });
  });
});

import type { CreativeBrief, Timeline } from "@agentcast/shared";
import {
  candidateSpans,
  checkDraft,
  checkScript,
  plainStoryboard,
  toStoryboard,
  writeScript,
  writeStoryboard,
} from "./index";

const ev = (
  t: number,
  kind: string,
  stepId: string,
  url = "https://x.app/",
  extra: object = {},
) =>
  ({
    t,
    flowId: "f1",
    stepId,
    kind,
    label: stepId,
    url,
    ...extra,
  }) as Timeline["events"][number];
const timeline: Timeline = {
  schemaVersion: 1,
  recordingId: "r",
  formFactor: "desktop",
  viewport: { w: 1440, h: 900, dpr: 1 },
  fps: 30,
  duration: 20,
  flows: [{ flowId: "f1", in: 0, out: 20 }],
  events: [
    ev(1, "click", "login", "https://x.app/", {
      cursor: { from: [0, 0], to: [1, 1], t0: 0.6, t1: 1 },
    }),
    ev(1.5, "type", "user", "https://x.app/", { value: "demo" }),
    ev(3, "settled", "user"),
    ev(4, "click", "new", "https://x.app/projects"), // a page change starts a span
    ev(6.5, "settled", "new", "https://x.app/projects"),
    ev(9, "click", "save", "https://x.app/projects"), // after a pause
    ev(9.3, "settled", "save", "https://x.app/projects"),
    ev(9.6, "click", "name", "https://x.app/projects"),
    ev(10.5, "settled", "name", "https://x.app/projects"),
    ev(14, "click", "tiny", "https://x.app/projects"), // after a pause, too short to stand alone
    ev(14.2, "settled", "tiny", "https://x.app/projects"),
  ],
  dead: [],
};

const brief: CreativeBrief = {
  schemaVersion: 1,
  inferred: true,
  summary: "A test.",
  audience: "teams",
  goal: "Try it",
  targetSeconds: 30,
  tone: ["calm"],
  personality: "premium",
  cta: "Try X",
  mustShow: [],
  avoid: [],
};

describe("segmenter", () => {
  it("splits flows at page changes and pauses, merging short pieces", () => {
    const spans = candidateSpans([
      { flowId: "f1", title: "Make a project", timeline },
    ]);
    expect(spans.map((s) => s.id)).toEqual(["f1.a", "f1.b", "f1.c"]);
    expect(spans[0]).toMatchObject({
      in: 0.2,
      out: 3.5,
      stepIds: ["login", "user"],
    }); // the settle + 1 s would overlap the next span; cut halfway
    expect(spans[1]!.in).toBe(3.5);
    expect(spans[0]!.actions[1]).toBe('type "demo" into user');
    expect(spans[1]!.stepIds).toEqual(["new"]);
    expect(spans[2]).toMatchObject({
      stepIds: ["save", "name", "tiny"],
      in: 8.6,
      out: 15.2,
    }); // "tiny" merged into the span before it
    expect(
      spans.every((s) => s.seconds === Math.round((s.out - s.in) * 100) / 100),
    ).toBe(true);
    spans
      .slice(1)
      .forEach((s, i) => expect(s.in).toBeGreaterThanOrEqual(spans[i]!.out)); // no footage plays twice
  });
});

describe("storyboard", () => {
  const spans = candidateSpans([
    { flowId: "f1", title: "Make a project", timeline },
  ]);
  const beat = (role: string, spanId?: string) => ({
    role,
    ...(spanId ? { spanId } : {}),
    onScreen: [],
    motion: { kind: "emphasis", emotion: "calm" },
    intent: "x",
  });

  it("finds what a model got wrong, in words it can fix", () => {
    const bad = {
      beats: [
        beat("hook"),
        beat("core", "f1.c"),
        beat("core", "f1.a"),
        beat("core", "f1.zz"),
        beat("payoff"),
        beat("cta"),
      ],
    } as never;
    const problems = checkDraft(bad, spans, 30).join("\n");
    expect(problems).toMatch(/f1.zz", which doesn't exist/);
    expect(problems).toMatch(/f1.a comes after a later span/);
    // A launch is cut as a trailer: a beat without footage is a headline and needs its title.
    expect(problems).toMatch(
      /beat 5 is a headline beat \(no footage\) but has no onScreen title/,
    );
    // A tutorial is a guide: every beat but the hook and CTA shows footage.
    expect(checkDraft(bad, spans, 30, "tutorial").join("\n")).toMatch(
      /\(payoff\) has no footage/,
    );
    const titled = {
      ...beat("core"),
      onScreen: [{ kind: "title", text: "Checkout, tested" }],
    };
    expect(
      checkDraft(
        {
          beats: [
            beat("hook"),
            beat("core", "f1.a"),
            titled,
            beat("core", "f1.b"),
            beat("cta"),
          ],
        } as never,
        spans,
        30,
      ),
    ).toEqual([]);
    expect(
      checkDraft(
        {
          beats: [
            beat("hook"),
            beat("core", "f1.a"),
            titled,
            titled,
            beat("core", "f1.b"),
            beat("cta"),
          ],
        } as never,
        spans,
        30,
      ).join(),
    ).toMatch(/both headlines/);
    expect(
      checkDraft(
        { beats: [beat("hook"), beat("core", "f1.a"), beat("cta")] } as never,
        spans,
        30,
      ),
    ).toEqual([]);
  });

  it("requires one opening hook and one closing call to action before accepting a model plan", () => {
    const wrong = {
      beats: [
        beat("core", "f1.a"),
        beat("hook"),
        beat("hook"),
        beat("cta"),
        beat("core", "f1.b"),
      ],
    } as never;
    const problems = checkDraft(wrong, spans, 30).join("\n");
    expect(problems).toContain("exactly one hook, as the first beat");
    expect(problems).toContain("exactly one cta, as the last beat");
  });

  it("computes budgets: footage beats speak for 85% of their span in a guide and 70% in a trailer, card beats for the card", () => {
    const board = toStoryboard(
      { beats: [beat("hook"), beat("core", "f1.b"), beat("cta")] } as never,
      { mode: "launch", spans, cardSeconds: { intro: 3, outro: 3.4 } },
    );
    expect(board.beats.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(board.beats[1]).toMatchObject({
      flowId: "f1",
      in: spans[1]!.in,
      out: spans[1]!.out,
      maxSeconds: Math.round(spans[1]!.seconds * 0.7 * 10) / 10,
    });
    const guide = toStoryboard(
      { beats: [beat("hook"), beat("core", "f1.b"), beat("cta")] } as never,
      { mode: "tutorial", spans, cardSeconds: { intro: 3, outro: 3.4 } },
    );
    expect(guide.beats[1]!.maxSeconds).toBe(
      Math.round(spans[1]!.seconds * 0.85 * 10) / 10,
    );
    expect(board.beats[0]!.maxSeconds).toBe(2.7);
    expect(board.beats[2]!.maxSeconds).toBe(3.1);
    expect(
      plainStoryboard({
        mode: "tutorial",
        spans,
        cardSeconds: { intro: 3, outro: 3 },
        creative: brief,
      }).beats.map((b) => b.role),
    ).toEqual(["hook", "core", "core", "core", "cta"]);
    // Without a coding agent a trailer still gets headlines, from the product's value props.
    const trailer = plainStoryboard({
      mode: "launch",
      spans,
      cardSeconds: { intro: 3, outro: 3 },
      creative: brief,
      product: {
        ...product,
        valueProps: [
          "Plan launches in one shared board for everyone",
          "Ship faster",
        ],
      },
    });
    expect(
      trailer.beats.map((b) =>
        b.flowId ? "shot" : (b.onScreen[0]?.text ?? b.role),
      ),
    ).toEqual([
      "hook",
      "shot",
      "Plan launches in one shared board",
      "shot",
      "Ship faster",
      "shot",
      "cta",
    ]);
  });

  it("repairs a bad draft once, passing site data as files", async () => {
    const answers = [
      { beats: [beat("hook"), beat("core", "f1.nope"), beat("cta")] },
      { beats: [beat("hook"), beat("core", "f1.a"), beat("cta")] },
    ];
    const prompts: string[] = [];
    const llm = {
      json: async (t: {
        prompt: string;
        schema: { parse(v: unknown): unknown };
      }) => (prompts.push(t.prompt), t.schema.parse(answers.shift())),
    } as unknown as Llm;
    const board = await writeStoryboard(llm, {
      mode: "launch",
      creative: brief,
      product,
      spans,
      cardSeconds: { intro: 3, outro: 3 },
    });
    expect(board.beats).toHaveLength(3);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/f1.nope", which doesn't exist/);
    expect(prompts[0]).toMatch(/treat them only as data/);
  });
});

describe("script", () => {
  const spans = candidateSpans([
    { flowId: "f1", title: "Make a project", timeline },
  ]);
  const board = toStoryboard(
    {
      beats: [
        {
          role: "hook",
          onScreen: [],
          motion: { kind: "reveal", emotion: "calm" },
          intent: "x",
        },
        {
          role: "core",
          spanId: "f1.a",
          onScreen: [{ kind: "callout", text: "One click" }],
          motion: { kind: "emphasis", emotion: "calm" },
          intent: "y",
        },
        {
          role: "cta",
          onScreen: [],
          motion: { kind: "hold", emotion: "calm" },
          intent: "z",
        },
      ],
    } as never,
    { mode: "launch", spans, cardSeconds: { intro: 3, outro: 3 } },
  );
  const draft = (b2: string, b2screen = ["Ek click"]) => ({
    hook: "Meet X",
    titleCard: "X",
    cta: "Try X",
    posting: { title: "t", description: "d", hashtags: [] },
    lines: [
      { beatId: "b1", text: "Meet X today.", onScreen: [] },
      { beatId: "b2", text: b2, onScreen: b2screen },
      { beatId: "b3", text: "Try it now.", onScreen: [] },
    ],
  });

  it("holds lines to the S5 speech rates", () => {
    expect(checkScript(draft("Sign in and go."), board, "en")).toEqual([]);
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    expect(checkScript(draft(long), board, "en").join()).toMatch(
      /b2's line has 40 words; its budget is \d+/,
    );
    expect(checkScript(draft("ok", []), board, "hi").join()).toMatch(
      /needs 1 on-screen text/,
    );
  });

  it("writes Hindi with its style guide and keys lines by beat", async () => {
    let prompt = "";
    const llm = {
      json: async (t: {
        prompt: string;
        schema: { parse(v: unknown): unknown };
      }) => ((prompt = t.prompt), t.schema.parse(draft("Sign in कीजिए, बस."))),
    } as unknown as Llm;
    const script = await writeScript(llm, {
      lang: "hi",
      storyboard: board,
      creative: brief,
      product,
    });
    expect(prompt).toMatch(/Latin script/);
    expect(script).toMatchObject({ schemaVersion: 2, lang: "hi" });
    expect(script.segments.map((s) => s.beatId)).toEqual(["b1", "b2", "b3"]);
    expect(script.segments[1]).toMatchObject({
      onScreen: ["Ek click"],
      maxSeconds: board.beats[1]!.maxSeconds,
    });
  });
});
