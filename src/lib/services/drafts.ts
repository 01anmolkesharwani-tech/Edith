import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { contentHash, generateDraft, recipientTypeFor } from "@/lib/drafting/generate";
import { checkSyntax } from "@/lib/email/validation";
import { parseList, parseObject } from "@/lib/json";
import { logActivity } from "./activity";
import { autoAdvance } from "./contacts";
import { NotFoundError, UserError } from "./errors";
import { profileLists } from "./profiles";
import { defaultResume } from "./resumes";
import { templateForType, templateSubjects } from "./templates";

async function buildGeneration(
  profileId: string,
  contactId: string,
  opts: { opportunityId?: string | null; templateId?: string | null; variant?: number; followUpOf?: { subject: string; date: Date | null; messageId: string | null } | null },
) {
  const contact = await db.contact.findFirst({ where: { id: contactId, profileId, mergedIntoId: null }, include: { company: true } });
  if (!contact) throw new NotFoundError("Contact");
  const profile = await db.candidateProfile.findUniqueOrThrow({ where: { id: profileId } });
  const lists = profileLists(profile);
  const highlights = await db.profileHighlight.findMany({ where: { profileId } });
  const opportunity = opts.opportunityId
    ? await db.jobOpportunity.findFirst({ where: { id: opts.opportunityId, companyId: contact.companyId ?? "__none__" } })
    : null;
  const companyResearch = contact.companyId
    ? await db.researchItem.findMany({
        where: { companyId: contact.companyId, contactId: null, OR: [{ profileId }, { profileId: null }] },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const recipientResearch = await db.researchItem.findMany({ where: { contactId, profileId } });

  const type = opts.followUpOf ? "FOLLOW_UP" : recipientTypeFor(contact.title, !!opportunity);
  const template = opts.templateId
    ? await db.outreachTemplate.findFirst({ where: { id: opts.templateId, profileId } })
    : await templateForType(profileId, type);
  if (!template) throw new UserError("No template available.");

  const generated = generateDraft({
    candidate: {
      name: profile.candidateName,
      currentStatus: profile.currentStatus,
      signature: profile.signature,
      skills: lists.skills,
      targetFunctions: lists.targetFunctions,
      targetRoles: lists.targetRoles,
    },
    highlights: highlights.map((h) => ({ ...h, capabilities: parseList(h.capabilities), tags: parseList(h.tags) })),
    recipient: { id: contact.id, fullName: contact.fullName, title: contact.title, department: contact.department },
    company: contact.company ? { name: contact.company.name } : null,
    companyResearch,
    recipientResearch,
    opportunity: opportunity ? { title: opportunity.title, url: opportunity.url } : null,
    template: { id: template.id, recipientType: template.recipientType, subjects: templateSubjects(template), body: template.bodyTemplate },
    variant: opts.variant,
    followUp: opts.followUpOf ? { previousSubject: opts.followUpOf.subject, previousDate: opts.followUpOf.date, attachResume: true } : null,
  });
  return { contact, profile, template, opportunity, generated };
}

/** Create a draft for a contact. Nothing is sent: the user reviews and explicitly sends later. */
export async function createDraft(
  profileId: string,
  contactId: string,
  opts: { opportunityId?: string | null; templateId?: string | null; resumeId?: string | null } = {},
) {
  const { contact, template, opportunity, generated } = await buildGeneration(profileId, contactId, opts);
  const resume = opts.resumeId ? await db.resume.findFirst({ where: { id: opts.resumeId, profileId } }) : await defaultResume(profileId);
  const recipientEmail = contact.email;
  const draft = await db.$transaction(async (tx) => {
    const d = await tx.emailDraft.create({
      data: {
        profileId,
        contactId,
        companyId: contact.companyId,
        opportunityId: opportunity?.id ?? null,
        resumeId: resume?.id ?? null,
        templateId: template.id,
        kind: "INITIAL",
        recipientType: generated.recipientType,
        recipientEmail,
        recipientName: contact.fullName,
        subject: generated.subject,
        subjectAlternatives: JSON.stringify(generated.subjectAlternatives),
        body: generated.body,
        personalization: JSON.stringify(generated.personalization),
        contentHash: contentHash({ subject: generated.subject, body: generated.body, recipientEmail, resumeId: resume?.id ?? null }),
        idempotencyKey: randomUUID(),
      },
    });
    await logActivity(tx, { profileId, contactId, type: "DRAFT_CREATED", summary: `Draft prepared: "${generated.subject}"`, draftId: d.id });
    await autoAdvance(tx, profileId, contactId, "DRAFT_PREPARED", "Draft prepared");
    return d;
  });
  return draft;
}

export async function getDraft(profileId: string, draftId: string) {
  const d = await db.emailDraft.findFirst({
    where: { id: draftId, profileId },
    include: {
      contact: { include: { company: true, evidence: { orderBy: { observedAt: "desc" } } } },
      resume: true,
      opportunity: true,
      template: true,
      sendLogs: { orderBy: { attemptedAt: "desc" } },
    },
  });
  if (!d) throw new NotFoundError("Draft");
  return d;
}

export async function regenerateDraft(profileId: string, draftId: string, templateId?: string | null) {
  const d = await db.emailDraft.findFirst({ where: { id: draftId, profileId } });
  if (!d) throw new NotFoundError("Draft");
  if (d.sendState !== "DRAFT" && d.sendState !== "FAILED") throw new UserError("Only unsent drafts can be regenerated.");
  const prev = parseObject<{ variant?: number }>(d.personalization, {});
  const variant = (prev.variant ?? 0) + 1;
  const followUpOf =
    d.kind === "FOLLOW_UP"
      ? await (async () => {
          const last = await db.emailSendLog.findFirst({ where: { contactId: d.contactId, profileId, status: "ACCEPTED" }, orderBy: { attemptedAt: "desc" } });
          return last ? { subject: last.subject, date: last.attemptedAt, messageId: last.providerMessageId } : null;
        })()
      : null;
  const { generated, template } = await buildGeneration(profileId, d.contactId, {
    opportunityId: d.opportunityId,
    templateId: templateId ?? d.templateId,
    variant,
    followUpOf,
  });
  return db.emailDraft.update({
    where: { id: draftId },
    data: {
      templateId: template.id,
      recipientType: generated.recipientType,
      subject: generated.subject,
      subjectAlternatives: JSON.stringify(generated.subjectAlternatives),
      body: generated.body,
      personalization: JSON.stringify({ ...generated.personalization, variant }),
      contentHash: contentHash({ subject: generated.subject, body: generated.body, recipientEmail: d.recipientEmail, resumeId: d.resumeId }),
    },
  });
}

export const draftUpdateSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Message is required").max(20_000),
  recipientEmail: z.string().trim().max(254),
  resumeId: z.string().trim().max(40).optional().nullable(),
  opportunityId: z.string().trim().max(40).optional().nullable(),
});

