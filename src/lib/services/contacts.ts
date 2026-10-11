import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { classifySeniority } from "@/lib/domain/classify";
import { detectConflicts } from "@/lib/domain/conflicts";
import { findDuplicates, type DuplicateMatch } from "@/lib/domain/dedupe";
import { categorize, contactFreshness, type FreshnessCategory } from "@/lib/domain/freshness";
import { scoreContact } from "@/lib/domain/scoring";
import { db } from "@/lib/db";
import { checkSyntax, deriveEmailStatus } from "@/lib/email/validation";
import { parseList } from "@/lib/json";
import { normalizeEmail, normalizePersonName, normalizeUrl } from "@/lib/normalize";
import { logActivity } from "./activity";
import { NotFoundError, UserError } from "./errors";
import { profileLists } from "./profiles";

export const STAGES = [
  "NEW",
  "RESEARCH_NEEDED",
  "READY_TO_CONTACT",
  "DRAFT_PREPARED",
  "SENT",
  "FOLLOW_UP_DUE",
  "REPLIED",
  "MEETING_SCHEDULED",
  "OPPORTUNITY_IDENTIFIED",
  "REFERRED",
  "APPLIED",
  "REJECTED",
  "NOT_RELEVANT",
  "DO_NOT_CONTACT",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: "New",
  RESEARCH_NEEDED: "Research needed",
  READY_TO_CONTACT: "Ready to contact",
  DRAFT_PREPARED: "Draft prepared",
  SENT: "Sent",
  FOLLOW_UP_DUE: "Follow-up due",
  REPLIED: "Replied",
  MEETING_SCHEDULED: "Meeting scheduled",
  OPPORTUNITY_IDENTIFIED: "Opportunity identified",
  REFERRED: "Referred",
  APPLIED: "Applied",
  REJECTED: "Rejected",
  NOT_RELEVANT: "Not relevant",
  DO_NOT_CONTACT: "Do not contact",
};

/** Stages after which automated stage changes must not move a contact backwards. */
const PROGRESS_ORDER: Stage[] = ["NEW", "RESEARCH_NEEDED", "READY_TO_CONTACT", "DRAFT_PREPARED", "SENT", "FOLLOW_UP_DUE"];
const TERMINAL: Stage[] = [
  "REPLIED",
  "MEETING_SCHEDULED",
  "OPPORTUNITY_IDENTIFIED",
  "REFERRED",
  "APPLIED",
  "REJECTED",
  "NOT_RELEVANT",
  "DO_NOT_CONTACT",
];

export function canAutoAdvance(from: Stage, to: Stage): boolean {
  if (TERMINAL.includes(from)) return false;
  if (TERMINAL.includes(to)) return true;
  return PROGRESS_ORDER.indexOf(to) > PROGRESS_ORDER.indexOf(from) || (from === "FOLLOW_UP_DUE" && to === "SENT");
}

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length ? v : null))
    .nullable()
    .optional();

export const SOURCE_TYPES = [
  "OFFICIAL_TEAM_PAGE",
  "OFFICIAL_BIO",
  "OFFICIAL_ANNOUNCEMENT",
  "CAREERS_PAGE",
  "JOB_POSTING",
  "PUBLIC_DIRECTORY",
  "PROFESSIONAL_PROFILE",
  "NEWS_ARTICLE",
  "SEARCH_API_RESULT",
  "USER_PROVIDED",
  "CSV_IMPORT",
  "OTHER",
] as const;

export const PHONE_TYPES = [
  "DIRECT_BUSINESS_LINE",
  "OFFICE_LINE",
  "COMPANY_SWITCHBOARD",
  "PUBLIC_PROFESSIONAL_MOBILE",
  "UNKNOWN",
] as const;

