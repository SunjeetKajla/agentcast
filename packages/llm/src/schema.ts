import { z } from "zod";

// zod → JSON Schema for the CLIs' structured output.
// Claude Code takes ordinary JSON Schema. Codex (OpenAI structured outputs, strict mode) needs a subset:
// every property required, no free-form maps, no oneOf/prefixItems/default/format. strictSchema() rewrites
// the schema into that subset, and restore() undoes the rewrite on the answer before zod checks it:
// optional fields travel as required-but-nullable, maps travel as JSON strings.

type Node = Record<string, any>;

export function jsonSchemaOf(schema: z.ZodType): Node {
  const node = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Node;
  delete node.$schema;
  return node;
}

const isMap = (n: Node) =>
  n.type === "object" && !n.properties && (typeof n.additionalProperties === "object" || n.propertyNames !== undefined);

const acceptsNull = (n: Node | undefined): boolean =>
  !n || n.type === "null" || (Array.isArray(n.type) && n.type.includes("null")) || (n.anyOf ?? n.oneOf ?? []).some(acceptsNull);

function nullable(n: Node): Node {
  if (acceptsNull(n)) return n;
  if (typeof n.type === "string" && !n.anyOf) {
    const out: Node = { ...n, type: [n.type, "null"] };
    if (Array.isArray(n.enum)) out.enum = [...n.enum, null];
    return out;
  }
  if (n.anyOf) return { ...n, anyOf: [...n.anyOf, { type: "null" }] };
  return { anyOf: [n, { type: "null" }] };
}

export function strictSchema(node: Node): Node {
  const branches = node.anyOf ?? node.oneOf;
  if (branches) {
    const out: Node = { anyOf: branches.map(strictSchema) };
    if (node.description) out.description = node.description;
    return out;
  }
  if (isMap(node)) {
    const what = node.description ? `: ${node.description}` : "";
    return { type: "string", description: `A JSON object, encoded as a string${what}` };
  }
  const { default: _d, format: _f, propertyNames: _p, prefixItems, items, const: constant, examples: _e, ...out } = node;
  if (constant !== undefined) out.enum = [constant];
  if (node.type === "object") {
    const required = new Set<string>(node.required ?? []);
    const props: Node = {};
    for (const [key, child] of Object.entries<Node>(node.properties ?? {})) {
      const strict = strictSchema(child);
      props[key] = required.has(key) ? strict : nullable(strict);
    }
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  if (node.type === "array") {
    if (Array.isArray(prefixItems)) {
      const unique = [...new Map(prefixItems.map((p: Node) => [JSON.stringify(strictSchema(p)), strictSchema(p)])).values()];
      out.items = unique.length === 1 ? unique[0] : { anyOf: unique };
    } else if (items && typeof items === "object") {
      out.items = strictSchema(items);
    }
  }
  return out;
}

function fits(n: Node, value: unknown): boolean {
  const types: string[] = Array.isArray(n.type) ? n.type : n.type ? [n.type] : [];
  const kind =
    value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (types.length && !types.includes(kind) && !(kind === "integer" && types.includes("number"))) {
    // a map that travelled as a string
    if (!(kind === "string" && isMap(n))) return false;
  }
  if (n.const !== undefined && n.const !== value) return false;
  if (kind === "object" && n.properties) {
    for (const [key, child] of Object.entries<Node>(n.properties)) {
      const v = (value as Node)[key];
      if (child.const !== undefined && v !== undefined && v !== child.const) return false;
      if (Array.isArray(child.enum) && v !== undefined && v !== null && !child.enum.includes(v)) return false;
    }
  }
  return true;
}

/** Undo strictSchema's rewrite on an answer: drop nulls standing in for missing fields, decode maps. */
export function restore(node: Node, value: unknown): unknown {
  const branches: Node[] | undefined = node.anyOf ?? node.oneOf;
  if (branches) {
    const branch = branches.find((b) => fits(b, value));
    return branch ? restore(branch, value) : value;
  }
  if (isMap(node) && typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      const child = node.prefixItems?.[i] ?? (typeof node.items === "object" ? node.items : undefined);
      return child ? restore(child, v) : v;
    });
  }
  const required = new Set<string>(node.required ?? []);
  const out: Node = {};
  for (const [key, v] of Object.entries(value as Node)) {
    const child: Node | undefined = node.properties?.[key] ?? (isMap(node) ? node.additionalProperties : undefined);
    if (v === null && !required.has(key) && !acceptsNull(child ?? { type: "string" })) continue;
    out[key] = child ? restore(child, v) : v;
  }
  return out;
}
