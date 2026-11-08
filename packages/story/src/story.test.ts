import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Llm } from "./llm";
import { type ProductBrief } from "@agentcast/shared";
import { checkDirection, checkShots, copyIssues, creativeBrief, deterministicBrief, directArt, productTypeOf, rulesDirection } from "./index";

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
  it("keeps the music-led fallback's copy tied to footage, without unrelated product claims", () => {
    const board = plainStoryboard({ mode: "launch", led: true, spans, creative: brief, product,
      cardSeconds: { intro: 3, outro: 3 } });
    expect(board.beats.filter((b) => b.flowId)).toHaveLength(spans.length);
    expect(board.beats.filter((b) => !b.flowId).map((b) => b.role)).toEqual(["hook", "cta"]);
    for (const b of board.beats.filter((b) => b.flowId)) {
      expect(b.onScreen[0]?.kind).toBe("title");
      expect(b.onScreen[0]!.text.split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(b.onScreen[0]!.text).not.toBe(product.valueProps[0]);
    }
  });
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

describe("a film without a voice", () => {
  const span = {
    id: "s1",
    flowId: "f",
    flowTitle: "Flow",
    in: 0,
    out: 4,
    seconds: 4,
    actions: ["Open"],
    stepIds: ["a"],
    frameAt: 1,
  };
  const beats = (title?: string) => ({
    arc: "launch",
    beats: [
      { role: "hook", onScreen: [], motion: { kind: "reveal", emotion: "bold" }, intent: "x" },
      { role: "core", spanId: "s1", onScreen: title ? [{ kind: "title", text: title }] : [], motion: { kind: "reveal", emotion: "bold" }, intent: "x" },
      { role: "cta", onScreen: [], motion: { kind: "hold", emotion: "bold" }, intent: "x" },
    ],
  });

  it("needs a short title on every shot", () => {
    const check = (title?: string) => checkDraft(beats(title) as never, [span] as never, 30, "launch", true);
    expect(check("Plan every quarter")).toEqual([]);
    expect(check().join()).toMatch(/needs an onScreen title/);
    expect(check("Plan every single quarter ahead").join()).toMatch(/over 4 words/);
    expect(checkDraft(beats() as never, [span] as never, 30, "launch", false)).toEqual([]);
  });

  it("doesn't mind footage longer than the film: it's sped up to fit", () => {
    expect(checkDraft(beats("Go") as never, [{ ...span, seconds: 90 }] as never, 30, "launch", true)).toEqual([]);
    expect(checkDraft(beats("Go") as never, [{ ...span, seconds: 90 }] as never, 30, "launch", false).join()).toMatch(/well over/);
  });

  it("takes empty lines only without a voice", () => {
    const board = { schemaVersion: 1, arc: "launch", edit: "trailer", beats: [{ id: "b", role: "core", onScreen: [], motion: { kind: "reveal", emotion: "x" }, intent: "x", maxSeconds: 3 }] } as never;
    const draft = { hook: "h", titleCard: "t", cta: "c", posting: { title: "t", description: "d", hashtags: [] }, lines: [{ beatId: "b", text: "", onScreen: [] }] } as never;
    expect(checkScript(draft, board, "en", true)).toEqual([]);
    expect(checkScript(draft, board, "en", false).join()).toMatch(/is empty/);
  });
});

describe("the copy lint", () => {
  const product = { name: "Sarvam", oneLiner: "AI for India in 22 languages", valueProps: ["Voice agents that sound human"], keyTerms: ["Bulbul", "Indus"] };
  const copy = (onScreen: string[], over = {}) => ({ titleCard: "Built in India", hook: "Built in India", cta: "Try Sarvam APIs", onScreen, ...over });

  it("passes copy that is true of this product", () => {
    expect(copyIssues(copy(["Voices that sound Indian", "22 languages", "Write Tamil. Hear Tamil."]), "en", product)).toEqual([]);
  });

  it("flags stock phrases, numbers the product never stated, and lines built the same way", () => {
    expect(copyIssues(copy(["Ship faster"]), "en")).toEqual([expect.stringMatching(/stock phrase \("ship faster"\)/)]);
    expect(copyIssues(copy([], { cta: "Get started with Linear" }), "en")).toEqual([expect.stringMatching(/get started/)]);
    expect(copyIssues(copy(["10x faster calls"]), "en", product)).toEqual([expect.stringMatching(/says 10x/)]);
    expect(copyIssues(copy(["One click", "One platform", "One voice"]), "en", product)).toEqual([expect.stringMatching(/3 on-screen lines open with "one"/)]);
  });

  it("leaves other languages' wording alone", () => {
    expect(copyIssues(copy(["Ship faster"]), "hi")).toEqual([]);
  });
});

describe("art direction", () => {
  const inv = (over: Partial<import("@agentcast/shared").Inventory> = {}): import("@agentcast/shared").Inventory => ({
    typing: false, board: false, list: false, panel: false, cards: false, clicks: 0, captures: 0, logo: "none", hero: false, theme: "dark", colourful: false, density: 2, layers: {}, outputs: 0, cloud: 0, imagery: 0, ...over,
  });
  const skeletons = [
    { id: "modules", name: "Label, then proof", feel: "", suits: [] },
    { id: "rapid", name: "Rapid-fire", feel: "", suits: ["board", "list", "panel", "page"] },
    { id: "glide", name: "One take", feel: "", suits: ["prompt", "list", "panel"] },
    { id: "type-led", name: "Type-led", feel: "", suits: ["page", "prompt"] },
  ];
  const linear = { oneLiner: "The product development system for teams and agents", valueProps: ["Plan roadmaps", "Track issues"], keyTerms: ["Projects", "Cycles"] };
  const sarvam = { oneLiner: "India-built AI platform for voice, documents, agents", valueProps: [], keyTerms: ["Text to Speech", "bulbul:v4-flash"] };

  it("reads the product's type from its brief", () => {
    expect(productTypeOf(linear)).toBe("project-tool");
    expect(productTypeOf(sarvam)).toBe("voice-audio");
  });

  it("gives a project tool and a voice product different films, kept to what was recorded", () => {
    const lin = rulesDirection({ productType: "project-tool", inventory: inv({ board: true, panel: true, list: true, cards: true, clicks: 5, logo: "vector", logoKind: "mark+wordmark" }), skeletons, shape: "board", seed: "linear.app" });
    expect(lin).toMatchObject({ skeletonId: "rapid", brand: { logo: "lockup", cursor: "hand", world: "bloom", opener: "logo" }, by: "rules" });
    expect(lin.featured).toEqual(["cards", "panel", "build"]);
    // With its pages captured, it opens on a wall of them.
    expect(rulesDirection({ productType: "project-tool", inventory: inv({ board: true, cards: true, captures: 9, logoKind: "mark+wordmark" }), skeletons, shape: "board", seed: "linear.app" }).featured).toEqual(["wall", "cards", "build"]);
    const sv = rulesDirection({ productType: "voice-audio", inventory: inv({ typing: true, panel: true, clicks: 3, logo: "vector", logoKind: "wordmark", theme: "light", hero: true }), skeletons, shape: "prompt", seed: "sarvam.ai" });
    // Its captured accent is grey, so no colour field: a plain light ground; a wordmark, so it opens on its line.
    expect(sv).toMatchObject({ skeletonId: "type-led", brand: { logo: "letters", cursor: "hand", world: "plain", opener: "line" } });
    // No output was kept from this recording, so the glow pill and the panel carry it; with one, it plays.
    expect(sv.featured).toEqual(["glow-pill", "panel"]);
    expect(rulesDirection({ productType: "voice-audio", inventory: inv({ typing: true, outputs: 1, logoKind: "wordmark" }), skeletons, shape: "prompt", seed: "sarvam.ai" }).featured).toEqual(["glow-pill", "output"]);
  });

  it("takes out what the job or the compiler can't back, and says so", () => {
    const d = rulesDirection({ productType: "other", inventory: inv(), skeletons, shape: "page", seed: "x" });
    const checked = checkDirection({ ...d, skeletonId: "glide", featured: ["mascot", "prompt"], brand: { logo: "lockup", cursor: "hand", world: "plain", opener: "line" } }, { inventory: inv({ logo: "raster", logoKind: "wordmark" }), skeletons, shape: "page", seed: "x" });
    expect(checked.featured).toEqual([]);
    expect(checked.brand).toEqual({ logo: "letters", cursor: "none", world: "plain", opener: "line" });
    // Other companies' logos only with consent: none counted, so no orbit.
    expect(checkDirection({ ...d, featured: ["orbit"] }, { inventory: inv(), skeletons, shape: "page", seed: "x" }).featured).toEqual([]);
    expect(checked.skeletonId).not.toBe("glide");
    expect(checked.changed.join("\n")).toMatch(/not in the compiler yet[\s\S]*doesn't have what it needs[\s\S]*wordmark[\s\S]*no recorded clicks/);
  });

  it("keeps captured objects optional and validates deliberate imagery choices", () => {
    const sv = rulesDirection({ productType: "voice-audio", inventory: inv({ typing: true, imagery: 5, colourful: true, theme: "light", logoKind: "wordmark" }), skeletons, shape: "prompt", seed: "sarvam.ai" });
    expect(sv.brand.world).toBe("field");
    const one = checkDirection({ ...sv, brand: { ...sv.brand, world: "imagery" } }, { inventory: inv({ imagery: 1, colourful: true, theme: "light" }), skeletons, shape: "prompt", seed: "x" });
    expect(one.brand.world).toBe("field");
    expect(one.changed.join()).toMatch(/one object isn't a world/);
  });

  it("keeps a shot call's headline only when the site or the script says it", () => {
    const shots = [{ beatId: "a", title: "x", clicks: 2, typed: true, outputs: 1 }, { beatId: "b", title: "y", clicks: 0, typed: false, outputs: 0 }];
    const { shots: kept, changed } = checkShots(
      { a: { crop: "acted", headline: "Built for the depth of Indian speech." }, b: { crop: "acted", headline: "The best TTS on earth" }, z: { crop: "page" } },
      { shots, sources: ["## Built for the depth of Indian speech\nNot just speaking India's languages"] },
    );
    expect(kept).toEqual({ a: { crop: "acted", headline: "Built for the depth of Indian speech" }, b: { crop: "focus" } });
    expect(changed.join("\n")).toMatch(/b: acted crop → focus[\s\S]*isn't in the site's text[\s\S]*no such shot/);
  });

  it("checks the director's call, and uses the rules when its turn fails", async () => {
    const product = { schemaVersion: 1 as const, url: "https://x.example", name: "X", pages: [], audience: "a", tone: [], ...linear };
    const creative = { schemaVersion: 1 as const, audience: "teams", goal: "g", targetSeconds: 30, tone: ["calm"], personality: "premium" as const, cta: "Try", mustShow: [], avoid: [], inferred: true, summary: "s" };
    const input = { product, creative, inventory: inv({ cards: true, clicks: 2 }), skeletons, shape: "board", seed: "x" };
    const choice = { productType: "project-tool", skeletonId: "rapid", brand: { logo: "fade", cursor: "hand", world: "bloom", opener: "line" }, featured: ["mascot", "cards"], avoid: [], reasons: { skeleton: "fast" } };
    const llm: Llm = { json: async ({ schema }) => schema.parse(choice) };
    const made = await directArt(llm, input);
    expect(made).toMatchObject({ by: "director", skeletonId: "rapid", featured: ["cards"] });
    const failing: Llm = { json: async () => { throw new Error("llm.limit"); } };
    expect(await directArt(failing, input)).toMatchObject({ by: "rules", productType: "project-tool" });
  });
});