export const contactInputSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required").max(120),
  title: opt(200),
  companyId: opt(40),
  department: opt(120),
  location: opt(200),
  profileUrl: opt(500),
  bioUrl: opt(500),
  email: opt(254),
  emailOrigin: z.enum(["PUBLIC_SOURCE", "USER_PROVIDED", "IMPORTED", "PATTERN_GUESS"]).optional().nullable(),
  phone: opt(40),
  phoneType: z.enum(PHONE_TYPES).optional().nullable(),
  notes: opt(5000),
  // Evidence for the values entered
  sourceUrl: opt(1000),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  publishedAt: opt(30),
  evidenceNotes: opt(1000),
});
export type ContactInput = z.input<typeof contactInputSchema>;

export class DuplicateContactError extends UserError {
  constructor(public readonly matches: DuplicateMatch[]) {
    super("A matching contact already exists in this profile.");
    this.name = "DuplicateContactError";
  }
}

function cleanUrl(v: string | null | undefined, field: string): string | null {
  if (!v) return null;
  const u = normalizeUrl(v);
  if (!u) throw new UserError(`${field} must be a valid http(s) URL.`);
  return u;
}

type EvidenceSeed = Omit<Prisma.ContactFieldEvidenceCreateManyInput, "contactId">;

export async function findContactDuplicates(
  profileId: string,
  probe: { id?: string; fullName: string; companyId: string | null; email?: string | null; profileUrl?: string | null },
) {
  const pool = await db.contact.findMany({
    where: { profileId, mergedIntoId: null },
    select: { id: true, fullName: true, companyId: true, email: true, profileUrl: true },
  });
  return findDuplicates(probe, pool);
}

/**
 * Create a contact with field-level evidence. Manual entries are labelled MANUAL;
 * automated discoveries pass origin AUTOMATED and their own evidence records.
 */
export async function createContact(
  profileId: string,
  input: ContactInput,
  opts: {
    origin?: "MANUAL" | "AUTOMATED" | "IMPORTED";
    evidence?: EvidenceSeed[];
    allowDuplicate?: boolean;
    stage?: Stage;
  } = {},
) {
  const d = contactInputSchema.parse(input);
  const origin = opts.origin ?? "MANUAL";
  if (d.companyId) {
    const c = await db.company.findUnique({ where: { id: d.companyId } });
    if (!c) throw new UserError("Selected company does not exist.");
  }
  if (d.email && !checkSyntax(d.email).ok) throw new UserError(`Email is not valid: ${checkSyntax(d.email).reason}`);
  const profileUrl = cleanUrl(d.profileUrl, "Profile URL");
  const bioUrl = cleanUrl(d.bioUrl, "Biography URL");
  const sourceUrl = cleanUrl(d.sourceUrl, "Source URL");

  if (!opts.allowDuplicate) {
    const dups = await findContactDuplicates(profileId, {
      fullName: d.fullName,
      companyId: d.companyId ?? null,
      email: d.email,
      profileUrl,
    });
    const strong = dups.filter((m) => m.strength === "STRONG");
    if (strong.length) throw new DuplicateContactError(strong);
  }

  const now = new Date();
  const emailOrigin = d.email
    ? (d.emailOrigin ?? (origin === "IMPORTED" ? "IMPORTED" : origin === "AUTOMATED" ? "PUBLIC_SOURCE" : "USER_PROVIDED"))
    : null;

  const contact = await db.contact.create({
    data: {
      profileId,
      companyId: d.companyId ?? null,
      fullName: d.fullName,
      normalizedName: normalizePersonName(d.fullName),
      title: d.title ?? null,
      department: d.department ?? null,
      seniority: classifySeniority(d.title),
      location: d.location ?? null,
      profileUrl,
      bioUrl,
      email: d.email ? d.email.trim() : null,
      emailNormalized: normalizeEmail(d.email),
      emailOrigin,
      phone: d.phone ?? null,
      phoneType: d.phone ? (d.phoneType ?? "UNKNOWN") : null,
      origin,
      reviewState: origin === "MANUAL" ? "CONFIRMED" : "UNREVIEWED",
      stage: opts.stage ?? "NEW",
      notes: d.notes ?? null,
      lastObservedAt: now,
    },
  });

  let evidence = opts.evidence;
  if (!evidence) {
    // Manual / imported: record what the user supplied, with the source they gave (if any).
    const sourceType = d.sourceType ?? (origin === "IMPORTED" ? "CSV_IMPORT" : "USER_PROVIDED");
    const method = origin === "IMPORTED" ? "IMPORT" : "MANUAL_ENTRY";
    const publishedAt = d.publishedAt ? new Date(d.publishedAt) : null;
    const base = {
      sourceUrl,
      sourceType,
      verificationMethod: method,
      confidence: sourceUrl ? "MEDIUM" : "LOW",
      origin: origin === "IMPORTED" ? "IMPORTED" : "MANUAL",
      observedAt: now,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      notes: d.evidenceNotes ?? null,
    } as const;
    evidence = [{ ...base, field: "NAME", value: d.fullName }];
    if (d.title) evidence.push({ ...base, field: "TITLE", value: d.title });
    if (d.companyId) {
      const c = await db.company.findUnique({ where: { id: d.companyId } });
      if (c) evidence.push({ ...base, field: "COMPANY", value: c.name });
    }
    if (d.email) evidence.push({ ...base, field: "EMAIL", value: d.email.trim().toLowerCase() });
    if (d.phone) evidence.push({ ...base, field: "PHONE", value: d.phone });
    if (d.location) evidence.push({ ...base, field: "LOCATION", value: d.location });
  }
  if (evidence.length) {
    await db.contactFieldEvidence.createMany({ data: evidence.map((e) => ({ ...e, contactId: contact.id })) });
  }
  await logActivity(db, {
    profileId,
    contactId: contact.id,
    type: origin === "AUTOMATED" ? "DISCOVERED" : origin === "IMPORTED" ? "IMPORT" : "CREATED",
    summary:
      origin === "AUTOMATED"
        ? "Discovered automatically (needs review)"
        : origin === "IMPORTED"
          ? "Imported from CSV"
          : "Added manually",
    toStage: contact.stage,
  });
  await recomputeContact(contact.id);
  return db.contact.findUniqueOrThrow({ where: { id: contact.id } });
}

