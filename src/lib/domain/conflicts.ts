/**
 * Source-conflict detection: flags contradictory company affiliations, titles and
 * contact details across evidence records for manual review.
 */

export interface EvidenceValue {
  field: string;
  value: string;
  sourceUrl?: string | null;
  sourceType: string;
  observedAt: Date | string;
}

const CHECKED_FIELDS = ["TITLE", "COMPANY", "EMAIL", "PHONE"] as const;

function norm(field: string, v: string): string {
  const s = v.toLowerCase().trim();
  if (field === "PHONE") return s.replace(/[^\d]/g, "").slice(-10);
  if (field === "COMPANY") return s.replace(/[^a-z0-9]/g, "").replace(/(ltd|limited|inc|llp|llc|plc|pvt|private)$/g, "");
  return s.replace(/[^a-z0-9@.+]/g, " ").replace(/\s+/g, " ").trim();
}

function label(e: EvidenceValue): string {
  const src = e.sourceUrl ? safeHost(e.sourceUrl) : e.sourceType.toLowerCase().replace(/_/g, " ");
  return `"${e.value}" (${src})`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export function detectConflicts(
  evidence: EvidenceValue[],
  current: { title?: string | null; company?: string | null; email?: string | null; phone?: string | null },
): string[] {
  const reasons: string[] = [];
  for (const field of CHECKED_FIELDS) {
    const items = evidence.filter((e) => e.field === field && e.value.trim());
    const distinct = new Map<string, EvidenceValue>();
    for (const e of items) {
      const key = norm(field, e.value);
      const prev = distinct.get(key);
      if (!prev || new Date(e.observedAt) > new Date(prev.observedAt)) distinct.set(key, e);
    }
    if (distinct.size > 1) {
      const vals = [...distinct.values()].slice(0, 3).map(label).join(" vs ");
      reasons.push(`Conflicting ${field.toLowerCase()} values across sources: ${vals}.`);
    }
    const cur = current[field.toLowerCase() as keyof typeof current];
    if (cur && items.length) {
      const newest = [...items].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())[0];
      if (norm(field, newest.value) !== norm(field, cur) && distinct.size <= 1) {
        reasons.push(`Current ${field.toLowerCase()} "${cur}" differs from the most recent evidence ${label(newest)}.`);
      }
    }
  }
  return reasons;
}
