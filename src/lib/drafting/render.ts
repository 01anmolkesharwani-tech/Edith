/**
 * Minimal logic-less template renderer (Mustache subset). No code execution.
 *   {{path.to.value}}        – inserted value (missing → empty, reported as missing)
 *   {{#path}} … {{/path}}    – section rendered only when the value is present
 *   {{^path}} … {{/path}}    – section rendered only when the value is missing
 */

export type TemplateContext = Record<string, unknown>;

export interface RenderResult {
  text: string;
  missing: string[]; // variables referenced outside conditional sections that had no value
}

function lookup(ctx: TemplateContext, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function present(v: unknown): boolean {
  if (v == null || v === false) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

const SECTION_RE = /\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function render(template: string, ctx: TemplateContext): RenderResult {
  const missing = new Set<string>();
  let text = template;
  // Resolve sections innermost-first by repeatedly matching the first complete section.
  for (let guard = 0; guard < 500; guard++) {
    const m = SECTION_RE.exec(text);
    if (!m) break;
    const [whole, kind, path, inner] = m;
    const show = kind === "#" ? present(lookup(ctx, path)) : !present(lookup(ctx, path));
    text = text.slice(0, m.index) + (show ? inner : "") + text.slice(m.index + whole.length);
  }
  text = text.replace(VAR_RE, (_, path: string) => {
    const v = lookup(ctx, path);
    if (!present(v)) {
      missing.add(path);
      return "";
    }
    return Array.isArray(v) ? joinList(v.map(String)) : String(v);
  });
  return { text: tidy(text), missing: [...missing] };
}

export function joinList(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Clean whitespace artefacts left by removed sections. */
export function tidy(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").replace(/ ([,.;:!?])/g, "$1").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Variables referenced in a template (for the template editor help). */
export function referencedVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{[#^/]?\s*([\w.]+)\s*\}\}/g)) out.add(m[1]);
  return [...out];
}