export async function updateContact(profileId: string, contactId: string, input: ContactInput) {
  const d = contactInputSchema.parse(input);
  const existing = await db.contact.findFirst({ where: { id: contactId, profileId } });
  if (!existing) throw new NotFoundError("Contact");
  if (d.email && !checkSyntax(d.email).ok) throw new UserError(`Email is not valid: ${checkSyntax(d.email).reason}`);
  const sourceUrl = cleanUrl(d.sourceUrl, "Source URL");
  const now = new Date();
  const ev: EvidenceSeed[] = [];
  const base = {
    sourceUrl,
    sourceType: d.sourceType ?? "USER_PROVIDED",
    verificationMethod: "MANUAL_ENTRY",
    confidence: sourceUrl ? "MEDIUM" : "LOW",
    origin: "MANUAL",
    observedAt: now,
    notes: d.evidenceNotes ?? "Edited manually",
  } as const;
  const changed = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") !== (b ?? "");
  if (changed(existing.title, d.title) && d.title) ev.push({ ...base, field: "TITLE", value: d.title });
  if (changed(existing.email?.toLowerCase(), d.email?.toLowerCase()) && d.email)
    ev.push({ ...base, field: "EMAIL", value: d.email.toLowerCase() });
  if (changed(existing.phone, d.phone) && d.phone) ev.push({ ...base, field: "PHONE", value: d.phone });
  if (changed(existing.location, d.location) && d.location) ev.push({ ...base, field: "LOCATION", value: d.location });
  if (changed(existing.companyId, d.companyId) && d.companyId) {
    const c = await db.company.findUnique({ where: { id: d.companyId } });
    if (c) ev.push({ ...base, field: "COMPANY", value: c.name });
  }

  const emailChanged = changed(existing.emailNormalized, normalizeEmail(d.email));
  await db.contact.update({
    where: { id: contactId },
    data: {
      fullName: d.fullName,
      normalizedName: normalizePersonName(d.fullName),
      title: d.title ?? null,
      seniority: classifySeniority(d.title),
      companyId: d.companyId ?? null,
      department: d.department ?? null,
      location: d.location ?? null,
      profileUrl: cleanUrl(d.profileUrl, "Profile URL"),
      bioUrl: cleanUrl(d.bioUrl, "Biography URL"),
      email: d.email ? d.email.trim() : null,
      emailNormalized: normalizeEmail(d.email),
      emailOrigin: d.email ? (emailChanged ? (d.emailOrigin ?? "USER_PROVIDED") : (d.emailOrigin ?? existing.emailOrigin)) : null,
      phone: d.phone ?? null,
      phoneType: d.phone ? (d.phoneType ?? existing.phoneType ?? "UNKNOWN") : null,
      notes: d.notes ?? null,
    },
  });
  if (ev.length) await db.contactFieldEvidence.createMany({ data: ev.map((e) => ({ ...e, contactId })) });
  await recomputeContact(contactId);
}

