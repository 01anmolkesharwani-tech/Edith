/**
 * Rule-based classification of professional titles. Deliberately transparent:
 * every decision can be explained by the keyword that triggered it.
 */

export type Seniority = "INTERN" | "JUNIOR" | "MID" | "SENIOR" | "LEADER" | "EXECUTIVE" | "UNKNOWN";

export type RecipientType =
  | "RECRUITER"
  | "FUNCTIONAL_LEADER"
  | "BUSINESS_HEAD"
  | "SENIOR"
  | "JUNIOR"
  | "NETWORKING";

export const RECIPIENT_TYPE_LABELS: Record<RecipientType | "OPEN_ROLE" | "FOLLOW_UP", string> = {
  RECRUITER: "Recruiter / talent acquisition",
  FUNCTIONAL_LEADER: "Functional leader",
  BUSINESS_HEAD: "Business head",
  SENIOR: "Senior professional",
  JUNIOR: "Junior professional",
  NETWORKING: "General networking",
  OPEN_ROLE: "Open-role application",
  FOLLOW_UP: "Follow-up",
};

const RECRUITER_RE =
  /\b(recruit\w*|talent (acquisition|partner|sourc\w*)|campus (hiring|relations|recruit\w*)|hr business partner|human resources|people (partner|operations)|hiring (manager|partner)|sourcer|staffing)\b/i;

const EXECUTIVE_RE =
  /\b(chief \w+ officer|ceo|cfo|cmo|coo|cto|president|founder|co-?founder|managing partner|chair(man|woman|person)?|executive director|country (head|manager))\b/i;
const LEADER_RE =
  /\b(head|director|vice president|vp|svp|evp|avp|partner|managing director|md|general manager|gm|principal|leader|lead)\b/i;
const SENIOR_RE = /\b(senior|sr\.?|manager|associate director|assistant vice president|vice-president|executive director)\b/i;
const JUNIOR_RE = /\b(analyst|associate|executive|coordinator|assistant|specialist|officer|trainee|graduate|management trainee)\b/i;
const INTERN_RE = /\b(intern|internship|summer analyst|apprentice)\b/i;
const BUSINESS_HEAD_RE =
  /\b(business (unit )?head|head of business|general manager|country (head|manager)|managing director|ceo|president|business leader|bu head|p&l)\b/i;

export function classifySeniority(title: string | null | undefined): Seniority {
  if (!title) return "UNKNOWN";
  const t = title.trim();
  if (INTERN_RE.test(t)) return "INTERN";
  if (EXECUTIVE_RE.test(t)) return "EXECUTIVE";
  // "Associate Director" / "Assistant Vice President" are senior, not junior.
  if (/\b(associate director|assistant vice president|avp)\b/i.test(t)) return "SENIOR";
  if (LEADER_RE.test(t) && !/\bteam lead\b/i.test(t)) return "LEADER";
  if (SENIOR_RE.test(t)) return "SENIOR";
  if (JUNIOR_RE.test(t)) return "JUNIOR";
  return "MID";
}

export function isRecruiterTitle(title: string | null | undefined): boolean {
  return !!title && RECRUITER_RE.test(title);
}

export function classifyRecipientType(title: string | null | undefined): RecipientType {
  if (!title) return "NETWORKING";
  if (isRecruiterTitle(title)) return "RECRUITER";
  if (BUSINESS_HEAD_RE.test(title)) return "BUSINESS_HEAD";
  const seniority = classifySeniority(title);
  if (seniority === "EXECUTIVE") return "BUSINESS_HEAD";
  if (seniority === "LEADER") return "FUNCTIONAL_LEADER";
  if (seniority === "SENIOR") return "SENIOR";
  if (seniority === "JUNIOR" || seniority === "INTERN") return "JUNIOR";
  return "NETWORKING";
}

/** Case-insensitive keyword match on word boundaries; returns the keywords found. */
export function matchKeywords(text: string | null | undefined, keywords: string[]): string[] {
  if (!text) return [];
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9&+\s]/g, " ").replace(/\s+/g, " ")} `;
  const found: string[] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase().replace(/[^a-z0-9&+\s]/g, " ").replace(/\s+/g, " ").trim();
    if (k && hay.includes(` ${k} `)) found.push(kw);
  }
  return found;
}

/** Heuristic: does the text look like a professional job title? */
export function looksLikeJobTitle(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 120) return false;
  return (
    RECRUITER_RE.test(t) ||
    EXECUTIVE_RE.test(t) ||
    LEADER_RE.test(t) ||
    SENIOR_RE.test(t) ||
    JUNIOR_RE.test(t) ||
    /\b(marketing|brand|finance|banking|valuation|treasury|strategy|category|sales|investment|advisory|controller|accountant|engineer|consultant|counsel|officer|board member|trustee)\b/i.test(
      t,
    )
  );
}
