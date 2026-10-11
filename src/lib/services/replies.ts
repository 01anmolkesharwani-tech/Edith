/**
 * Reply and bounce tracking.
 * - Manual logging is always available and is labelled MANUAL.
 * - Optional read-only IMAP sync (same app password, EXAMINE/read-only mailbox) matches replies
 *   by In-Reply-To / References against the Message-IDs of emails we sent. Labelled INBOX.
 * Opens are never tracked (no tracking pixels).
 */
import { db } from "@/lib/db";
import { readSecret } from "@/lib/sending/transport";
import { logActivity } from "./activity";
import { autoAdvance } from "./contacts";
import { NotFoundError, UserError } from "./errors";

export async function logReplyManually(profileId: string, sendLogId: string, note?: string | null, at?: Date) {
  const log = await db.emailSendLog.findFirst({ where: { id: sendLogId, profileId } });
  if (!log) throw new NotFoundError("Sent email");
  const when = at && !Number.isNaN(at.getTime()) ? at : new Date();
  await db.$transaction(async (tx) => {
    await tx.emailSendLog.update({ where: { id: log.id }, data: { replySource: "MANUAL", repliedAt: when, replySnippet: note?.slice(0, 500) ?? null } });
    await logActivity(tx, { profileId, contactId: log.contactId, type: "REPLY", source: "MANUAL", summary: `Reply recorded manually${note ? `: ${note}` : ""}`, sendLogId: log.id, occurredAt: when });
    await autoAdvance(tx, profileId, log.contactId, "REPLIED", "Reply recorded", "MANUAL");
    await tx.followUp.updateMany({ where: { contactId: log.contactId, status: { in: ["SCHEDULED", "DRAFTED"] } }, data: { status: "SUPPRESSED", suppressedReason: "Recipient replied" } });
  });
}

export async function logBounceManually(profileId: string, sendLogId: string, details?: string | null) {
  const log = await db.emailSendLog.findFirst({ where: { id: sendLogId, profileId } });
  if (!log) throw new NotFoundError("Sent email");
  await db.$transaction(async (tx) => {
    await tx.emailSendLog.update({ where: { id: log.id }, data: { bounceSource: "MANUAL", bouncedAt: new Date(), bounceDetails: details?.slice(0, 500) ?? null } });
    await tx.emailVerification.create({ data: { contactId: log.contactId, email: log.toAddress, stage: "PROVIDER", result: "FAIL", provider: "bounce", details: `Bounce recorded manually${details ? `: ${details}` : ""}` } });
    await logActivity(tx, { profileId, contactId: log.contactId, type: "BOUNCE", source: "MANUAL", summary: `Bounce recorded manually${details ? `: ${details}` : ""}`, sendLogId: log.id });
    await tx.followUp.updateMany({ where: { contactId: log.contactId, status: { in: ["SCHEDULED", "DRAFTED"] } }, data: { status: "SUPPRESSED", suppressedReason: "Email bounced" } });
  });
  const { recomputeContact } = await import("./contacts");
  await recomputeContact(log.contactId);
}

export interface ImapMessage {
  uid: number;
  from: string | null;
  subject: string | null;
  date: Date | null;
  inReplyTo: string | null;
  references: string[];
  isBounce: boolean;
  bodyMentions?: string[]; // message-ids found in a bounce body
}

export interface ImapSource {
  /** Fetch recent messages (headers only) from INBOX in read-only mode. */
  fetchRecent(since: Date): Promise<ImapMessage[]>;
}