export async function addEvidence(
  profileId: string,
  contactId: string,
  input: {
    field: string;
    value: string;
    sourceUrl?: string | null;
    sourceType: string;
    publishedAt?: string | null;
    notes?: string | null;
    snippet?: string | null;
  },
) {
  const contact = await db.contact.findFirst({ where: { id: contactId, profileId } });
  if (!contact) throw new NotFoundError("Contact");
  const schema = z.object({
    field: z.enum(["NAME", "TITLE", "COMPANY", "DEPARTMENT", "LOCATION", "EMAIL", "PHONE", "PROFILE_URL", "BIO_URL"]),
    value: z.string().trim().min(1).max(500),
    sourceType: z.enum(SOURCE_TYPES),
  });
  const d = schema.parse(input);
  const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
  await db.contactFieldEvidence.create({
    data: {
      contactId,
      field: d.field,
      value: d.field === "EMAIL" ? d.value.toLowerCase() : d.value,
      sourceUrl: cleanUrl(input.sourceUrl, "Source URL"),
      sourceType: d.sourceType,
      verificationMethod: "MANUAL_ENTRY",
      confidence: input.sourceUrl ? "MEDIUM" : "LOW",
      origin: "MANUAL",
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      notes: input.notes?.slice(0, 1000) ?? null,
      snippet: input.snippet?.slice(0, 1000) ?? null,
    },
  });
  await recomputeContact(contactId);
}

export async function deleteEvidence(profileId: string, evidenceId: string) {
  const ev = await db.contactFieldEvidence.findFirst({ where: { id: evidenceId, contact: { profileId } } });
  if (!ev) throw new NotFoundError("Evidence");
  await db.contactFieldEvidence.delete({ where: { id: evidenceId } });
  await recomputeContact(ev.contactId);
}

/** The user states they have checked the role is current (e.g. on the official site today). */
export async function confirmCurrentRole(profileId: string, contactId: string, note?: string | null) {
  const c = await db.contact.findFirst({ where: { id: contactId, profileId }, include: { company: true } });
  if (!c) throw new NotFoundError("Contact");
  if (!c.title) throw new UserError("Add a title before confirming the role.");
  await db.contactFieldEvidence.create({
    data: {
      contactId,
      field: "TITLE",
      value: c.title,
      sourceType: "USER_PROVIDED",
      verificationMethod: "USER_CONFIRMED",
      confidence: "MEDIUM",
      origin: "MANUAL",
      notes: note?.slice(0, 500) || "Role confirmed as current by the user",
    },
  });
  await db.contact.update({ where: { id: contactId }, data: { reviewState: "CONFIRMED" } });
  await recomputeContact(contactId);
}

export async function setReviewState(profileId: string, contactId: string, state: "CONFIRMED" | "NEEDS_REVIEW" | "UNREVIEWED") {
  const r = await db.contact.updateMany({ where: { id: contactId, profileId }, data: { reviewState: state } });
  if (!r.count) throw new NotFoundError("Contact");
}

