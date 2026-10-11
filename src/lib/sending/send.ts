/**
 * Approved, one-recipient email sending with idempotency.
 *
 * Guarantees:
 * - Nothing is sent unless the user explicitly calls sendDraft for a reviewed draft.
 * - A draft is claimed atomically (DRAFT/FAILED → SENDING) so repeated clicks or concurrent
 *   requests cannot send twice; a unique idempotency key per attempt backs this up in the log.
 * - Ambiguous outcomes (e.g. timeouts after transmission) become UNKNOWN and are never retried
 *   automatically. Definite failures enter a cooldown before the user may try again.
 * - "Sent" is only recorded when the provider accepted the message for delivery (which still
 *   does not guarantee inbox delivery).
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { checkSyntax, isRoleAddress } from "@/lib/email/validation";
import { emailDomain, normalizeEmail } from "@/lib/normalize";
import { logActivity } from "@/lib/services/activity";
import { autoAdvance } from "@/lib/services/contacts";
import { NotFoundError, UserError } from "@/lib/services/errors";
import { readResumeFile } from "@/lib/services/resumes";
import { suppressionFor } from "@/lib/services/suppression";
import { accountReadiness } from "./accounts";
import { classifySendError, smtpTransport, type MailTransport } from "./transport";

export type CheckLevel = "BLOCKER" | "CONFIRM" | "WARNING";

export interface ReadinessItem {
  code: string;
  level: CheckLevel;
  message: string;
}

export interface Readiness {
  canSend: boolean;
  items: ReadinessItem[];
  sentLast24h: number;
  dailyLimit: number;
  account: { id: string; fromAddress: string; fromName: string; label: string } | null;
}

const DAY = 86_400_000;
const STUCK_AFTER_MS = 10 * 60_000;

export async function sentInLast24h(profileId: string, now = new Date()): Promise<number> {
  return db.emailSendLog.count({
    where: { profileId, status: { in: ["ACCEPTED", "UNKNOWN", "PENDING"] }, attemptedAt: { gte: new Date(now.getTime() - DAY) } },
  });
}

export async function checkReadiness(profileId: string, draftId: string, now = new Date()): Promise<Readiness> {
  const draft = await db.emailDraft.findFirst({
    where: { id: draftId, profileId },
    include: { contact: true, resume: true, profile: true },
  });
  if (!draft) throw new NotFoundError("Draft");
  const items: ReadinessItem[] = [];
  const block = (code: string, message: string) => items.push({ code, level: "BLOCKER", message });
  const confirm = (code: string, message: string) => items.push({ code, level: "CONFIRM", message });
  const warn = (code: string, message: string) => items.push({ code, level: "WARNING", message });

  // State
  if (draft.sendState === "SENT") block("ALREADY_SENT", "This email has already been sent.");
  if (draft.sendState === "SENDING") {
    if (now.getTime() - draft.updatedAt.getTime() > STUCK_AFTER_MS) {
      block("OUTCOME_UNKNOWN", "A previous send was interrupted. Check your Sent folder, then resolve it on this page.");
    } else block("IN_PROGRESS", "A send is already in progress for this draft.");
  }
  if (draft.sendState === "UNKNOWN")
    block("OUTCOME_UNKNOWN", "The previous attempt's outcome is unknown. Check your mail provider's Sent folder, then resolve it on this page before trying again.");
  if (draft.sendState === "CANCELLED") block("CANCELLED", "This draft was cancelled.");

  // Sender account
  const account = await db.emailAccount.findFirst({ where: { profileId, isActive: true } });
  const acc = accountReadiness(account);
  if (!acc.ready) block("NO_SENDER", acc.reason ?? "No sender account.");

  // Recipient
  const to = normalizeEmail(draft.recipientEmail);
  if (!to) block("NO_RECIPIENT", "Recipient email address is missing.");
  else if (!checkSyntax(to).ok) block("BAD_RECIPIENT", "Recipient email address is not valid.");

  // Content
  if (!draft.subject.trim()) block("NO_SUBJECT", "Subject is empty.");
  if (!draft.body.trim()) block("NO_BODY", "Message body is empty.");
  if (/\{\{[^}]*\}\}/.test(draft.subject + draft.body)) block("UNFILLED", "The message still contains template placeholders ({{…}}).");
  if (!draft.profile.candidateName) block("NO_CANDIDATE_NAME", "Candidate name is missing from the profile.");

  // Attachment: must exist and belong to this profile.
  if (!draft.resumeId || !draft.resume) {
    if (draft.kind === "INITIAL") block("NO_RESUME", "No résumé selected. Upload a résumé for this profile first.");
  } else if (draft.resume.profileId !== profileId) {
    block("WRONG_RESUME", "The selected résumé belongs to a different profile.");
  } else {
    try {
      await readResumeFile(profileId, draft.resume.id);
    } catch (e) {
      block("RESUME_FILE", (e as Error).message);
    }
  }

  // Suppression / Do Not Contact
  if (draft.contact.stage === "DO_NOT_CONTACT") block("DNC", "This contact is marked Do Not Contact.");
  const sup = await suppressionFor(profileId, to, draft.contactId);
  if (sup) block("SUPPRESSED", `Recipient is on the Do Not Contact list (${sup.reason}).`);

  // Email quality
  if (to && normalizeEmail(draft.contact.email) === to) {
    if (draft.contact.emailStatus === "UNDELIVERABLE") block("UNDELIVERABLE", "This address is marked undeliverable.");
    const risky =
      draft.contact.emailOrigin === "PATTERN_GUESS" ||
      ["UNCERTAIN", "CATCH_ALL_RISKY", "STALE"].includes(draft.contact.emailStatus);
    if (risky && !draft.guessAcknowledged) {
      confirm(
        "UNCERTAIN_EMAIL",
        `The address is ${draft.contact.emailOrigin === "PATTERN_GUESS" ? "a pattern guess" : draft.contact.emailStatus.toLowerCase().replace(/_/g, " ")} and has not been confirmed. Confirm you have reviewed this uncertainty.`,
      );
    }
    if (draft.contact.emailStatus === "NOT_CHECKED") warn("NOT_CHECKED", "Email checks have not been run for this address.");
  } else if (to) {
    warn("EDITED_RECIPIENT", "The recipient address differs from the contact record and has no verification history.");
  }
  if (to && isRoleAddress(to)) warn("ROLE_ADDRESS", "This is a shared inbox (e.g. careers@), not an individual.");

  // Duplicates: previous accepted/unknown sends to this address or contact.
  if (to) {
    const previous = await db.emailSendLog.findMany({
      where: {
        status: { in: ["ACCEPTED", "UNKNOWN"] },
        OR: [{ toAddress: to }, { contactId: draft.contactId }],
        NOT: { draftId: draft.id },
      },
      select: { profileId: true, attemptedAt: true, subject: true, draft: { select: { kind: true, opportunityId: true } } },
    });
    const sameProfile = previous.filter((p) => p.profileId === profileId);
    const otherProfile = previous.filter((p) => p.profileId !== profileId);
    if (draft.kind === "INITIAL" && sameProfile.length && !draft.duplicateAcknowledged) {
      const sameOpp = sameProfile.some((p) => draft.opportunityId && p.draft.opportunityId === draft.opportunityId);
      confirm(
        "DUPLICATE",
        `${sameOpp ? "This opportunity" : "This recipient"} was already contacted on ${sameProfile[0].attemptedAt.toISOString().slice(0, 10)} ("${sameProfile[0].subject}"). Confirm a new initial email is intended.`,
      );
    }
    if (otherProfile.length) warn("OTHER_PROFILE", "The other candidate has also emailed this recipient.");
    const domain = emailDomain(to);
    if (domain) {
      const sameDomainToday = await db.emailSendLog.count({
        where: { profileId, status: "ACCEPTED", toAddress: { endsWith: `@${domain}` }, attemptedAt: { gte: new Date(now.getTime() - DAY) } },
      });
      if (sameDomainToday >= 3) warn("DOMAIN_VOLUME", `You have emailed ${sameDomainToday} people at ${domain} in the last 24 hours.`);
    }
  }

  // Review
  if (draft.reviewedHash !== draft.contentHash) {
    confirm(
      "NOT_REVIEWED",
      draft.reviewedHash
        ? "The recipient, attachment or message changed after you reviewed it. Review and confirm the final version."
        : "Review the final email (recipient, subject, message and attachment) and confirm.",
    );
  }

  // Limits
  const sentLast24h = await sentInLast24h(profileId, now);
  const limit = Math.min(draft.profile.dailySendLimit, account?.providerDailyLimit ?? Number.POSITIVE_INFINITY);
  if (sentLast24h >= limit) block("DAILY_LIMIT", `Daily sending limit reached (${sentLast24h}/${limit} in the last 24 hours).`);
  const lastFailure = await db.emailSendLog.findFirst({
    where: { profileId, status: { in: ["FAILED", "REJECTED"] } },
    orderBy: { attemptedAt: "desc" },
  });
  if (lastFailure) {
    const until = lastFailure.attemptedAt.getTime() + draft.profile.failedSendCooldownMinutes * 60_000;
    if (until > now.getTime()) {
      block("COOLDOWN", `Sending is paused after a failed attempt. Try again after ${new Date(until).toLocaleTimeString()}.`);
    }
  }

  return {
    canSend: !items.some((i) => i.level === "BLOCKER" || i.level === "CONFIRM"),
    items,
    sentLast24h,
    dailyLimit: Number.isFinite(limit) ? limit : draft.profile.dailySendLimit,
    account: account ? { id: account.id, fromAddress: account.fromAddress, fromName: account.fromName, label: account.label } : null,
  };
}

export interface SendResult {
  status: "ACCEPTED" | "REJECTED" | "FAILED" | "UNKNOWN" | "BLOCKED";
  message: string;
  sendLogId?: string;
  providerMessageId?: string | null;
}

export type TransportFactory = (account: NonNullable<Awaited<ReturnType<typeof db.emailAccount.findFirst>>>) => MailTransport;

export async function sendDraft(
  profileId: string,
  draftId: string,
  expectedHash: string,
  deps: { transportFactory?: TransportFactory; now?: () => Date } = {},
): Promise<SendResult> {
  const now = deps.now ?? (() => new Date());
  const readiness = await checkReadiness(profileId, draftId, now());
  const blocking = readiness.items.filter((i) => i.level !== "WARNING");
  if (blocking.length) return { status: "BLOCKED", message: blocking.map((b) => b.message).join(" ") };

  // Atomic claim: only one request can move this exact content from DRAFT/FAILED to SENDING.
  const claim = await db.emailDraft.updateMany({
    where: { id: draftId, profileId, sendState: { in: ["DRAFT", "FAILED"] }, contentHash: expectedHash, reviewedHash: expectedHash },
    data: { sendState: "SENDING" },
  });
  if (claim.count !== 1) {
    return { status: "BLOCKED", message: "This email is already being sent, was already sent, or changed since you reviewed it." };
  }

  const draft = await db.emailDraft.findUniqueOrThrow({ where: { id: draftId }, include: { contact: true, resume: true } });
  const account = (await db.emailAccount.findFirst({ where: { profileId, isActive: true } }))!;
  const to = normalizeEmail(draft.recipientEmail)!;

  let attachment: { filename: string; content: Buffer; contentType: string } | null = null;
  try {
    if (draft.resumeId) {
      const { bytes, resume } = await readResumeFile(profileId, draft.resumeId);
      if (resume.profileId !== profileId) throw new UserError("Résumé does not belong to this profile.");
      attachment = { filename: resume.originalFilename, content: bytes, contentType: "application/pdf" };
    }
  } catch (e) {
    await db.emailDraft.update({ where: { id: draftId }, data: { sendState: "DRAFT", lastError: (e as Error).message } });
    return { status: "BLOCKED", message: (e as Error).message };
  }

  const domain = account.fromAddress.split("@")[1];
  const messageId = `<${randomUUID()}@${domain}>`;
  const log = await db.emailSendLog.create({
    data: {
      profileId,
      draftId,
      contactId: draft.contactId,
      emailAccountId: account.id,
      idempotencyKey: draft.idempotencyKey,
      provider: account.provider,
      fromAddress: account.fromAddress,
      toAddress: to,
      subject: draft.subject,
      bodySnapshot: draft.body,
      attachmentResumeId: draft.resumeId,
      attachmentFilename: attachment?.filename ?? null,
      attachmentSha256: draft.resume?.sha256 ?? null,
      status: "PENDING",
      providerMessageId: messageId,
      attemptedAt: now(),
    },
  });

  let transport: MailTransport;
  try {
    transport = (deps.transportFactory ?? smtpTransport)(account);
  } catch (e) {
    return finalizeFailure(profileId, draft, log.id, { outcome: "FAILED", message: (e as Error).message });
  }

  try {
    const res = await transport.send({
      from: { name: account.fromName, address: account.fromAddress },
      to: { name: draft.recipientName, address: to },
      subject: draft.subject,
      text: draft.body,
      messageId,
      inReplyTo: draft.inReplyToMessageId,
      references: draft.inReplyToMessageId ? [draft.inReplyToMessageId] : [],
      attachment,
    });
    if (res.accepted.includes(to)) {
      const sentAt = now();
      await db.$transaction(async (tx) => {
        await tx.emailSendLog.update({
          where: { id: log.id },
          data: { status: "ACCEPTED", providerMessageId: res.messageId || messageId, providerResponse: res.response, completedAt: sentAt },
        });
        await tx.emailDraft.update({
          where: { id: draftId },
          data: { sendState: "SENT", sentAt, providerMessageId: res.messageId || messageId, lastError: null },
        });
        await logActivity(tx, {
          profileId,
          contactId: draft.contactId,
          type: "EMAIL_SENT",
          source: "PROVIDER",
          summary: `Email accepted by ${account.fromAddress}'s mail server for delivery to ${to}: "${draft.subject}"${attachment ? ` (attached ${attachment.filename})` : ""}`,
          draftId,
          sendLogId: log.id,
        });
        await autoAdvance(tx, profileId, draft.contactId, "SENT", "Email sent", "PROVIDER");
        if (draft.kind === "FOLLOW_UP") {
          await tx.followUp.updateMany({ where: { draftId }, data: { status: "SENT" } });
        }
        // Schedule a follow-up for review (never sent automatically).
        const profile = await tx.candidateProfile.findUniqueOrThrow({ where: { id: profileId } });
        const sentCount = await tx.followUp.count({ where: { contactId: draft.contactId, status: { in: ["SENT", "DRAFTED", "SCHEDULED"] } } });
        if (profile.maxFollowUps > 0 && sentCount < profile.maxFollowUps) {
          await tx.followUp.create({
            data: {
              profileId,
              contactId: draft.contactId,
              previousSendId: log.id,
              sequence: sentCount + 1,
              dueDate: new Date(sentAt.getTime() + profile.followUpAfterDays * DAY),
            },
          });
        }
      });
      return { status: "ACCEPTED", message: `Accepted for delivery by the mail server (${account.fromAddress} → ${to}). Acceptance does not guarantee inbox delivery.`, sendLogId: log.id, providerMessageId: res.messageId };
    }
    return finalizeFailure(profileId, draft, log.id, {
      outcome: "FAILED",
      message: `The server rejected the recipient ${to}. ${res.response}`,
      rejected: true,
    });
  } catch (e) {
    return finalizeFailure(profileId, draft, log.id, classifySendError(e));
  }
}

async function finalizeFailure(
  profileId: string,
  draft: { id: string; contactId: string; subject: string },
  logId: string,
  r: { outcome: "FAILED" | "UNKNOWN"; message: string; rejected?: boolean },
): Promise<SendResult> {
  const status = r.outcome === "UNKNOWN" ? "UNKNOWN" : r.rejected ? "REJECTED" : "FAILED";
  await db.$transaction(async (tx) => {
    await tx.emailSendLog.update({ where: { id: logId }, data: { status, errorMessage: r.message, completedAt: new Date() } });
    await tx.emailDraft.update({
      where: { id: draft.id },
      data: {
        sendState: r.outcome === "UNKNOWN" ? "UNKNOWN" : "FAILED",
        lastError: r.message,
        // A definite failure means nothing was accepted, so a later user-initiated attempt gets a new key.
        ...(r.outcome === "FAILED" ? { idempotencyKey: randomUUID() } : {}),
      },
    });
    await logActivity(tx, {
      profileId,
      contactId: draft.contactId,
      type: "SEND_FAILED",
      source: "PROVIDER",
      summary: `${r.outcome === "UNKNOWN" ? "Send outcome unknown" : "Send failed"}: ${r.message}`.slice(0, 500),
      draftId: draft.id,
      sendLogId: logId,
    });
  });
  return {
    status,
    message:
      r.outcome === "UNKNOWN"
        ? `${r.message}. The email may or may not have been sent. Check your Sent folder before doing anything else; it will not be retried automatically.`
        : r.message,
    sendLogId: logId,
  };
}

/** Resolve an UNKNOWN outcome after the user checked their Sent folder. */
export async function resolveUnknownSend(profileId: string, draftId: string, wasSent: boolean) {
  const draft = await db.emailDraft.findFirst({
    where: {
      id: draftId,
      profileId,
      OR: [{ sendState: "UNKNOWN" }, { sendState: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } }],
    },
  });
  if (!draft) throw new UserError("This draft has no unresolved send.");
  const log = await db.emailSendLog.findFirst({ where: { draftId, status: { in: ["UNKNOWN", "PENDING"] } }, orderBy: { attemptedAt: "desc" } });
  await db.$transaction(async (tx) => {
    if (log) await tx.emailSendLog.update({ where: { id: log.id }, data: { status: wasSent ? "ACCEPTED" : "FAILED", providerResponse: wasSent ? "Confirmed by user from Sent folder" : "User confirmed not sent" } });
    await tx.emailDraft.update({
      where: { id: draftId },
      data: wasSent ? { sendState: "SENT", sentAt: log?.attemptedAt ?? new Date() } : { sendState: "FAILED", idempotencyKey: randomUUID() },
    });
    await logActivity(tx, {
      profileId,
      contactId: draft.contactId,
      type: wasSent ? "EMAIL_SENT" : "NOTE",
      source: "MANUAL",
      summary: wasSent ? "User confirmed the email appears in their Sent folder" : "User confirmed the email was not sent",
      draftId,
      sendLogId: log?.id,
    });
    if (wasSent) await autoAdvance(tx, profileId, draft.contactId, "SENT", "Email sent (confirmed by user)", "MANUAL");
  });
}
