/**
 * Explainable relevance score (0–100). Each component returns its points and the
 * reasons behind them. Missing data earns neutral partial credit rather than zero —
 * missing data is not proof that a contact is irrelevant.
 */
import { classifyRecipientType, isRecruiterTitle, matchKeywords } from "./classify";
import type { FreshnessCategory } from "./freshness";

export interface ScoringProfile {
  targetFunctions: string[];
  targetContactTitles: string[];
  targetIndustries: string[];
  preferredLocations: string[];
  targetRoles: string[];
}

export interface ScoringInput {
  contact: { title?: string | null; department?: string | null; location?: string | null };
  company?: {
    industry?: string | null;
    description?: string | null;
    headquarters?: string | null;
  } | null;
  targetStatus?: "TARGET" | "WATCHING" | "EXCLUDED" | null;
  openingTitles?: string[]; // titles of open roles observed at the company
  titleEvidence?: { sourceType: string; verificationMethod: string } | null;
  emailStatus?: string | null;
  hasEmail?: boolean;
  freshness?: FreshnessCategory;
}

export interface ScoreComponent {
  key: "role" | "decision" | "company" | "fit" | "evidence";
  label: string;
  points: number;
  max: number;
  reasons: string[];
}

export interface ScoreResult {
  total: number;
  components: ScoreComponent[];
  flags: string[];
}

const OFFICIAL_SOURCES = new Set(["OFFICIAL_TEAM_PAGE", "OFFICIAL_BIO", "OFFICIAL_ANNOUNCEMENT", "CAREERS_PAGE"]);

