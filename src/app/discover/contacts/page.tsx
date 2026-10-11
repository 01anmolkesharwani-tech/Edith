import Link from "next/link";
import { researchPageAction, researchWebsiteAction, webSearchAction } from "@/app/actions/companies";
import { createContactAction } from "@/app/actions/contacts";
import { ContactFields } from "@/components/ContactForm";
import { ActionForm } from "@/components/client/ActionForm";
import { WebSearch } from "@/components/client/WebSearch";
import { buttonClass, Card, Empty, ExternalLink, Field, fmtDateTime, inputClass, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { braveConfigured } from "@/lib/providers/brave";
import { buildContactQueries, linkedInPeopleSearch, searchLinks } from "@/lib/providers/search-links";
import { getActiveProfile } from "@/lib/session";
import { profileLists } from "@/lib/services/profiles";

export default async function DiscoverContactsPage({ searchParams }: PageProps<"/discover/contacts">) {
  const profile = await getActiveProfile();
  const sp = await searchParams;
  const lists = profileLists(profile);
  const links = await db.profileCompany.findMany({
    where: { profileId: profile.id, status: { not: "EXCLUDED" } },
    include: { company: true },
    orderBy: { company: { name: "asc" } },
  });
  const companies = links.map((l) => l.company);
  const companyId = typeof sp.companyId === "string" ? sp.companyId : companies[0]?.id;
  const company = companies.find((c) => c.id === companyId) ?? null;
  const history = await db.searchHistory.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: "desc" }, take: 8 });
  const queries = company ? buildContactQueries({ company: company.name, domain: company.domain, titles: lists.targetContactTitles, location: lists.preferredLocations[0] }) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover contacts"
        description="Automated discovery uses official websites, public job boards and (optionally) a web search API. Everything found automatically is marked “Automated” and needs your review. When automation finds nothing, use the queries and manual entry below."
      />
      {companies.length === 0 ? (
        <Empty>Add target companies first. <Link className="text-indigo-700 underline" href="/discover/companies">Discover companies</Link></Empty>
      ) : (
        <form className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <Field label="Company" htmlFor="companyId">
            <select id="companyId" name="companyId" defaultValue={company?.id} className={inputClass}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <button className={buttonClass.secondary}>Select</button>
          {company ? <Link href={`/companies/${company.id}`} className="pb-2 text-sm text-indigo-700 underline">Open company research</Link> : null}
        </form>
      )}

      {company ? (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="1. Official website (automated)" description={`Last researched: ${fmtDateTime(company.lastResearchedAt)}`}>
              {company.website ? (
                <ActionForm action={researchWebsiteAction} submitLabel={`Research ${company.domain}`} pendingLabel="Researching…">
                  <input type="hidden" name="companyId" value={company.id} />
                  <Field label="Extra official page URLs (optional)" htmlFor="xu" hint="space-separated"><input id="xu" name="extraUrls" className={inputClass} /></Field>
                </ActionForm>
              ) : (
                <Notice>No official website recorded. <Link className="underline" href={`/companies/${company.id}`}>Add it</Link>.</Notice>
              )}
            </Card>
            <Card title="2. A specific public page" description="Paste a public page you found (press release, official bio, public directory). The app checks robots.txt, refuses private addresses and sites that prohibit automated collection (e.g. LinkedIn).">
              <ActionForm action={researchPageAction} submitLabel="Retrieve & extract" pendingLabel="Retrieving…" className="grid gap-3 md:grid-cols-[2fr_1fr]">
                <input type="hidden" name="companyId" value={company.id} />
                <Field label="Page URL" htmlFor="pu"><input id="pu" name="url" required className={inputClass} placeholder="https://…" /></Field>
                <Field label="Source type" htmlFor="pst">
                  <select id="pst" name="sourceType" className={inputClass}>
                    <option value="OFFICIAL_TEAM_PAGE">Official team page</option>
                    <option value="OFFICIAL_BIO">Official biography</option>
                    <option value="OFFICIAL_ANNOUNCEMENT">Official announcement</option>
                    <option value="NEWS_ARTICLE">News article</option>
                    <option value="PUBLIC_DIRECTORY">Public directory</option>
                  </select>
                </Field>
              </ActionForm>
            </Card>
          </div>

          <Card title="3. Web search API (optional)" description="Brave Search API, only if you configured BRAVE_SEARCH_API_KEY (requires a Brave account with a payment method; limited free monthly credit).">
            {braveConfigured() ? (
              <WebSearch search={webSearchAction as never} researchPage={researchPageAction} companyId={company.id} defaultQuery={queries[0] ?? company.name} />
            ) : (
              <p className="text-sm text-slate-500">Not configured. This is optional – use the manual searches below.</p>
            )}
          </Card>

          <Card title="4. Manual research (always available)" description="Editable queries and links you open in your own browser. A search link is not a contact record – add what you verify with its source.">
            <ul className="space-y-2 text-sm">
              {queries.map((q) => (
                <li key={q} className="flex flex-wrap items-center gap-2">
                  <input aria-label="Editable query" defaultValue={q} className="min-w-[18rem] flex-1 rounded border border-slate-200 px-2 py-1 font-mono text-xs" />
                  {searchLinks(q).map((l) => <ExternalLink key={l.engine} href={l.url} className="text-xs">{l.label}</ExternalLink>)}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {lists.targetContactTitles.slice(0, 5).map((t) => {
                const l = linkedInPeopleSearch(company.name, t);
                return <ExternalLink key={t} href={l.url} className="text-xs">LinkedIn: {t}</ExternalLink>;
              })}
              {company.website ? <ExternalLink href={company.website} className="text-xs">Official website</ExternalLink> : null}
              {company.careersUrl ? <ExternalLink href={company.careersUrl} className="text-xs">Careers page</ExternalLink> : null}
            </div>
            <p className="mt-2 text-xs text-slate-500">LinkedIn links open in your browser session; CareerReach never fetches LinkedIn pages.</p>
          </Card>

          <Card title="5. Add a contact manually" description="Manual entries are labelled MANUAL. Imported or manual emails are never marked verified automatically.">
            <ActionForm action={createContactAction} submitLabel="Add contact" footer={<label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="allowDuplicate" /> Create even if a possible duplicate exists</label>}>
              <ContactFields companies={companies} companyId={company.id} />
            </ActionForm>
          </Card>
        </>
      ) : null}

      <Card title="Recent searches" description="Includes failures, so you can see when a source was unavailable or rate-limited.">
        {history.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span><span className="font-medium">{h.provider}</span> · {h.query}</span>
                <span className={`text-xs ${h.status === "OK" ? "text-slate-500" : "text-red-700"}`}>{h.status.toLowerCase()} · {h.resultCount} result(s){h.errorMessage ? ` · ${h.errorMessage}` : ""} · {fmtDateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No searches yet.</p>}
      </Card>
    </div>
  );
}