/**
 * Recalculate derived fields: email status, freshness dates, conflicts and the
 * explainable relevance score. Called after any change to a contact or its evidence.
 */
export async function recomputeContact(contactId: string) {
  const c = await db.contact.findUnique({
    where: { id: contactId },
    include: {
      evidence: true,
      verifications: true,
      profile: true,
      company: { include: { jobs: { where: { status: "OPEN" }, select: { title: true } } } },
    },
  });
  if (!c) return;
  const link = c.companyId
    ? await db.profileCompany.findUnique({ where: { profileId_companyId: { profileId: c.profileId, companyId: c.companyId } } })
    : null;

  const emailNorm = c.emailNormalized;
  const emailEvidence = c.evidence.filter((e) => e.field === "EMAIL" && e.value.toLowerCase() === emailNorm);
  const derived = deriveEmailStatus({
    email: c.email,
    emailOrigin: c.emailOrigin,
    verifications: c.verifications.filter((v) => v.email.toLowerCase() === emailNorm),
    evidence: emailEvidence,
  });

  const fresh = contactFreshness(
    c.evidence.map((e) => ({ field: e.field, sourceType: e.sourceType, observedAt: e.observedAt, publishedAt: e.publishedAt })),
    c.verifications.filter((v) => v.email.toLowerCase() === emailNorm).sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0]
      ?.checkedAt ?? null,
  );

  const conflicts = detectConflicts(
    c.evidence.map((e) => ({ field: e.field, value: e.value, sourceUrl: e.sourceUrl, sourceType: e.sourceType, observedAt: e.observedAt })),
    { title: c.title, company: c.company?.name ?? null, email: c.email, phone: c.phone },
  );

  const titleEvidence =
    c.evidence
      .filter((e) => e.field === "TITLE")
      .sort((a, b) => {
        const rank = (x: typeof a) =>
          x.verificationMethod === "USER_CONFIRMED" ? 3 : x.sourceType.startsWith("OFFICIAL") ? 2 : x.sourceUrl ? 1 : 0;
        return rank(b) - rank(a);
      })[0] ?? null;

  const lists = profileLists(c.profile);
  const score = scoreContact(lists, {
    contact: { title: c.title, department: c.department, location: c.location },
    company: c.company,
    targetStatus: link?.status ?? null,
    openingTitles: c.company?.jobs.map((j) => j.title) ?? [],
    titleEvidence: titleEvidence ? { sourceType: titleEvidence.sourceType, verificationMethod: titleEvidence.verificationMethod } : null,
    emailStatus: derived.status,
    hasEmail: !!c.email,
    freshness: fresh.role,
  });

  const reasons = [...conflicts];
  if (c.origin === "AUTOMATED" && c.reviewState === "UNREVIEWED") reasons.push("Automatically extracted – review before outreach.");
  if (derived.isGuess) reasons.push("Email is a pattern guess and has not been observed publicly.");
  if (fresh.role === "STALE") reasons.push("Role evidence is older than 180 days.");
  reasons.push(...fresh.notes);

  await db.contact.update({
    where: { id: contactId },
    data: {
      emailStatus: derived.status,
      emailCheckedAt: fresh.dates.emailValidatedAt,
      roleConfirmedAt: fresh.dates.roleConfirmedAt,
      emailLastObservedAt: fresh.dates.emailLastObservedAt,
      phoneLastObservedAt: fresh.dates.phoneLastObservedAt,
      lastObservedAt: fresh.dates.lastRetrievedAt ?? c.lastObservedAt,
      relevanceScore: score.total,
      relevanceBreakdown: JSON.stringify({ ...score, emailReasons: derived.reasons, freshness: fresh }),
      reviewReasons: JSON.stringify(reasons),
      reviewState: conflicts.length && c.reviewState === "CONFIRMED" ? "NEEDS_REVIEW" : c.reviewState,
    },
  });
}