export async function updateDraft(profileId: string, draftId: string, input: z.input<typeof draftUpdateSchema>) {
  const data = draftUpdateSchema.parse(input);
  const d = await db.emailDraft.findFirst({ where: { id: draftId, profileId } });
  if (!d) throw new NotFoundError("Draft");
  if (d.sendState !== "DRAFT" && d.sendState !== "FAILED") throw new UserError("This email has already been sent or is being sent.");
  if (data.recipientEmail && !checkSyntax(data.recipientEmail).ok) throw new UserError("Recipient email is not valid.");
  let resumeId: string | null = data.resumeId || null;
  if (resumeId) {
    // Only this profile's résumés can be attached.
    const r = await db.resume.findFirst({ where: { id: resumeId, profileId } });
    if (!r) throw new UserError("That résumé does not belong to this profile.");
  } else resumeId = null;
  const hash = contentHash({ subject: data.subject, body: data.body, recipientEmail: data.recipientEmail || null, resumeId });
  return db.emailDraft.update({
    where: { id: draftId },
    data: {
      subject: data.subject,
      body: data.body,
      recipientEmail: data.recipientEmail || null,
      resumeId,
      opportunityId: data.opportunityId || null,
      contentHash: hash,
    },
  });
}

/** Record that the user reviewed exactly this content (subject, body, recipient, attachment). */
export async function markReviewed(profileId: string, draftId: string, expectedHash: string) {
  const d = await db.emailDraft.findFirst({ where: { id: draftId, profileId } });
  if (!d) throw new NotFoundError("Draft");
  if (d.contentHash !== expectedHash) throw new UserError("The draft changed since you opened it. Review the latest version.");
  return db.emailDraft.update({ where: { id: draftId }, data: { reviewedHash: d.contentHash, reviewedAt: new Date() } });
}

export async function setAcknowledgements(profileId: string, draftId: string, ack: { guess?: boolean; duplicate?: boolean }) {
  const d = await db.emailDraft.findFirst({ where: { id: draftId, profileId } });
  if (!d) throw new NotFoundError("Draft");
  return db.emailDraft.update({
    where: { id: draftId },
    data: {
      ...(ack.guess !== undefined ? { guessAcknowledged: ack.guess } : {}),
      ...(ack.duplicate !== undefined ? { duplicateAcknowledged: ack.duplicate } : {}),
    },
  });
}

export async function cancelDraft(profileId: string, draftId: string) {
  const r = await db.emailDraft.updateMany({ where: { id: draftId, profileId, sendState: { in: ["DRAFT", "FAILED"] } }, data: { sendState: "CANCELLED" } });
  if (!r.count) throw new UserError("Only unsent drafts can be cancelled.");
}

export async function listDrafts(profileId: string, states: ("DRAFT" | "SENDING" | "SENT" | "FAILED" | "UNKNOWN" | "CANCELLED")[] = ["DRAFT", "FAILED", "UNKNOWN", "SENDING"]) {
  return db.emailDraft.findMany({
    where: { profileId, sendState: { in: states } },
    include: { contact: { include: { company: true } }, resume: true },
    orderBy: { updatedAt: "desc" },
  });
}
