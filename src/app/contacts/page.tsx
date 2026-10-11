import Link from "next/link";
import { createDraftAction } from "@/app/actions/outreach";
import { recomputeAllAction } from "@/app/actions/contacts";
import { EmailStatusBadge, FreshnessBadge, OriginBadge, ReviewBadge, ScorePill, StageBadge } from "@/components/badges";
import { ActionForm } from "@/components/client/ActionForm";
import { buttonClass, Empty, fmtDate, inputClass, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { EMAIL_STATUS_INFO } from "@/lib/email/validation";
import { FRESHNESS_LABELS } from "@/lib/domain/freshness";
import { STAGE_LABELS, STAGES } from "@/lib/domain/stages";
import { getActiveProfile } from "@/lib/session";
import { listContacts } from "@/lib/services/contacts";

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const profile = await getActiveProfile();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const [contacts, companies] = await Promise.all([
    listContacts(profile.id, {
      q: one("q") || undefined,
      companyId: one("companyId") || undefined,
      industry: one("industry") || undefined,
      seniority: one("seniority") || undefined,
      location: one("location") || undefined,
      minScore: one("minScore") ? Number(one("minScore")) : undefined,
      emailStatus: one("emailStatus") || undefined,
      freshness: (one("freshness") || undefined) as never,
      stage: one("stage") || undefined,
      review: one("review") || undefined,
      discoveredFrom: one("from") || undefined,
      discoveredTo: one("to") || undefined,
      sort: (one("sort") || "score") as never,
    }),
    db.company.findMany({ where: { contacts: { some: { profileId: profile.id } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const sel = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contacts"
        description={`${contacts.length} contact(s) in the ${profile.portalName} portal. Scores are explainable – open a contact for the breakdown. “Prepare email” creates a draft only; nothing is sent until you review and click Send.`}
        actions={
          <>
            <Link href="/discover/contacts" className={buttonClass.primary}>Discover contacts</Link>
            <ActionForm action={recomputeAllAction} submitLabel="Recalculate scores" submitClassName={buttonClass.secondary} className="flex flex-col items-end" />
          </>
        }
      />
      <form className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-6">
        <input aria-label="Search name, title or email" name="q" defaultValue={one("q")} placeholder="Name, title, email" className={`${inputClass} md:col-span-2`} />
        <select aria-label="Company" name="companyId" defaultValue={one("companyId")} className={sel}><option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input aria-label="Industry" name="industry" defaultValue={one("industry")} placeholder="Industry" className={sel} />
        <select aria-label="Seniority" name="seniority" defaultValue={one("seniority")} className={sel}>
          <option value="">Any seniority</option>{["INTERN", "JUNIOR", "MID", "SENIOR", "LEADER", "EXECUTIVE", "UNKNOWN"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
        <input aria-label="Location" name="location" defaultValue={one("location")} placeholder="Location" className={sel} />
        <select aria-label="Minimum score" name="minScore" defaultValue={one("minScore")} className={sel}><option value="">Any score</option>{[40, 50, 60, 70, 80].map((n) => <option key={n} value={n}>≥ {n}</option>)}</select>
        <select aria-label="Email status" name="emailStatus" defaultValue={one("emailStatus")} className={sel}><option value="">Any email status</option>{Object.entries(EMAIL_STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select aria-label="Evidence freshness" name="freshness" defaultValue={one("freshness")} className={sel}><option value="">Any freshness</option>{Object.entries(FRESHNESS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Outreach stage" name="stage" defaultValue={one("stage")} className={sel}><option value="">Any stage</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
        <select aria-label="Review state" name="review" defaultValue={one("review")} className={sel}><option value="">Any review state</option><option value="UNREVIEWED">Unreviewed</option><option value="NEEDS_REVIEW">Needs review</option><option value="CONFIRMED">Reviewed</option></select>
        <input aria-label="Discovered from" type="date" name="from" defaultValue={one("from")} className={sel} />
        <input aria-label="Discovered to" type="date" name="to" defaultValue={one("to")} className={sel} />
        <select aria-label="Sort" name="sort" defaultValue={one("sort") || "score"} className={sel}><option value="score">Sort: relevance</option><option value="recent">Sort: newest</option><option value="name">Sort: name</option></select>
        <div className="flex gap-2 md:col-span-2"><button className={buttonClass.secondary}>Apply filters</button><Link href="/contacts" className={buttonClass.ghost}>Reset</Link></div>
      </form>

      <form id="export-form" action="/api/export/contacts" method="get" className="flex items-center gap-2 text-xs text-slate-600">
        <button className={buttonClass.small}>Export selected (CSV)</button>
        <span>Tick rows below; with none ticked, all contacts are exported.</span>
      </form>

      {contacts.length === 0 ? (
        <Empty>No contacts match. <Link className="text-indigo-700 underline" href="/discover/contacts">Discover contacts</Link></Empty>
      ) : (
        <Table>
          <thead>
            <tr><Th><span className="sr-only">Select</span></Th><Th>Score</Th><Th>Contact</Th><Th>Company</Th><Th>Email</Th><Th>Evidence</Th><Th>Stage</Th><Th>Discovered</Th><Th>Actions</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/60">
                <Td><input type="checkbox" name="id" value={c.id} form="export-form" aria-label={`Select ${c.fullName}`} /></Td>
                <Td><ScorePill score={c.relevanceScore} /></Td>
                <Td>
                  <Link href={`/contacts/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.fullName}</Link>
                  <div className="text-xs text-slate-600">{c.title ?? <em>title unknown</em>}</div>
                  <div className="text-xs text-slate-400">{[c.seniority?.toLowerCase(), c.location].filter(Boolean).join(" · ")}</div>
                </Td>
                <Td className="text-xs">{c.company ? <Link href={`/companies/${c.company.id}`} className="hover:underline">{c.company.name}</Link> : "—"}<div className="text-slate-400">{c.company?.industry}</div></Td>
                <Td className="text-xs">{c.email ? <div className="mb-1 font-mono">{c.email}</div> : <div className="mb-1 text-slate-400">no email</div>}<EmailStatusBadge status={c.emailStatus} origin={c.emailOrigin} /></Td>
                <Td><div className="flex flex-col items-start gap-1"><FreshnessBadge value={c.freshness} /><OriginBadge origin={c.origin} /><ReviewBadge state={c.reviewState} /></div></Td>
                <Td><StageBadge stage={c.stage} /></Td>
                <Td className="text-xs">{fmtDate(c.discoveredAt)}</Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    {c.email && c.stage !== "DO_NOT_CONTACT" ? (
                      <form action={createDraftAction}>
                        <input type="hidden" name="contactId" value={c.id} />
                        <button className={buttonClass.small} title="Creates a draft for review – does not send">Prepare email</button>
                      </form>
                    ) : null}
                    <Link href={`/contacts/${c.id}`} className={buttonClass.small}>Evidence</Link>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