export async function recomputeAllForProfile(profileId: string) {
  const ids = await db.contact.findMany({ where: { profileId, mergedIntoId: null }, select: { id: true } });
  for (const { id } of ids) await recomputeContact(id);
  return ids.length;
}

export interface ContactFilters {
  q?: string;
  companyId?: string;
  industry?: string;
  seniority?: string;
  location?: string;
  minScore?: number;
  emailStatus?: string;
  freshness?: FreshnessCategory | "";
  stage?: string;
  discoveredFrom?: string;
  discoveredTo?: string;
  review?: string;
  sort?: "score" | "recent" | "name";
}

export async function listContacts(profileId: string, f: ContactFilters = {}) {
  const where: Prisma.ContactWhereInput = { profileId, mergedIntoId: null };
  if (f.q) where.OR = [{ fullName: { contains: f.q } }, { title: { contains: f.q } }, { email: { contains: f.q.toLowerCase() } }];
  if (f.companyId) where.companyId = f.companyId;
  if (f.industry) where.company = { industry: { contains: f.industry } };
  if (f.seniority) where.seniority = f.seniority;
  if (f.location) where.location = { contains: f.location };
  if (f.minScore) where.relevanceScore = { gte: f.minScore };
  if (f.emailStatus) where.emailStatus = f.emailStatus as Prisma.ContactWhereInput["emailStatus"];
  if (f.stage) where.stage = f.stage as Stage;
  if (f.review) where.reviewState = f.review as "UNREVIEWED" | "CONFIRMED" | "NEEDS_REVIEW";
  if (f.discoveredFrom || f.discoveredTo) {
    where.discoveredAt = {
      ...(f.discoveredFrom ? { gte: new Date(f.discoveredFrom) } : {}),
      ...(f.discoveredTo ? { lte: new Date(`${f.discoveredTo}T23:59:59`) } : {}),
    };
  }
  const orderBy: Prisma.ContactOrderByWithRelationInput[] =
    f.sort === "name" ? [{ fullName: "asc" }] : f.sort === "recent" ? [{ discoveredAt: "desc" }] : [{ relevanceScore: "desc" }, { fullName: "asc" }];
  const rows = await db.contact.findMany({ where, include: { company: true }, orderBy, take: 1000 });
  const now = new Date();
  return rows
    .map((r) => ({ ...r, freshness: categorize(r.roleConfirmedAt, now) }))
    .filter((r) => !f.freshness || r.freshness === f.freshness);
}

