import { db } from "@/lib/db";
import { sentInLast24h } from "@/lib/sending/send";
import { refreshFollowUps } from "./followups";

/** All numbers are counts of stored records — nothing here is estimated. */
export async function dashboardMetrics(profileId: string, now = new Date()) {
  await refreshFollowUps(profileId, now);
  const contactWhere = { profileId, mergedIntoId: null };
  const [
    companiesTargeted,
    companiesResearched,
    contactsTotal,
    relevantContacts,
    publiclyListed,
    providerVerified,
    needsReview,
    draftsAwaiting,
    emailsSent,
    unknownSends,
    repliesInbox,
    repliesManual,
    followUpsDue,
    opportunities,
    openRoles,
    sent24h,
    profile,
  ] = await Promise.all([
    db.profileCompany.count({ where: { profileId, status: { not: "EXCLUDED" } } }),
    db.profileCompany.count({ where: { profileId, status: { not: "EXCLUDED" }, company: { lastResearchedAt: { not: null } } } }),
    db.contact.count({ where: contactWhere }),
    db.contact.count({ where: { ...contactWhere, relevanceScore: { gte: 60 } } }),
    db.contact.count({ where: { ...contactWhere, emailStatus: "PUBLICLY_LISTED" } }),
    db.contact.count({ where: { ...contactWhere, emailStatus: "PROVIDER_VERIFIED" } }),
    db.contact.count({ where: { ...contactWhere, reviewState: { in: ["NEEDS_REVIEW", "UNREVIEWED"] } } }),
    db.emailDraft.count({ where: { profileId, sendState: "DRAFT" } }),
    db.emailSendLog.count({ where: { profileId, status: "ACCEPTED" } }),
    db.emailSendLog.count({ where: { profileId, status: "UNKNOWN" } }),
    db.emailSendLog.count({ where: { profileId, replySource: "INBOX" } }),
    db.emailSendLog.count({ where: { profileId, replySource: "MANUAL" } }),
    db.followUp.count({ where: { profileId, status: "SCHEDULED", dueDate: { lte: now } } }),
    db.contact.count({ where: { ...contactWhere, stage: { in: ["OPPORTUNITY_IDENTIFIED", "REFERRED", "APPLIED", "MEETING_SCHEDULED"] } } }),
    db.jobOpportunity.count({ where: { status: "OPEN", company: { profileLinks: { some: { profileId, status: { not: "EXCLUDED" } } } } } }),
    sentInLast24h(profileId, now),
    db.candidateProfile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);
  return {
    companiesTargeted,
    companiesResearched,
    contactsTotal,
    relevantContacts,
    publiclyListed,
    providerVerified,
    needsReview,
    draftsAwaiting,
    emailsSent,
    unknownSends,
    repliesInbox,
    repliesManual,
    followUpsDue,
    opportunities,
    openRoles,
    sent24h,
    dailyLimit: profile.dailySendLimit,
  };
}

export async function recentActivity(profileId: string, take = 15) {
  return db.outreachActivity.findMany({
    where: { profileId },
    include: { contact: { select: { id: true, fullName: true } } },
    orderBy: { occurredAt: "desc" },
    take,
  });
}
