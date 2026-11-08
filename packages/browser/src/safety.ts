/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import type { Locator, Page } from "playwright-core";

export const SECRET =
  /pass(word|code|phrase)|\botp\b|\bpin\b|secret|token|api.?key|card.?number|cvv|cvc/i;
export const DESTRUCTIVE =
  /\b(delete|remove|destroy|pay|purchase|buy now|checkout|place order|send|submit|invite|publish|subscribe|unsubscribe|contact sales|request demo|cancel (my )?(plan|subscription)|deactivate)\b/i;

/** Keyboard activation must obey the same boundary as clicking an observed control. */
export async function checkControlAction(
  page: Page,
  target: Locator | undefined,
  key: string,
  checkUrl: (url: string) => unknown,
) {
  const read = (element: Element | null) => {
    const name = (node: Element | null): string => {
      if (!node || node.tagName === "BODY" || node.tagName === "HTML")
        return "";
      return (
        node
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ") ||
        node.getAttribute("aria-label") ||
        ("labels" in node
          ? [...((node as HTMLInputElement).labels ?? [])]
              .map((label) => label.textContent)
              .join(" ")
          : "") ||
        node.getAttribute("title") ||
        node.textContent ||
        ""
      ).trim();
    };
    const input =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement;
    const form =
      input || element instanceof HTMLButtonElement ? element.form : undefined;
    const submitter = form
      ? [...form.elements].find(
          (node) =>
            (node instanceof HTMLButtonElement && node.type === "submit") ||
            (node instanceof HTMLInputElement &&
              ["submit", "image"].includes(node.type)),
        )
      : undefined;
    return {
      name: name(element),
      tag: element?.tagName,
      secret:
        element instanceof HTMLInputElement && element.type === "password",
      placeholder: element?.getAttribute("placeholder") ?? "",
      editable:
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement &&
          [
            "text",
            "search",
            "email",
            "url",
            "tel",
            "number",
            "password",
          ].includes(element.type)) ||
        (element instanceof HTMLElement && element.isContentEditable),
      href: element instanceof HTMLAnchorElement ? element.href : undefined,
      submits: Boolean(
        form &&
        ((element instanceof HTMLButtonElement && element.type === "submit") ||
          (element instanceof HTMLInputElement &&
            !["button", "checkbox", "radio", "range", "color", "file"].includes(
              element.type,
            ))),
      ),
      submitButton:
        (element instanceof HTMLButtonElement && element.type === "submit") ||
        (element instanceof HTMLInputElement &&
          ["submit", "image"].includes(element.type)),
      formName: name(form ?? null).slice(0, 1000),
      formAction: form?.action,
      submitterName: name(submitter ?? null),
      search:
        (element instanceof HTMLInputElement && element.type === "search") ||
        form?.getAttribute("role") === "search",
    };
  };
  const focused = target ?? page.locator(":focus");
  const count = await focused.count();
  if (count > 1) throw new Error("Focused keyboard target is ambiguous");
  const state = await (count ? focused : page.locator("body")).evaluate(read);
  if (state.secret || SECRET.test(`${state.name} ${state.placeholder}`))
    throw new Error("Sign in manually using sign-in-once");
  if (["Delete", "Backspace"].includes(key) && !state.editable)
    throw new Error("Deletion keys require an editable observed field");
  if (!["Enter", "Space", "click"].includes(key)) return;
  if (["BODY", "HTML"].includes(state.tag ?? ""))
    throw new Error("Keyboard activation requires an observed control");
  if (DESTRUCTIVE.test(state.name))
    throw new Error(
      "Destructive or outward-facing keyboard activation is not allowed",
    );
  if (state.href) checkUrl(state.href);
  if (
    state.submits &&
    (key === "click"
      ? state.submitButton
      : key === "Enter" || state.submitButton)
  ) {
    if (
      DESTRUCTIVE.test(state.submitterName) ||
      /contact|feedback|newsletter|checkout|payment|billing|sign.?in|log.?in|register|sign.?up/i.test(
        state.formName,
      )
    )
      throw new Error("Outward-facing form submission is not allowed");
    if (!state.search && !state.submitterName)
      throw new Error(
        "Implicit form submission needs an explicit observed submit control",
      );
    if (state.formAction) checkUrl(state.formAction);
  }
}