export async function getContactDetail(profileId: string, contactId: string) {
  const c = await db.contact.findFirst({
    where: { id: contactId, profileId },
    include: {
      company: { include: { jobs: { where: { status: "OPEN" } } } },
      evidence: { orderBy: [{ field: "asc" }, { observedAt: "desc" }], include: { sourceDocument: { select: { id: true, title: true } } } },
      verifications: { orderBy: { checkedAt: "desc" } },
      activities: { orderBy: { occurredAt: "desc" }, take: 100 },
      drafts: { orderBy: { updatedAt: "desc" } },
      sendLogs: { orderBy: { attemptedAt: "desc" } },
      followUps: { orderBy: { dueDate: "asc" } },
      researchItems: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!c) throw new NotFoundError("Contact");
  return c;
}

export async function changeStage(
  profileId: string,
  contactId: string,
  stage: Stage,
  opts: { note?: string | null; source?: "MANUAL" | "SYSTEM" } = {},
) {
  const c = await db.contact.findFirst({ where: { id: contactId, profileId } });
  if (!c) throw new NotFoundError("Contact");
  if (!STAGES.includes(stage)) throw new UserError("Unknown stage");
  if (c.stage === stage && !opts.note) return;
  await db.$transaction(async (tx) => {
    await tx.contact.update({ where: { id: contactId }, data: { stage } });
    await logActivity(tx, {
      profileId,
      contactId,
      type: "STAGE_CHANGE",
      source: opts.source ?? "MANUAL",
      summary: `${STAGE_LABELS[c.stage as Stage]} → ${STAGE_LABELS[stage]}${opts.note ? `: ${opts.note}` : ""}`,
      fromStage: c.stage,
      toStage: stage,
    });
    if (stage === "DO_NOT_CONTACT" && c.emailNormalized) {
      const exists = await tx.suppressionRecord.findFirst({ where: { profileId, email: c.emailNormalized } });
      if (!exists) {
        await tx.suppressionRecord.create({
          data: { profileId, email: c.emailNormalized, contactId, reason: opts.note || "Marked Do Not Contact" },
        });
      }
    }
    if (["REPLIED", "REJECTED", "NOT_RELEVANT", "DO_NOT_CONTACT", "MEETING_SCHEDULED", "APPLIED", "REFERRED", "OPPORTUNITY_IDENTIFIED"].includes(stage)) {
      await tx.followUp.updateMany({
        where: { contactId, status: "SCHEDULED" },
        data: { status: "SUPPRESSED", suppressedReason: `Contact moved to ${STAGE_LABELS[stage]}` },
      });
    }
  });
}

/** Move a contact forward automatically (never backwards, never out of a terminal stage). */
export async function autoAdvance(
  tx: Prisma.TransactionClient,
  profileId: string,
  contactId: string,
  to: Stage,
  summary: string,
  source: "PROVIDER" | "INBOX" | "MANUAL" | "SYSTEM" = "SYSTEM",
) {
  const c = await tx.contact.findUnique({ where: { id: contactId } });
  if (!c || !canAutoAdvance(c.stage as Stage, to)) return;
  await tx.contact.update({ where: { id: contactId }, data: { stage: to } });
  await logActivity(tx, { profileId, contactId, type: "STAGE_CHANGE", source, summary, fromStage: c.stage, toStage: to });
}

/** Merge `secondaryId` into `primaryId`, preserving all evidence and outreach history. */
export async function mergeContacts(profileId: string, primaryId: string, secondaryId: string) {
  if (primaryId === secondaryId) throw new UserError("Choose two different contacts.");
  const [a, b] = await Promise.all([
    db.contact.findFirst({ where: { id: primaryId, profileId, mergedIntoId: null } }),
    db.contact.findFirst({ where: { id: secondaryId, profileId, mergedIntoId: null } }),
  ]);
  if (!a || !b) throw new NotFoundError("Contact");
  await db.$transaction(async (tx) => {
    const move = { where: { contactId: secondaryId }, data: { contactId: primaryId } };
    await tx.contactFieldEvidence.updateMany(move);
    await tx.emailVerification.updateMany(move);
    await tx.emailDraft.updateMany(move);
    await tx.outreachActivity.updateMany(move);
    await tx.emailSendLog.updateMany(move);
    await tx.followUp.updateMany(move);
    await tx.researchItem.updateMany(move);
    const fill: Prisma.ContactUpdateInput = {};
    for (const k of ["title", "department", "location", "profileUrl", "bioUrl", "email", "emailNormalized", "emailOrigin", "phone", "phoneType", "notes"] as const) {
      if (a[k] == null && b[k] != null) (fill as Record<string, unknown>)[k] = b[k];
    }
    if (!a.companyId && b.companyId) fill.company = { connect: { id: b.companyId } };
    await tx.contact.update({ where: { id: primaryId }, data: fill });
    await tx.contact.update({ where: { id: secondaryId }, data: { mergedIntoId: primaryId } });
    await logActivity(tx, {
      profileId,
      contactId: primaryId,
      type: "MERGE",
      summary: `Merged duplicate record "${b.fullName}" (${b.email ?? "no email"}) into this contact`,
      details: { mergedContactId: secondaryId },
    });
  });
  await recomputeContact(primaryId);
}

export async function deleteContact(profileId: string, contactId: string) {
  const r = await db.contact.deleteMany({ where: { id: contactId, profileId } });
  if (!r.count) throw new NotFoundError("Contact");
}

export function reviewReasons(c: { reviewReasons: string }): string[] {
  return parseList(c.reviewReasons);
}