export async function imapSourceFor(account: {
  imapHost: string | null;
  imapPort: number | null;
  smtpUser: string | null;
  secretEnvVar: string | null;
}): Promise<ImapSource> {
  const pass = readSecret(account.secretEnvVar);
  if (!account.imapHost || !account.smtpUser || !pass) throw new UserError("IMAP is not fully configured for this account.");
  const { ImapFlow } = await import("imapflow");
  return {
    async fetchRecent(since) {
      const client = new ImapFlow({
        host: account.imapHost!,
        port: account.imapPort ?? 993,
        secure: true,
        auth: { user: account.smtpUser!, pass },
        logger: false,
      });
      await client.connect();
      const out: ImapMessage[] = [];
      try {
        await client.mailboxOpen("INBOX", { readOnly: true });
        const uids = (await client.search({ since }, { uid: true })) || [];
        const recent = uids.slice(-500);
        if (recent.length) {
          for await (const m of client.fetch(recent, { envelope: true, headers: ["in-reply-to", "references", "content-type"], source: false }, { uid: true })) {
            const headers = m.headers?.toString("utf8") ?? "";
            const refs = [...headers.matchAll(/<[^>\s]+>/g)].map((x) => x[0]);
            const from = m.envelope?.from?.[0]?.address?.toLowerCase() ?? null;
            const isBounce = !!from && /^(mailer-daemon|postmaster)@/i.test(from);
            out.push({
              uid: m.uid,
              from,
              subject: m.envelope?.subject ?? null,
              date: m.envelope?.date ? new Date(m.envelope.date) : null,
              inReplyTo: m.envelope?.inReplyTo ?? null,
              references: refs,
              isBounce,
            });
          }
          // For bounces, look for our Message-IDs in the DSN body (headers of the original message).
          for (const msg of out.filter((x) => x.isBounce)) {
            const dl = await client.download(String(msg.uid), undefined, { uid: true, maxBytes: 200_000 });
            let text = "";
            if (dl?.content) for await (const chunk of dl.content) text += chunk.toString();
            msg.bodyMentions = [...text.matchAll(/<[^>\s]+@[^>\s]+>/g)].map((x) => x[0]);
          }
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
      return out;
    },
  };
}

/** Match inbox messages to sent emails by Message-ID threading. */
export async function syncReplies(profileId: string, source?: ImapSource) {
  const account = await db.emailAccount.findFirst({ where: { profileId, isActive: true } });
  if (!account) throw new UserError("No sender account configured.");
  if (!source && !account.imapEnabled) throw new UserError("Inbox reply tracking is not enabled for this account.");
  const since = new Date(Date.now() - 60 * 86_400_000);
  const sent = await db.emailSendLog.findMany({
    where: { profileId, status: "ACCEPTED", attemptedAt: { gte: since }, providerMessageId: { not: null } },
  });
  if (!sent.length) return { checked: 0, replies: 0, bounces: 0 };
  const byId = new Map(sent.map((s) => [s.providerMessageId!, s]));
  const messages = await (source ?? (await imapSourceFor(account))).fetchRecent(since);
  let replies = 0;
  let bounces = 0;
  for (const m of messages) {
    if (m.isBounce) {
      const hit = (m.bodyMentions ?? []).map((id) => byId.get(id)).find(Boolean);
      if (hit && !hit.bouncedAt) {
        await db.$transaction(async (tx) => {
          await tx.emailSendLog.update({ where: { id: hit.id }, data: { bounceSource: "INBOX", bouncedAt: m.date ?? new Date(), bounceDetails: m.subject?.slice(0, 300) ?? null } });
          await tx.emailVerification.create({ data: { contactId: hit.contactId, email: hit.toAddress, stage: "PROVIDER", result: "FAIL", provider: "bounce", details: `Bounce observed in inbox: ${m.subject ?? ""}`.slice(0, 300) } });
          await logActivity(tx, { profileId, contactId: hit.contactId, type: "BOUNCE", source: "INBOX", summary: `Bounce notice observed in inbox: ${m.subject ?? ""}`, sendLogId: hit.id });
          await tx.followUp.updateMany({ where: { contactId: hit.contactId, status: { in: ["SCHEDULED", "DRAFTED"] } }, data: { status: "SUPPRESSED", suppressedReason: "Email bounced" } });
        });
        bounces++;
      }
      continue;
    }
    const ids = [m.inReplyTo, ...m.references].filter((x): x is string => !!x);
    const hit = ids.map((id) => byId.get(id)).find(Boolean);
    if (!hit || hit.repliedAt) continue;
    if (m.from && m.from === account.fromAddress) continue; // our own follow-up in the thread
    await db.$transaction(async (tx) => {
      await tx.emailSendLog.update({ where: { id: hit.id }, data: { replySource: "INBOX", repliedAt: m.date ?? new Date(), replySnippet: m.subject?.slice(0, 300) ?? null } });
      await logActivity(tx, { profileId, contactId: hit.contactId, type: "REPLY", source: "INBOX", summary: `Reply observed in inbox from ${m.from ?? "unknown"}: ${m.subject ?? ""}`, sendLogId: hit.id, occurredAt: m.date ?? new Date() });
      await autoAdvance(tx, profileId, hit.contactId, "REPLIED", "Reply observed in inbox", "INBOX");
      await tx.followUp.updateMany({ where: { contactId: hit.contactId, status: { in: ["SCHEDULED", "DRAFTED"] } }, data: { status: "SUPPRESSED", suppressedReason: "Recipient replied" } });
    });
    replies++;
  }
  await db.emailAccount.update({ where: { id: account.id }, data: { lastReplySyncAt: new Date() } });
  if (bounces) {
    const { recomputeContact } = await import("./contacts");
    for (const id of new Set(sent.map((x) => x.contactId))) await recomputeContact(id);
  }
  return { checked: messages.length, replies, bounces };
}
