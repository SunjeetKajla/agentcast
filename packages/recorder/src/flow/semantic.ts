import type { Locator, Page } from "playwright-core";

export type AriaRole = Parameters<Page["getByRole"]>[0];
const roles = new Set<string>([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
]);

export function isAriaRole(value: string): value is AriaRole {
  return roles.has(value);
}

export type SemanticLocator =
  | { kind: "role"; role: AriaRole; name: string }
  | { kind: "label" | "placeholder" | "text"; name: string };

export function toLocator(page: Page, spec: SemanticLocator): Locator {
  switch (spec.kind) {
    case "role":
      return spec.name
        ? page.getByRole(spec.role, { name: spec.name, exact: true })
        : page.getByRole(spec.role);
    case "label":
      return page.getByLabel(spec.name, { exact: true });
    case "placeholder":
      return page.getByPlaceholder(spec.name, { exact: true });
    case "text":
      return page.getByText(spec.name, { exact: true });
  }
}

export function serializeLocator(spec: SemanticLocator): string {
  const name = JSON.stringify(spec.name);
  if (spec.kind === "role")
    return spec.name
      ? `getByRole(${JSON.stringify(spec.role)}, { name: ${name}, exact: true })`
      : `getByRole(${JSON.stringify(spec.role)})`;
  const method = {
    label: "getByLabel",
    placeholder: "getByPlaceholder",
    text: "getByText",
  }[spec.kind];
  return `${method}(${name}, { exact: true })`;
}

/** Decode legacy single-quoted fixtures as data, with no eval/Function/JS parser. */
function readString(literal: string): string {
  if (literal[0] === '"') return JSON.parse(literal) as string;
  let output = "";
  for (let i = 1; i < literal.length - 1; i++) {
    const char = literal[i]!;
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = literal[++i]!;
    const escaped: Record<string, string> = {
      "'": "'",
      '"': '"',
      "\\": "\\",
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
    };
    if (next in escaped) output += escaped[next];
    else if (
      next === "u" &&
      /^[\da-f]{4}$/i.test(literal.slice(i + 1, i + 5))
    ) {
      output += String.fromCharCode(parseInt(literal.slice(i + 1, i + 5), 16));
      i += 4;
    } else throw new Error("Unsupported locator string escape");
  }
  return output;
}

const rolePattern =
  /^getByRole\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,\s*\{\s*name\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,\s*exact\s*:\s*true\s*\}\s*\)$/;
const bareRolePattern =
  /^getByRole\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)$/;
const textPattern =
  /^(getByLabel|getByPlaceholder|getByText)\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,\s*\{\s*exact\s*:\s*true\s*\}\s*\)$/;

/** Only our exact semantic grammar is accepted; CSS, chaining and arbitrary code are rejected. */
export function parseLocator(value: string): SemanticLocator | undefined {
  if (value.length > 16_384) return undefined;
  try {
    const bare = bareRolePattern.exec(value.trim());
    if (bare) {
      const role = readString(bare[1]!);
      return isAriaRole(role) ? { kind: "role", role, name: "" } : undefined;
    }
    const role = rolePattern.exec(value.trim());
    if (role) {
      const name = readString(role[2]!);
      const ariaRole = readString(role[1]!);
      return isAriaRole(ariaRole) && name
        ? { kind: "role", role: ariaRole, name }
        : undefined;
    }
    const match = textPattern.exec(value.trim());
    if (!match) return undefined;
    const name = readString(match[2]!);
    const kind = {
      getByLabel: "label",
      getByPlaceholder: "placeholder",
      getByText: "text",
    }[match[1]!] as "label" | "placeholder" | "text";
    return name ? { kind, name } : undefined;
  } catch {
    return undefined;
  }
}
