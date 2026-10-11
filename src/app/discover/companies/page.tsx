import { createCompanyAction, discoverCompaniesAction, saveDiscoveredCompanyAction } from "@/app/actions/companies";
import { ActionForm } from "@/components/client/ActionForm";
import { CompanyDiscovery } from "@/components/client/CompanyDiscovery";
import { Card, ExternalLink, Field, inputClass, Notice, PageHeader } from "@/components/ui";
import { buildCompanyQueries, searchLinks } from "@/lib/providers/search-links";
import { getActiveProfile } from "@/lib/session";
import { profileLists } from "@/lib/services/profiles";
import { getSettings } from "@/lib/services/settings";

export default async function DiscoverCompaniesPage() {
  const profile = await getActiveProfile();
  const lists = profileLists(profile);
  const settings = await getSettings();
  const queries = lists.targetIndustries.slice(0, 4).flatMap((ind) =>
    buildCompanyQueries({ industry: ind, location: lists.preferredLocations[0], role: lists.targetRoles[0] }).slice(0, 2),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover companies"
        description="Find companies relevant to this profile from Wikidata (free, CC0), add them manually, or research with browser searches. Vacancies are never assumed: a company without an observed opening is a speculative networking target."
      />

      <Card title="Search Wikidata" description="Companies by industry (and country), or by name. Results show their source; nothing is saved until you add it.">
        {settings.wikidataEnabled ? (
          <CompanyDiscovery
            discover={discoverCompaniesAction as never}
            save={saveDiscoveredCompanyAction as never}
            defaults={{ industry: lists.targetIndustries[0] ?? "", country: lists.preferredLocations[0] ?? "" }}
          />
        ) : (
          <Notice>Wikidata discovery is disabled in Settings.</Notice>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Add a company manually">
          <ActionForm action={createCompanyAction} submitLabel="Add company" className="grid gap-3 md:grid-cols-2">
            <Field label="Company name" htmlFor="c-name"><input id="c-name" name="name" required className={inputClass} /></Field>
            <Field label="Official website" htmlFor="c-web"><input id="c-web" name="website" className={inputClass} placeholder="https://…" /></Field>
            <Field label="Industry" htmlFor="c-ind"><input id="c-ind" name="industry" className={inputClass} /></Field>
            <Field label="Headquarters" htmlFor="c-hq"><input id="c-hq" name="headquarters" className={inputClass} /></Field>
            <Field label="Careers page" htmlFor="c-car"><input id="c-car" name="careersUrl" className={inputClass} /></Field>
            <Field label="List status" htmlFor="c-status">
              <select id="c-status" name="status" className={inputClass}>
                <option value="TARGET">Target</option>
                <option value="WATCHING">Watching</option>
                <option value="EXCLUDED">Excluded (never contact)</option>
              </select>
            </Field>
            <Field label="Notes" htmlFor="c-notes" className="md:col-span-2"><textarea id="c-notes" name="notes" rows={2} className={inputClass} /></Field>
          </ActionForm>
        </Card>

        <Card title="Browser searches (manual)" description="Open these yourself. The app does not retrieve search-engine results; record anything you find with its source.">
          <ul className="space-y-2 text-sm">
            {queries.map((q) => (
              <li key={q} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{q}</code>
                {searchLinks(q).map((l) => <ExternalLink key={l.engine} href={l.url} className="text-xs">{l.label}</ExternalLink>)}
              </li>
            ))}
            {!queries.length ? <li className="text-slate-500">Add target industries in Settings to get suggested queries.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
