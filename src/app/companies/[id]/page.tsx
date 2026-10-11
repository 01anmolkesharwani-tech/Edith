import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addJobAction,
  addResearchAction,
  deleteCompanyAction,
  deleteResearchAction,
  refreshJobsAction,
  researchWebsiteAction,
  setCompanyStatusAction,
  setJobStatusAction,
  toggleResearchAction,
  updateCompanyAction,
} from "@/app/actions/companies";
import { EmailStatusBadge, OriginBadge, ScorePill } from "@/components/badges";
import { ActionForm } from "@/components/client/ActionForm";
import { ConfirmButton } from "@/components/client/ConfirmButton";
import { Badge, buttonClass, Card, Empty, ExternalLink, Field, fmtDate, fmtDateTime, hostOf, inputClass, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { getActiveProfile } from "@/lib/session";
import { getCompanyForProfile } from "@/lib/services/companies";
import { NotFoundError } from "@/lib/services/errors";
import { RESEARCH_KINDS, researchSuggestions } from "@/lib/services/research";

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const profile = await getActiveProfile();
  let company;
  try {
    company = await getCompanyForProfile(profile.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const link = company.profileLinks[0] ?? null;
  const suggestions = await researchSuggestions(company.id);
  const openJobs = company.jobs.filter((j) => j.status === "OPEN");

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {company.website ? <ExternalLink href={company.website}>{company.domain}</ExternalLink> : <span className="text-amber-700">No official website recorded</span>}
            {company.industry ? <Badge>{company.industry}</Badge> : null}
            <OriginBadge origin={company.origin} />
            {link ? <Badge tone={link.status === "EXCLUDED" ? "red" : "indigo"}>{link.status.toLowerCase()}</Badge> : <Badge>not on your list</Badge>}
            {openJobs.length ? <Badge tone="green">{openJobs.length} open role(s) observed</Badge> : <Badge title="No vacancy observed – do not imply one exists">Speculative networking target</Badge>}
          </span>
        }
        actions={
          <>
            <Link href={`/discover/contacts?companyId=${company.id}`} className={buttonClass.primary}>Find contacts</Link>
            {(["TARGET", "WATCHING", "EXCLUDED"] as const).filter((s) => s !== link?.status).map((s) => (
              <form key={s} action={setCompanyStatusAction}>
                <input type="hidden" name="companyId" value={company.id} />
                <input type="hidden" name="status" value={s} />
                <button className={buttonClass.secondary}>{s === "TARGET" ? "Mark target" : s === "WATCHING" ? "Watch" : "Exclude"}</button>
              </form>
            ))}
          </>
        }
      />

      {link?.status === "EXCLUDED" ? <Notice tone="red">This company is on the excluded list for {profile.portalName}. Contacts here score 0 for company fit.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Company facts" className="lg:col-span-2" description={`Shared record · sources: ${company.sourceUrls === "[]" ? "none recorded" : "see below"} · last researched ${fmtDateTime(company.lastResearchedAt)}`}>
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Description</dt><dd>{company.description ?? "—"} {company.descriptionSourceUrl ? <ExternalLink className="text-xs" href={company.descriptionSourceUrl}>source</ExternalLink> : null}</dd></div>
            <div><dt className="text-xs text-slate-500">Headquarters</dt><dd>{company.headquarters ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Size</dt><dd>{company.sizeRange ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Business model</dt><dd>{company.businessModel ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Careers page</dt><dd>{company.careersUrl ? <ExternalLink href={company.careersUrl}>{hostOf(company.careersUrl)}</ExternalLink> : "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Leadership page</dt><dd>{company.leadershipUrl ? <ExternalLink href={company.leadershipUrl}>{company.leadershipUrl.replace(/^https?:\/\//, "")}</ExternalLink> : "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Public job board</dt><dd>{company.atsProvider ? `${company.atsProvider.toLowerCase()} · ${company.atsSlug}` : "—"}</dd></div>
          </dl>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-indigo-700">Edit facts</summary>
            <ActionForm action={updateCompanyAction} submitLabel="Save" className="mt-3 grid gap-3 md:grid-cols-2">
              <input type="hidden" name="id" value={company.id} />
              <Field label="Name" htmlFor="e-name"><input id="e-name" name="name" defaultValue={company.name} className={inputClass} /></Field>
              <Field label="Official website" htmlFor="e-web"><input id="e-web" name="website" defaultValue={company.website ?? ""} className={inputClass} /></Field>
              <Field label="Industry" htmlFor="e-ind"><input id="e-ind" name="industry" defaultValue={company.industry ?? ""} className={inputClass} /></Field>
              <Field label="Headquarters" htmlFor="e-hq"><input id="e-hq" name="headquarters" defaultValue={company.headquarters ?? ""} className={inputClass} /></Field>
              <Field label="Size" htmlFor="e-size"><input id="e-size" name="sizeRange" defaultValue={company.sizeRange ?? ""} className={inputClass} /></Field>
              <Field label="Business model" htmlFor="e-bm"><input id="e-bm" name="businessModel" defaultValue={company.businessModel ?? ""} className={inputClass} /></Field>
              <Field label="Careers page URL" htmlFor="e-car"><input id="e-car" name="careersUrl" defaultValue={company.careersUrl ?? ""} className={inputClass} /></Field>
              <Field label="Leadership / team page URL" htmlFor="e-lead"><input id="e-lead" name="leadershipUrl" defaultValue={company.leadershipUrl ?? ""} className={inputClass} /></Field>
              <Field label="Description" htmlFor="e-desc" className="md:col-span-2"><textarea id="e-desc" name="description" rows={2} defaultValue={company.description ?? ""} className={inputClass} /></Field>
              <Field label="Description source URL" htmlFor="e-dsrc"><input id="e-dsrc" name="descriptionSourceUrl" defaultValue={company.descriptionSourceUrl ?? ""} className={inputClass} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Job board" htmlFor="e-ats">
                  <select id="e-ats" name="atsProvider" defaultValue={company.atsProvider ?? ""} className={inputClass}>
                    <option value="">None</option><option value="GREENHOUSE">Greenhouse</option><option value="LEVER">Lever</option><option value="LEVER_EU">Lever (EU)</option><option value="ASHBY">Ashby</option>
                  </select>
                </Field>
                <Field label="Board id" htmlFor="e-slug" hint="from boards.greenhouse.io/<id>, jobs.lever.co/<id>…"><input id="e-slug" name="atsSlug" defaultValue={company.atsSlug ?? ""} className={inputClass} /></Field>
              </div>
            </ActionForm>
          </details>
        </Card>

        <Card title="Official website research" description="Fetches the homepage plus a few relevant pages (team, careers, about, contact, news). Obeys robots.txt.">
          {company.website ? (
            <ActionForm action={researchWebsiteAction} submitLabel="Research website now" pendingLabel="Researching (this respects per-site delays)…">
              <input type="hidden" name="companyId" value={company.id} />
              <Field label="Extra official page URLs (optional)" htmlFor="extra" hint="e.g. a specific leadership page; space-separated, max 5">
                <textarea id="extra" name="extraUrls" rows={2} className={inputClass} />
              </Field>
            </ActionForm>
          ) : (
            <Notice>Add the official website first (Edit facts).</Notice>
          )}
        </Card>
      </div>

      <Card
        title="Job openings"
        description="Only postings observed on public job boards or added by you. Closed postings are kept for history."
        actions={
          company.atsProvider ? (
            <ActionForm action={refreshJobsAction} submitLabel={`Refresh from ${company.atsProvider.toLowerCase()}`} submitClassName={buttonClass.secondary} className="flex flex-col items-end">
              <input type="hidden" name="companyId" value={company.id} />
            </ActionForm>
          ) : null
        }
      >
        {company.jobs.length ? (
          <Table>
            <thead><tr><Th>Title</Th><Th>Department</Th><Th>Location</Th><Th>Source</Th><Th>Status</Th><Th>Seen</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {company.jobs.map((j) => (
                <tr key={j.id}>
                  <Td>{j.url ? <ExternalLink href={j.url}>{j.title}</ExternalLink> : j.title}</Td>
                  <Td className="text-xs">{j.department ?? "—"}</Td>
                  <Td className="text-xs">{j.location ?? "—"}</Td>
                  <Td className="text-xs">{j.source.toLowerCase()}</Td>
                  <Td><Badge tone={j.status === "OPEN" ? "green" : "gray"}>{j.status.toLowerCase()}</Badge></Td>
                  <Td className="text-xs">retrieved {fmtDate(j.retrievedAt)} · last seen {fmtDate(j.lastSeenAt)}</Td>
                  <Td>
                    <form action={setJobStatusAction}>
                      <input type="hidden" name="jobId" value={j.id} />
                      <input type="hidden" name="status" value={j.status === "OPEN" ? "CLOSED" : "OPEN"} />
                      <button className={buttonClass.small}>{j.status === "OPEN" ? "Mark closed" : "Reopen"}</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No openings observed. Treat this company as a speculative networking target.</Empty>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">Add an opening you found</summary>
          <ActionForm action={addJobAction} submitLabel="Add opening" resetOnSuccess className="mt-3 grid gap-3 md:grid-cols-5">
            <input type="hidden" name="companyId" value={company.id} />
            <Field label="Title" htmlFor="j-t"><input id="j-t" name="title" required className={inputClass} /></Field>
            <Field label="Department" htmlFor="j-d"><input id="j-d" name="department" className={inputClass} /></Field>
            <Field label="Location" htmlFor="j-l"><input id="j-l" name="location" className={inputClass} /></Field>
            <Field label="Posting URL (source)" htmlFor="j-u"><input id="j-u" name="url" className={inputClass} /></Field>
            <Field label="Posted on" htmlFor="j-p"><input id="j-p" name="postedAt" type="date" className={inputClass} /></Field>
          </ActionForm>
        </details>
      </Card>

      <Card title="Company research" description="Only CONFIRMED items (with a source) can be referenced in emails. Write short factual statements; do not infer performance or motives.">
        {company.researchItems.length ? (
          <ul className="divide-y divide-slate-100">
            {company.researchItems.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{r.kind.replace(/_/g, " ").toLowerCase()}</Badge>
                    {r.confirmed ? <Badge tone="green">Confirmed – usable in emails</Badge> : <Badge tone="amber">Not confirmed</Badge>}
                    {r.profileId ? <Badge tone="indigo">this profile only</Badge> : <Badge>shared</Badge>}
                    <OriginBadge origin={r.origin} />
                  </div>
                  <p className="mt-1 text-slate-900">{r.statement}</p>
                  {r.quote && r.quote !== r.statement ? <blockquote className="mt-1 border-l-2 border-slate-200 pl-2 text-xs text-slate-600">“{r.quote}”</blockquote> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {r.sourceUrl ? <ExternalLink href={r.sourceUrl}>{hostOf(r.sourceUrl)}</ExternalLink> : "no source"} · published {fmtDate(r.publishedAt)} · retrieved {fmtDate(r.retrievedAt)}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <form action={toggleResearchAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="confirmed" value={r.confirmed ? "false" : "true"} />
                    <button className={buttonClass.small}>{r.confirmed ? "Unconfirm" : "Confirm"}</button>
                  </form>
                  <form action={deleteResearchAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <ConfirmButton title="Delete research item?" description={r.statement} confirmLabel="Delete">Delete</ConfirmButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No research recorded. Without confirmed research, drafts stay neutral.</Empty>
        )}
        <details className="mt-3" open>
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">Add research</summary>
          <ActionForm action={addResearchAction} submitLabel="Save research" resetOnSuccess className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="companyId" value={company.id} />
            <Field label="Type" htmlFor="r-k"><select id="r-k" name="kind" className={inputClass}>{RESEARCH_KINDS.filter((k) => k !== "RECIPIENT_BACKGROUND").map((k) => <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>)}</select></Field>
            <Field label="Source URL" htmlFor="r-u"><input id="r-u" name="sourceUrl" className={inputClass} placeholder="https://…" /></Field>
            <Field label="Statement (used in emails)" htmlFor="r-s" className="md:col-span-2" hint='Phrase it to complete “I have been reading about …”, e.g. “the launch of its millet snack range in 2026”'>
              <input id="r-s" name="statement" required className={inputClass} />
            </Field>
            <Field label="Exact quote from the source (optional)" htmlFor="r-q" className="md:col-span-2"><textarea id="r-q" name="quote" rows={2} className={inputClass} /></Field>
            <Field label="Source publication date" htmlFor="r-p"><input id="r-p" name="publishedAt" type="date" className={inputClass} /></Field>
            <div className="flex flex-col justify-end gap-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="confirmed" /> I checked the source; allow use in emails</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="shared" defaultChecked /> Share with the other profile</label>
            </div>
          </ActionForm>
        </details>
        {suggestions.length ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-indigo-700">Possible research statements from retrieved official pages ({suggestions.length})</summary>
            <p className="mt-2 text-xs text-slate-500">Sentences containing growth or strategy signals. Read the source before turning one into a confirmed statement.</p>
            <ul className="mt-2 space-y-2 text-sm">
              {suggestions.map((s) => (
                <li key={s.documentId + s.sentence.slice(0, 20)} className="rounded border border-slate-200 p-2">
                  “{s.sentence}” <span className="text-xs text-slate-500">— <ExternalLink href={s.sourceUrl}>{hostOf(s.sourceUrl)}</ExternalLink>, retrieved {fmtDate(s.retrievedAt)}{s.publishedAt ? `, published ${fmtDate(s.publishedAt)}` : ", publication date unknown"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Contacts at ${company.name}`} className="lg:col-span-2" actions={<Link href={`/discover/contacts?companyId=${company.id}`} className={buttonClass.small}>Find more</Link>}>
          {company.contacts.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {company.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/contacts/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.fullName}</Link> <span className="text-slate-600">· {c.title ?? "title unknown"}</span></span>
                  <span className="flex items-center gap-1.5"><ScorePill score={c.relevanceScore} /><EmailStatusBadge status={c.emailStatus} origin={c.emailOrigin} /><OriginBadge origin={c.origin} /></span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No contacts yet for this profile.</Empty>
          )}
        </Card>
        <Card title="Company channels" description="Shared inboxes and company numbers – never attributed to an individual.">
          {company.channels.length ? (
            <ul className="space-y-1 text-sm">
              {company.channels.map((ch) => (
                <li key={ch.id}>
                  <span className="font-mono text-xs">{ch.value}</span> <span className="text-xs text-slate-500">· {ch.label} · seen {fmtDate(ch.observedAt)}{ch.sourceUrl ? <> · <ExternalLink href={ch.sourceUrl}>source</ExternalLink></> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">None recorded.</p>}
        </Card>
      </div>

      <Card title="Retrieved pages (evidence)" description="Original pages behind extracted values, with retrieval and publication dates.">
        {company.documents.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {company.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <ExternalLink href={d.finalUrl}>{d.title ?? d.finalUrl}</ExternalLink>
                <span className="text-xs text-slate-500">HTTP {d.httpStatus} · retrieved {fmtDateTime(d.retrievedAt)} · published {fmtDate(d.publishedAt)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No pages retrieved yet.</p>}
      </Card>

      <div className="flex flex-wrap gap-2">
        <form action={setCompanyStatusAction}>
          <input type="hidden" name="companyId" value={company.id} />
          <input type="hidden" name="status" value="REMOVE" />
          <ConfirmButton title="Remove from this profile's list?" description="The shared company record and contacts are kept." confirmLabel="Remove" className={buttonClass.secondary}>Remove from my list</ConfirmButton>
        </form>
        <ActionForm action={deleteCompanyAction} className="inline">
          <input type="hidden" name="companyId" value={company.id} />
          <ConfirmButton title="Delete company record?" description="Deletes the shared company record, its job openings and research. Contacts are kept but unlinked." confirmLabel="Delete" className={buttonClass.danger}>Delete company</ConfirmButton>
        </ActionForm>
      </div>
    </div>
  );
}