export function scoreContact(profile: ScoringProfile, input: ScoringInput): ScoreResult {
  const flags: string[] = [];
  const title = input.contact.title?.trim() || null;
  const dept = input.contact.department?.trim() || null;
  const recruiter = isRecruiterTitle(title);
  const titleHits = matchKeywords(title, profile.targetContactTitles);
  const fnInTitle = matchKeywords(title, profile.targetFunctions);
  const fnInDept = matchKeywords(dept, profile.targetFunctions);
  const functionMatch = fnInTitle.length > 0 || fnInDept.length > 0;

  // --- Role relevance (30)
  const role: ScoreComponent = { key: "role", label: "Role relevance", points: 0, max: 30, reasons: [] };
  if (!title) {
    role.points = 10;
    role.reasons.push("Title unknown – neutral partial credit (not treated as irrelevant).");
  } else if (titleHits.length) {
    role.points = 30;
    role.reasons.push(`Title matches a target contact title: ${titleHits.join(", ")}.`);
  } else if (recruiter && functionMatch) {
    role.points = 28;
    role.reasons.push(`Recruiter covering a target function (${[...fnInTitle, ...fnInDept].join(", ")}).`);
  } else if (fnInTitle.length) {
    role.points = 24;
    role.reasons.push(`Title mentions target function: ${fnInTitle.join(", ")}.`);
  } else if (recruiter) {
    role.points = 22;
    role.reasons.push("Recruiting / talent role – relevant to hiring across functions.");
  } else if (fnInDept.length) {
    role.points = 18;
    role.reasons.push(`Department matches target function: ${fnInDept.join(", ")}.`);
  } else {
    role.points = 6;
    role.reasons.push("Title does not match the profile's target functions or titles.");
  }

  // --- Decision-making / networking relevance (20)
  const decision: ScoreComponent = {
    key: "decision",
    label: "Hiring authority / networking value",
    points: 0,
    max: 20,
    reasons: [],
  };
  const type = classifyRecipientType(title);
  if (!title) {
    decision.points = 8;
    decision.reasons.push("Seniority unknown – neutral partial credit.");
  } else if (type === "RECRUITER") {
    decision.points = 17;
    decision.reasons.push("Recruiting responsibility: can route the candidate to open roles.");
  } else if ((type === "FUNCTIONAL_LEADER" || type === "BUSINESS_HEAD") && functionMatch) {
    decision.points = 20;
    decision.reasons.push("Likely hiring authority in the target function.");
  } else if (type === "SENIOR" && functionMatch) {
    decision.points = 15;
    decision.reasons.push("Senior professional in the target function – may influence hiring.");
  } else if (type === "JUNIOR" && functionMatch) {
    decision.points = 12;
    decision.reasons.push("Junior professional in the target function – good networking and team insight.");
  } else if (type === "FUNCTIONAL_LEADER" || type === "BUSINESS_HEAD") {
    decision.points = 9;
    decision.reasons.push("Senior leader outside the target function – possible referral value.");
  } else if (type === "SENIOR") {
    decision.points = 7;
    decision.reasons.push("Senior professional outside the target function.");
  } else {
    decision.points = 4;
    decision.reasons.push("Limited hiring or networking relevance identified.");
  }

  // --- Company & industry fit (20)
  const company: ScoreComponent = { key: "company", label: "Company & industry fit", points: 0, max: 20, reasons: [] };
  if (input.targetStatus === "EXCLUDED") {
    flags.push("EXCLUDED_COMPANY");
    company.points = 0;
    company.reasons.push("Company is on this profile's excluded list.");
  } else {
    const industryText = [input.company?.industry, input.company?.description].filter(Boolean).join(" ");
    const industryHits = matchKeywords(industryText, profile.targetIndustries);
    if (!input.company) {
      company.points += 6;
      company.reasons.push("No company linked – neutral partial credit.");
    } else if (industryHits.length) {
      company.points += 12;
      company.reasons.push(`Industry matches target: ${industryHits.join(", ")}.`);
    } else if (!industryText) {
      company.points += 6;
      company.reasons.push("Industry unknown – neutral partial credit.");
    } else {
      company.points += 2;
      company.reasons.push("Industry does not match the profile's target industries.");
    }
    const relevantOpenings = (input.openingTitles ?? []).filter(
      (t) => matchKeywords(t, [...profile.targetRoles, ...profile.targetFunctions]).length > 0,
    );
    if (relevantOpenings.length) {
      company.points += 8;
      company.reasons.push(`${relevantOpenings.length} relevant opening(s) observed.`);
    } else if (input.targetStatus === "TARGET") {
      company.points += 4;
      company.reasons.push("Target company; no relevant opening observed (speculative networking).");
    } else {
      company.points += 2;
      company.reasons.push("No relevant opening observed.");
    }
  }

  // --- Candidate & location fit (15)
  const fit: ScoreComponent = { key: "fit", label: "Candidate & location fit", points: 0, max: 15, reasons: [] };
  const loc = input.contact.location || input.company?.headquarters || null;
  if (!profile.preferredLocations.length) {
    fit.points += 7;
    fit.reasons.push("No location preference configured.");
  } else if (!loc) {
    fit.points += 5;
    fit.reasons.push("Location unknown – neutral partial credit.");
  } else if (matchKeywords(loc, profile.preferredLocations).length) {
    fit.points += 10;
    fit.reasons.push(`Location matches preference (${loc}).`);
  } else {
    fit.points += 2;
    fit.reasons.push(`Location (${loc}) is outside preferred locations.`);
  }
  const roleFitText = [title, dept, ...(input.openingTitles ?? [])].filter(Boolean).join(" | ");
  if (matchKeywords(roleFitText, profile.targetRoles).length) {
    fit.points += 5;
    fit.reasons.push("Team or openings align with the candidate's target roles.");
  } else {
    fit.points += 2;
    fit.reasons.push("No direct alignment with target roles identified.");
  }

  // --- Evidence quality & freshness (15)
  const evidence: ScoreComponent = {
    key: "evidence",
    label: "Evidence quality & freshness",
    points: 0,
    max: 15,
    reasons: [],
  };
  const te = input.titleEvidence;
  if (te && (OFFICIAL_SOURCES.has(te.sourceType) || te.verificationMethod === "USER_CONFIRMED")) {
    evidence.points += 5;
    evidence.reasons.push("Role supported by an official source or confirmed by you.");
  } else if (te) {
    evidence.points += 3;
    evidence.reasons.push("Role supported by a non-official source.");
  } else {
    evidence.reasons.push("No recorded evidence for the role.");
  }
  const es = input.emailStatus ?? "NOT_CHECKED";
  if (!input.hasEmail) {
    evidence.points += 1;
    evidence.reasons.push("No email on record (contact may still be reachable by other means).");
  } else if (es === "PROVIDER_VERIFIED" || es === "PUBLICLY_LISTED") {
    evidence.points += 5;
    evidence.reasons.push(`Email status: ${es === "PROVIDER_VERIFIED" ? "provider verified" : "publicly listed"}.`);
  } else if (es === "DOMAIN_CONFIGURED" || es === "SYNTAX_VALID") {
    evidence.points += 3;
    evidence.reasons.push("Email domain/syntax checks passed; mailbox not confirmed.");
  } else if (es === "UNDELIVERABLE") {
    flags.push("UNDELIVERABLE_EMAIL");
    evidence.reasons.push("Email marked undeliverable.");
  } else {
    evidence.points += 1;
    evidence.reasons.push(`Email status: ${es.replace(/_/g, " ").toLowerCase()}.`);
  }
  const fr = input.freshness ?? "UNKNOWN";
  const freshPts: Record<FreshnessCategory, number> = { FRESH: 5, RECENT: 4, AGING: 2, STALE: 0, UNKNOWN: 1 };
  evidence.points += freshPts[fr];
  evidence.reasons.push(`Evidence freshness: ${fr.toLowerCase()}.`);
  if (fr === "STALE") flags.push("STALE_EVIDENCE");

  const components = [role, decision, company, fit, evidence];
  for (const c of components) c.points = Math.max(0, Math.min(c.max, c.points));
  const total = components.reduce((s, c) => s + c.points, 0);
  return { total, components, flags };
}
