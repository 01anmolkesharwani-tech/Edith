/**
 * Template-based personalised email generation. Works without any AI service.
 *
 * Only verified inputs are used:
 *   - candidate facts: profile fields + highlights the candidate has CONFIRMED
 *   - company facts: research items the user has CONFIRMED (with their source)
 *   - recipient background: confirmed recipient research items only
 * When information is missing the draft stays neutral and the gaps are reported.
 */
import { createHash } from "node:crypto";
import { classifyRecipientType, classifySeniority, matchKeywords, type RecipientType } from "@/lib/domain/classify";
import { splitName } from "@/lib/normalize";
import { PHRASES } from "./builtin-templates";
import { joinList, render } from "./render";

export interface GenerationInput {
  candidate: {
    name: string | null;
    currentStatus: string | null;
    signature: string | null;
    skills: string[];
    targetFunctions: string[];
    targetRoles: string[];
  };
  highlights: {
    kind: string;
    title: string;
    organization: string | null;
    summary: string | null;
    capabilities: string[];
    tags: string[];
    confirmed: boolean;
  }[];
  recipient: { id: string; fullName: string | null; title: string | null; department: string | null };
  company: { name: string } | null;
  companyResearch: { kind: string; statement: string; sourceUrl: string | null; confirmed: boolean; publishedAt?: Date | null }[];
  recipientResearch: { statement: string; sourceUrl: string | null; confirmed: boolean }[];
  opportunity: { title: string; url: string | null } | null;
  template: { id?: string | null; recipientType: string; subjects: string[]; body: string };
  variant?: number; // bump to regenerate alternative phrasing
  followUp?: { previousSubject: string; previousDate: Date | null; attachResume: boolean } | null;
}

export interface PersonalizationReport {
  used: { label: string; value: string; sourceUrl?: string | null }[];
  gaps: string[];
  neutral: boolean;
  blocking: string[];
}

export interface GeneratedDraft {
  subject: string;
  subjectAlternatives: string[];
  body: string;
  recipientType: string;
  personalization: PersonalizationReport;
}

function seeded(seed: string, n: number): number {
  const h = createHash("sha256").update(seed).digest();
  return h.readUInt32BE(0) % n;
}

function pick<T>(list: T[], seed: string): T {
  return list[seeded(seed, list.length)];
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "and");
}

/** Determine the function to talk about: overlap of recipient's title with the candidate's targets. */
export function resolveFunction(
  candidate: GenerationInput["candidate"],
  recipient: GenerationInput["recipient"],
  opportunity: GenerationInput["opportunity"],
): string {
  const hay = [recipient.title, recipient.department, opportunity?.title].filter(Boolean).join(" ");
  const hit = matchKeywords(hay, candidate.targetFunctions)[0] ?? matchKeywords(hay, candidate.targetRoles)[0];
  return (hit ?? candidate.targetFunctions[0] ?? candidate.targetRoles[0] ?? "relevant").toLowerCase();
}

export function recipientTypeFor(title: string | null, hasOpportunity: boolean): RecipientType | "OPEN_ROLE" {
  const type = classifyRecipientType(title);
  if (hasOpportunity && type === "RECRUITER") return "OPEN_ROLE";
  return type;
}

function greeting(recipient: GenerationInput["recipient"]): string {
  if (!recipient.fullName) return "Dear Hiring Team,";
  const { firstName } = splitName(recipient.fullName);
  const seniority = classifySeniority(recipient.title);
  // Formal full-name greeting for senior leaders; first name otherwise. No gendered honorifics are guessed.
  if (seniority === "EXECUTIVE" || seniority === "LEADER") return `Dear ${recipient.fullName},`;
  return `Dear ${firstName || recipient.fullName},`;
}

const INITIATIVE_KINDS = ["GROWTH_INITIATIVE", "STRATEGIC_PRIORITY", "PRODUCT_OR_SERVICE", "BUSINESS_UNIT", "NEWS", "BUSINESS_MODEL", "DESCRIPTION"];

export function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

function stripEndPunct(s: string): string {
  return s.trim().replace(/[.!;:]+$/, "");
}

