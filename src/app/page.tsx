import Link from "next/link";
import { Card, fmtDateTime, Notice, PageHeader, Stat } from "@/components/ui";
import { db } from "@/lib/db";
import { accountReadiness } from "@/lib/sending/accounts";
import { getActiveProfile } from "@/lib/session";
import { dashboardMetrics, recentActivity } from "@/lib/services/dashboard";

export default async function DashboardPage() {
  const profile = await getActiveProfile();
  const [m, activity, account, resumeCount, highlightCount] = await Promise.all([
    dashboardMetrics(profile.id),
    recentActivity(profile.id),
    db.emailAccount.findFirst({ where: { profileId: profile.id, isActive: true } }),
    db.resume.count({ where: { profileId: profile.id } }),
    db.profileHighlight.count({ where: { profileId: profile.id, confirmed: true } }),
  ]);
  const sender = accountReadiness(account);
  const setup = [
    { done: !!profile.candidateName, label: "Add the candidate's name and status exactly as on the résumé", href: "/settings#profile" },
    { done: resumeCount > 0, label: "Upload a PDF résumé", href: "/resumes" },
    { done: highlightCount > 0, label: "Confirm at least one experience highlight (used to personalise emails)", href: "/resumes#highlights" },
    { done: m.companiesTargeted > 0, label: "Add or discover target companies", href: "/discover/companies" },
    { done: sender.ready, label: "Configure a sender account (optional – otherwise draft-only)", href: "/settings#sender" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${profile.portalName} dashboard`}
        description={
          <>
            {profile.candidateName ? <strong>{profile.candidateName}</strong> : <em>Candidate name not set</em>}
            {profile.currentStatus ? ` · ${profile.currentStatus}` : ""}. All figures below are counts of stored records; nothing is estimated.
          </>
        }
      />

      {setup.some((s) => !s.done) ? (
        <Card title="Set-up checklist">
          <ul className="space-y-1 text-sm">
            {setup.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <span aria-hidden className={s.done ? "text-emerald-600" : "text-slate-400"}>{s.done ? "✓" : "○"}</span>
                {s.done ? <span className="text-slate-500 line-through">{s.label}</span> : <Link className="text-indigo-700 hover:underline" href={s.href}>{s.label}</Link>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {m.unknownSends ? (
        <Notice tone="red">
          {m.unknownSends} send attempt(s) have an unknown outcome. Check your mail provider&apos;s Sent folder and resolve them in <Link className="underline" href="/drafts">Email Drafts</Link>.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label="Companies researched" value={m.companiesResearched} hint={`${m.companiesTargeted} tracked · ${m.openRoles} open roles observed`} href="/companies" />
        <Stat label="Relevant contacts" value={m.relevantContacts} hint={`score ≥ 60 of ${m.contactsTotal} contacts`} href="/contacts?minScore=60" />
        <Stat label="Publicly listed emails" value={m.publiclyListed} hint="exact address seen on a public page" href="/contacts?emailStatus=PUBLICLY_LISTED" />
        <Stat label="Provider-verified emails" value={m.providerVerified} hint="optional provider result" href="/contacts?emailStatus=PROVIDER_VERIFIED" />
        <Stat label="Contacts requiring review" value={m.needsReview} href="/contacts?review=NEEDS_REVIEW" tone={m.needsReview ? "warn" : undefined} />
        <Stat label="Drafts awaiting approval" value={m.draftsAwaiting} href="/drafts" />
        <Stat label="Emails sent" value={m.emailsSent} hint={`accepted by your mail server · ${m.sent24h}/${m.dailyLimit} in last 24h`} href="/pipeline" />
        <Stat label="Replies recorded" value={m.repliesInbox + m.repliesManual} hint={`${m.repliesInbox} observed in inbox · ${m.repliesManual} logged manually`} href="/pipeline?stage=REPLIED" />
        <Stat label="Follow-ups due" value={m.followUpsDue} href="/followups" tone={m.followUpsDue ? "warn" : undefined} />
        <Stat label="Opportunities identified" value={m.opportunities} hint="meeting, opportunity, referral or application stage" href="/pipeline" />
      </div>

      <Card title="Recent activity">
        {activity.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <Link className="font-medium text-indigo-700 hover:underline" href={`/contacts/${a.contact.id}`}>{a.contact.fullName}</Link>{" "}
                  <span className="text-slate-600">— {a.summary}</span>
                </span>
                <span className="text-xs text-slate-500">
                  {a.source.toLowerCase()} · {fmtDateTime(a.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No activity yet.</p>
        )}
      </Card>
    </div>
  );
}
