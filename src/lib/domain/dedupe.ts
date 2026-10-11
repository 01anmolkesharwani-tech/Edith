/** Duplicate detection for contacts. Email is one signal, never the sole identifier. */
import { normalizeEmail, normalizePersonName } from "@/lib/normalize";

export interface DedupeCandidate {
  id: string;
  fullName: string;
  companyId: string | null;
  email?: string | null;
  profileUrl?: string | null;
}

export interface DuplicateMatch {
  id: string;
  reason: "EMAIL" | "PROFILE_URL" | "NAME_AND_COMPANY" | "NAME_ONLY";
  strength: "STRONG" | "POSSIBLE";
}

function normProfileUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}

export function findDuplicates(target: Omit<DedupeCandidate, "id"> & { id?: string }, pool: DedupeCandidate[]): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  const email = normalizeEmail(target.email);
  const purl = normProfileUrl(target.profileUrl);
  const name = normalizePersonName(target.fullName);
  for (const c of pool) {
    if (c.id === target.id) continue;
    if (email && normalizeEmail(c.email) === email) {
      out.push({ id: c.id, reason: "EMAIL", strength: "STRONG" });
      continue;
    }
    if (purl && normProfileUrl(c.profileUrl) === purl) {
      out.push({ id: c.id, reason: "PROFILE_URL", strength: "STRONG" });
      continue;
    }
    const cname = normalizePersonName(c.fullName);
    if (name && cname === name) {
      if (target.companyId && c.companyId === target.companyId) out.push({ id: c.id, reason: "NAME_AND_COMPANY", strength: "STRONG" });
      else if (!target.companyId || !c.companyId) out.push({ id: c.id, reason: "NAME_ONLY", strength: "POSSIBLE" });
    }
  }
  return out;
}
