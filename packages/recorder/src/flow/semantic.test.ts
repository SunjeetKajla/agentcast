import { describe, expect, it } from "vitest";
import {
  parseLocator,
  serializeLocator,
  type SemanticLocator,
} from "./semantic.ts";
import {
  normalizeTarget,
  rankFuzzy,
  snapshotCandidates,
  textSimilarity,
} from "./fuzzy.ts";

describe("safe semantic cache grammar", () => {
  it.each([
    { kind: "role", role: "button", name: 'Save "draft" \\ safely' },
    { kind: "label", name: "Owner's name" },
    { kind: "placeholder", name: "Type\nhere" },
    { kind: "text", name: "Backed by▲ Vercel" },
  ] satisfies SemanticLocator[])("round-trips %o", (spec) => {
    expect(parseLocator(serializeLocator(spec))).toEqual(spec);
  });

  it("reads the shared single-quoted fixture representation", () => {
    expect(
      parseLocator("getByRole('button', { name: 'New project', exact: true })"),
    ).toEqual({ kind: "role", role: "button", name: "New project" });
    expect(
      parseLocator("getByLabel('Owner\\'s name', { exact: true })"),
    ).toEqual({ kind: "label", name: "Owner's name" });
  });

  it.each([
    "getByRole('button', { name: 'Save', exact: true }).first()",
    "getByText('Save', {exact:true}); globalThis.pwned = true",
    "getByText(process.env.SECRET, {exact:true})",
    "locator('body')",
    "getByRole('button >> nth=0', {name:'Save',exact:true})",
    "getByText('Save', {exact:false})",
    "getByLabel(`Save`, {exact:true})",
  ])(
    "refuses executable or unsupported cache expressions: %s",
    (expression) => {
      expect(parseLocator(expression)).toBeUndefined();
    },
  );
});

describe("conservative fuzzy matching", () => {
  it("ignores case, symbols, punctuation and spacing without deleting Unicode letters", () => {
    expect(normalizeTarget("Backed by▲ Vercel")).toBe(
      normalizeTarget("BACKED   BY VERCEL"),
    );
    expect(normalizeTarget("नया प्रोजेक्ट")).not.toBe("");
    expect(textSimilarity("Create project", "Create-project!")).toBe(1);
  });

  it("accepts a small typo but rejects broad guesses, short names and different identifiers", () => {
    expect(textSimilarity("Create project", "Create porject")).toBeGreaterThan(
      0.88,
    );
    expect(textSimilarity("Create project", "Delete project")).toBe(0);
    expect(textSimilarity("Go", "No")).toBe(0);
    expect(textSimilarity("Invoice 1234", "Invoice 1235")).toBe(0);
    expect(textSimilarity("Invoice 12-34", "Invoice 1234")).toBe(0);
  });

  it("reads escaped accessible names from ARIA snapshots", () => {
    expect(
      snapshotCandidates(
        '- button "Save \\"draft\\""\n- textbox "Project name"\n- text: button "not a role"',
      ),
    ).toEqual([
      { kind: "role", role: "button", name: 'Save "draft"' },
      { kind: "role", role: "textbox", name: "Project name" },
    ]);
  });

  it("deduplicates the same semantic name and preserves different equally good guesses", () => {
    const candidate = { kind: "text" as const, name: "Create-project!" };
    expect(rankFuzzy("create project", [candidate, candidate])).toHaveLength(1);
    expect(
      rankFuzzy("create project", [
        candidate,
        { kind: "text", name: "CREATE PROJECT" },
      ]),
    ).toHaveLength(2);
  });
});
