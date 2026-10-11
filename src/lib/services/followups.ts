import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { contentHash } from "@/lib/drafting/generate";
import { logActivity } from "./activity";
import { NotFoundError, UserError } from "./errors";
import { regenerateDraft } from "./drafts";
import { suppressionFor } from "./suppression";

const STOP_STAGES = ["REPLIED", "MEETING_SCHEDULED", "OPPORTUNITY_IDENTIFIED", "REFERRED", "APPLIED", "REJECTED", "NOT_RELEVANT", "DO_NOT_CONTACT"];

/** Why a follow-up must not be sent, or null if it may be drafted. */
export async function followUpSuppressionReason(profileId: string, followUpId: string): Promise<string | null> {
  const f = await db.followUp.findFirst({ where: { id: followUpId, profileId }, include: { contact: true, previousSend: true } });
  if (!f) throw new NotFoundError("Follow-up");
  if (f.status === "SKIPPED" || f.status === "SUPPRESSED") return f.suppressedReason ?? "Suppressed by you.";
  if (STOP_STAGES.includes(f.contact.stage)) return `Contact is in stage ${f.contact.stage.replace(/_/g, " ").toLowerCase()}.`;
  const replied = await db.emailSendLog.findFirst({ where: { contactId: f.contactId, repliedAt: { not: null } } });
  if (replied) return "The recipient has replied.";
  const bounced = await db.emailSendLog.findFirst({ where: { contactId: f.contactId, bouncedAt: { not: null } } });
  if (bounced) return "A previous email bounced.";
  if (await suppressionFor(profileId, f.contact.email, f.contactId)) return "Recipient is on the Do Not Contact list.";
  const opp = f.previousSend ? await db.emailDraft.findUnique({ where: { id: f.previousSend.draftId }, include: { opportunity: true } }) : null;
  if (opp?.opportunity?.status === "CLOSED") return "The related opportunity has closed.";
  return null;
}

/** Re-evaluate scheduled follow-ups; suppress invalid ones and flag due contacts. */
export async function refreshFollowUps(profileId: string, now = new Date()) {
  const scheduled = await db.followUp.findMany({ where: { profileId, status: "SCHEDULED" } });
  for (const f of scheduled) {
    const reason = await followUpSuppressionReason(profileId, f.id);
    if (reason) {
      await db.followUp.update({ where: { id: f.id }, data: { status: "SUPPRESSED", suppressedReason: reason } });
      continue;
    }
    if (f.dueDate <= now) {
      const c = await db.contact.findUnique({ where: { id: f.contactId } });
      if (c && c.stage === "SENT") {
        await db.contact.update({ where: { id: c.id }, data: { stage: "FOLLOW_UP_DUE" } });
        await logActivity(db, { profileId, contactId: c.id, type: "STAGE_CHANGE", summary: "Follow-up due", fromStage: "SENT", toStage: "FOLLOW_UP_DUE" });
      }
    }
  }
}

export async function listFollowUps(profileId: string) {
  await refreshFollowUps(profileId);
  return db.followUp.findMany({
    where: { profileId },
    include: { contact: { include: { company: true } }, previousSend: true, draft: true },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

export async function rescheduleFollowUp(profileId: string, followUpId: string, dueDate: Date) {
  if (Number.isNaN(dueDate.getTime())) throw new UserError("Invalid date.");
  const r = await db.followUp.updateMany({ where: { id: followUpId, profileId, status: { in: ["SCHEDULED", "SUPPRESSED", "SKIPPED"] } }, data: { dueDate, status: "SCHEDULED", suppressedReason: null } });
  if (!r.count) throw new NotFoundError("Follow-up");
}

export async function skipFollowUp(profileId: string, followUpId: string, reason = "Skipped by you") {
  const r = await db.followUp.updateMany({ where: { id: followUpId, profileId }, data: { status: "SKIPPED", suppressedReason: reason } });
  if (!r.count) throw new NotFoundError("Follow-up");
}

/** Prepare (never send) a follow-up draft threaded to the previous email. */
export async function draftFollowUp(profileId: string, followUpId: string) {
  const reason = await followUpSuppressionReason(profileId, followUpId);
  if (reason) throw new UserError(`Follow-up suppressed: ${reason}`);
  const f = await db.followUp.findFirstOrThrow({ where: { id: followUpId, profileId }, include: { previousSend: true, contact: true } });
  if (f.draftId) return db.emailDraft.findUniqueOrThrow({ where: { id: f.draftId } });
  const prev = f.previousSend;
  if (!prev) throw new UserError("No previous email to follow up on.");
  const prevDraft = await db.emailDraft.findUnique({ where: { id: prev.draftId } });
  const draft = await db.emailDraft.create({
    data: {
      profileId,
      contactId: f.contactId,
      companyId: f.contact.companyId,
      opportunityId: prevDraft?.opportunityId ?? null,
      resumeId: prevDraft?.resumeId ?? null,
      kind: "FOLLOW_UP",
      recipientType: "FOLLOW_UP",
      recipientEmail: prev.toAddress,
      recipientName: f.contact.fullName,
      subject: `Re: ${prev.subject.replace(/^(re:\s*)+/i, "")}`,
      body: "",
      contentHash: "",
      idempotencyKey: randomUUID(),
      inReplyToMessageId: prev.providerMessageId,
    },
  });
  await db.followUp.update({ where: { id: f.id }, data: { draftId: draft.id, status: "DRAFTED" } });
  const generated = await regenerateDraft(profileId, draft.id);
  // Keep threading-friendly subject as the first option.
  const subject = `Re: ${prev.subject.replace(/^(re:\s*)+/i, "")}`;
  await db.emailDraft.update({
    where: { id: draft.id },
    data: { subject, contentHash: contentHash({ subject, body: generated.body, recipientEmail: prev.toAddress, resumeId: draft.resumeId }) },
  });
  await logActivity(db, { profileId, contactId: f.contactId, type: "FOLLOW_UP", summary: "Follow-up draft prepared for review", draftId: draft.id });
  return db.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
}