export function generateDraft(input: GenerationInput): GeneratedDraft {
  const seed = `${input.recipient.id}:${input.variant ?? 0}`;
  const used: PersonalizationReport["used"] = [];
  const gaps: string[] = [];
  const blocking: string[] = [];

  if (!input.candidate.name) blocking.push("Candidate name is missing – add it from the résumé in Settings → Profile.");

  const fn = resolveFunction(input.candidate, input.recipient, input.opportunity);

  // Candidate experience: best confirmed highlight for this function.
  const confirmed = input.highlights.filter((h) => h.confirmed && h.kind !== "EDUCATION" && h.kind !== "SKILL");
  const scored = confirmed
    .map((h) => ({
      h,
      score:
        matchKeywords([h.title, h.summary, ...h.tags, ...h.capabilities].join(" "), [fn, ...input.candidate.targetFunctions]).length +
        (h.kind === "EXPERIENCE" ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.h ?? null;
  let primary: string | null = null;
  if (best) {
    const kindWord = best.kind === "PROJECT" ? "my project" : best.kind === "CERTIFICATION" ? "my certification" : "my work";
    primary = best.organization ? `${kindWord} as ${best.title} at ${best.organization}` : `${kindWord} on ${best.title}`;
    used.push({ label: "Experience (confirmed)", value: primary });
  } else {
    gaps.push("No confirmed experience highlights – the draft uses a neutral introduction. Confirm highlights in Résumés.");
  }
  const capabilities = best?.capabilities.length ? joinList(best.capabilities.slice(0, 3)) : null;
  const outcome = best?.summary ? stripEndPunct(best.summary) + "." : null;

  // Company research: confirmed items only, most specific kind first.
  const companyItems = input.companyResearch
    .filter((r) => r.confirmed)
    .sort((a, b) => INITIATIVE_KINDS.indexOf(a.kind) - INITIATIVE_KINDS.indexOf(b.kind));
  const initiative = companyItems[0] ?? null;
  if (initiative) used.push({ label: "Company research (confirmed)", value: initiative.statement, sourceUrl: initiative.sourceUrl });
  else gaps.push("No confirmed company research – the draft does not reference a specific company initiative.");

  const background = input.recipientResearch.find((r) => r.confirmed) ?? null;
  if (background) used.push({ label: "Recipient background (confirmed)", value: background.statement, sourceUrl: background.sourceUrl });
  else gaps.push("No confirmed information about the recipient's work – no personal reference is made.");

  if (!input.recipient.fullName) gaps.push("Recipient name unknown – using a generic greeting.");
  if (!input.company) gaps.push("No company linked to this contact.");

  const contributionByType: Record<string, string> = {
    FUNCTIONAL_LEADER: `apply these skills to your team's ${fn} priorities`,
    BUSINESS_HEAD: `support the ${fn} team`,
    SENIOR: `learn from and contribute to the ${fn} team`,
  };

  const ctx = {
    greeting: greeting(input.recipient),
    candidate: {
      name: input.candidate.name,
      status: input.candidate.currentStatus ? lowerFirst(stripEndPunct(input.candidate.currentStatus)) : null,
      signature: input.candidate.signature,
      skills: input.candidate.skills.length ? joinList(input.candidate.skills.slice(0, 4)) : null,
    },
    recipient: {
      name: input.recipient.fullName,
      firstName: input.recipient.fullName ? splitName(input.recipient.fullName).firstName : null,
      title: input.recipient.title,
      background: background ? lowerFirst(stripEndPunct(background.statement)) : null,
    },
    company: {
      name: input.company?.name ?? "your organisation",
      possessive: input.company ? possessive(input.company.name) : "your organisation's",
      initiative: initiative ? lowerFirst(stripEndPunct(initiative.statement)) : null,
      initiativeSource: null,
    },
    function: { label: fn, title: titleCase(fn) },
    experience: { primary, capabilities, outcome },
    opportunity: input.opportunity ? { title: input.opportunity.title, url: input.opportunity.url } : {},
    contribution: contributionByType[input.template.recipientType] ?? `contribute to the ${fn} team`,
    previous: input.followUp
      ? {
          subject: input.followUp.previousSubject.replace(/^(re:\s*)+/i, ""),
          date: input.followUp.previousDate ? input.followUp.previousDate.toISOString().slice(0, 10) : null,
        }
      : {},
    attachResume: input.followUp?.attachResume ?? true,
    phrases: {
      reachingOut: pick(PHRASES.reachingOut, `${seed}:r`),
      interest: pick(PHRASES.interest, `${seed}:i`),
      ctaRecruiter: pick(PHRASES.ctaRecruiter, `${seed}:cr`),
      ctaLeader: pick(PHRASES.ctaLeader, `${seed}:cl`),
      ctaAdvice: pick(PHRASES.ctaAdvice, `${seed}:ca`),
      signoff: pick(PHRASES.signoff, `${seed}:s`),
    },
  };

  const body = render(input.template.body, ctx);
  const subjects = input.template.subjects
    .map((s) => render(s, ctx))
    .filter((r) => r.missing.length === 0 && r.text.length > 0)
    .map((r) => r.text);
  if (!subjects.length) subjects.push(`Introduction – ${input.candidate.name ?? "candidate"}`);
  // Rotate the preferred subject by variant so regenerations differ.
  const offset = seeded(seed, subjects.length);
  const ordered = [...subjects.slice(offset), ...subjects.slice(0, offset)];

  for (const m of body.missing) {
    if (m === "candidate.name") continue; // already blocking
    gaps.push(`Template variable "${m}" had no verified value and was left out.`);
  }

  return {
    subject: ordered[0],
    subjectAlternatives: ordered,
    body: body.text,
    recipientType: input.template.recipientType,
    personalization: { used, gaps, neutral: !initiative && !background, blocking },
  };
}

export function contentHash(parts: { subject: string; body: string; recipientEmail: string | null; resumeId: string | null }): string {
  return createHash("sha256")
    .update(JSON.stringify([parts.subject, parts.body, parts.recipientEmail ?? "", parts.resumeId ?? ""]))
    .digest("hex");
}
