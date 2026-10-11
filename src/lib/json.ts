/** Parse a JSON string array stored in SQLite; tolerate bad data. */
export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function parseObject<T extends object>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Split free text ("a, b\nc") into a de-duplicated, trimmed list. */
export function splitList(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const v = part.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

export function toJsonList(items: string[]): string {
  return JSON.stringify(items);
}
