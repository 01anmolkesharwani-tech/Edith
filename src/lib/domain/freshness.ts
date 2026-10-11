/**
 * Freshness engine. These categories are heuristics, not guarantees.
 *
 * Key rule: a page retrieved recently is only current evidence if the page is a
 * *live* listing (e.g. an official team page still showing the person). For dated
 * publications (announcements, articles) the publication date is what counts; when
 * the publication date is unknown the evidence age is Unknown, not Fresh.
 */

export type FreshnessCategory = "FRESH" | "RECENT" | "AGING" | "STALE" | "UNKNOWN";

export const FRESHNESS_THRESHOLDS = { FRESH: 30, RECENT: 90, AGING: 180 } as const;

export const FRESHNESS_LABELS: Record<FreshnessCategory, string> = {
  FRESH: "Fresh (≤30 days)",
  RECENT: "Recent (≤90 days)",
  AGING: "Aging (≤180 days)",
  STALE: "Stale (>180 days)",
  UNKNOWN: "Unknown",
};

/** Source types whose content describes the present state when retrieved. */
const LIVE_SOURCE_TYPES = new Set([
  "OFFICIAL_TEAM_PAGE",
  "OFFICIAL_BIO",
  "CAREERS_PAGE",
  "JOB_POSTING",
  "PUBLIC_DIRECTORY",
  "PROFESSIONAL_PROFILE",
]);

export interface EvidenceDates {
  sourceType: string;
  observedAt: Date | string;
  publishedAt?: Date | string | null;
}

const DAY = 86_400_000;

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function categorize(date: Date | string | null | undefined, now = new Date()): FreshnessCategory {
  const d = toDate(date);
  if (!d) return "UNKNOWN";
  const days = (now.getTime() - d.getTime()) / DAY;
  if (days < 0) return "FRESH"; // clock skew – treat as just observed
  if (days <= FRESHNESS_THRESHOLDS.FRESH) return "FRESH";
  if (days <= FRESHNESS_THRESHOLDS.RECENT) return "RECENT";
  if (days <= FRESHNESS_THRESHOLDS.AGING) return "AGING";
  return "STALE";
}

/**
 * The date at which a piece of evidence says the fact was true.
 * - Dated publication with a publish date: the publish date (even if retrieved today).
 * - Live listing: the older of retrieval date and publish date (if a publish date exists).
 * - Dated publication without a publish date: unknown.
 */
export function effectiveEvidenceDate(e: EvidenceDates): Date | null {
  const observed = toDate(e.observedAt);
  const published = toDate(e.publishedAt ?? null);
  if (LIVE_SOURCE_TYPES.has(e.sourceType)) {
    // A live page whose own "last updated" date is very old is not proof of currency.
    if (observed && published && (observed.getTime() - published.getTime()) / DAY > FRESHNESS_THRESHOLDS.AGING) {
      return published;
    }
    return observed;
  }
  if (e.sourceType === "USER_PROVIDED" || e.sourceType === "CSV_IMPORT") {
    // The user's own record: date of entry is the best available, but publish date wins if older.
    return published ?? observed;
  }
  return published;
}

export function freshestEvidenceDate(list: EvidenceDates[]): Date | null {
  let best: Date | null = null;
  for (const e of list) {
    const d = effectiveEvidenceDate(e);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

export interface ContactFreshness {
  overall: FreshnessCategory;
  role: FreshnessCategory;
  email: FreshnessCategory;
  phone: FreshnessCategory;
  emailValidation: FreshnessCategory;
  dates: {
    roleConfirmedAt: Date | null;
    emailLastObservedAt: Date | null;
    phoneLastObservedAt: Date | null;
    emailValidatedAt: Date | null;
    lastRetrievedAt: Date | null;
  };
  notes: string[];
}

export function contactFreshness(
  evidence: (EvidenceDates & { field: string })[],
  emailValidatedAt: Date | string | null | undefined,
  now = new Date(),
): ContactFreshness {
  const byField = (fields: string[]) => evidence.filter((e) => fields.includes(e.field));
  const roleDate = freshestEvidenceDate(byField(["TITLE", "COMPANY"]));
  const emailDate = freshestEvidenceDate(byField(["EMAIL"]));
  const phoneDate = freshestEvidenceDate(byField(["PHONE"]));
  const validated = toDate(emailValidatedAt ?? null);
  const lastRetrieved = evidence.reduce<Date | null>((acc, e) => {
    const d = toDate(e.observedAt);
    return d && (!acc || d > acc) ? d : acc;
  }, null);

  const notes: string[] = [];
  const roleEv = byField(["TITLE", "COMPANY"]);
  if (roleEv.length && !roleDate) {
    notes.push("Role evidence comes from undated publications; currency of the role is unknown.");
  }
  if (lastRetrieved && roleDate && lastRetrieved.getTime() - roleDate.getTime() > FRESHNESS_THRESHOLDS.RECENT * DAY) {
    notes.push("Pages were retrieved recently but the supporting content itself is older.");
  }
  const role = categorize(roleDate, now);
  return {
    overall: role,
    role,
    email: categorize(emailDate, now),
    phone: categorize(phoneDate, now),
    emailValidation: categorize(validated, now),
    dates: {
      roleConfirmedAt: roleDate,
      emailLastObservedAt: emailDate,
      phoneLastObservedAt: phoneDate,
      emailValidatedAt: validated,
      lastRetrievedAt: lastRetrieved,
    },
    notes,
  };
}
