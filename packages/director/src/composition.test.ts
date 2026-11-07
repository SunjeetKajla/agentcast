import { describe, expect, it } from "vitest";
import { sceneIssues } from "./composition.ts";

const good = (id: string, body = "") => `<template>
<div id="root" data-composition-id="${id}" data-width="960" data-height="540">${body}</div>
<script>(function () { var S = AC.scene("${id}", window.__hyperframes.getVariables()); ${""}S.done(); })();</script>
</template>`;

describe("the scene contract", () => {
  it("passes a well-formed scene", () => {
    expect(sceneIssues("b3", good("b3", '<img src="assets/logo.png">'))).toEqual([]);
  });

  it("refuses network, clocks, randomness, remote files and secrets", () => {
    const messages = (text: string, secrets?: string[]) => sceneIssues("b3", text, secrets).map((i) => i.message).join("\n");
    expect(messages(good("b3", "<script>fetch('/x')</script>"))).toMatch(/no network/);
    expect(messages(good("b3", "<script>var t = Date.now()</script>"))).toMatch(/no clocks/);
    expect(messages(good("b3", "<script>Math.random()</script>"))).toMatch(/no clocks/);
    expect(messages(good("b3", '<img src="https://evil.example/x.png">'))).toMatch(/assets/);
    expect(messages(good("b3", "<p>hunter22</p>"), ["hunter22"])).toMatch(/secret/);
    expect(messages(good("b3", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("");
  });

  it("needs the file's own id and a registered timeline inside a template", () => {
    expect(sceneIssues("b3", good("b4")).map((i) => i.message).join("\n")).toMatch(/data-composition-id="b3"/);
    expect(sceneIssues("b3", '<div data-composition-id="b3"></div>').length).toBeGreaterThanOrEqual(2);
  });
});
