/** Normalisation helpers used for duplicate detection and matching. */

const HONORIFICS = /^(mr|mrs|ms|miss|dr|prof|sir|ca|cfa)\.?\s+/i;
const SUFFIXES = /,?\s+(jr|sr|ii|iii|iv|phd|mba|cfa|ca|cpa)\.?$/i;

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** "Dr. Priya  K. Sharma, MBA" -> "priya sharma" (middle initials dropped). */
export function normalizePersonName(name: string): string {
  let n = stripDiacritics(name).trim().replace(/\s+/g, " ");
  n = n.replace(HONORIFICS, "").replace(SUFFIXES, "");
  const parts = n
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1 || p === "");
  return parts.filter(Boolean).join(" ");
}

export function splitName(name: string): { firstName: string; lastName: string } {
  const clean = stripDiacritics(name).replace(HONORIFICS, "").replace(SUFFIXES, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

export function normalizeCompanyName(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(the|inc|incorporated|ltd|limited|llc|llp|plc|pvt|private|corp|corporation|co|company|gmbh|ag|sa|nv|bv|group|holdings)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e.length ? e : null;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

/** Extract a bare registrable-ish domain from a URL or domain string. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
    const host = new URL(s).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}
