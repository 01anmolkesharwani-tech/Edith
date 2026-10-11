import { previewImportAction, runImportAction } from "@/app/actions/settings";
import { CsvImport } from "@/components/client/CsvImport";
import { buttonClass, Card, PageHeader } from "@/components/ui";
import { getActiveProfile } from "@/lib/session";
import { EXPORT_FIELDS } from "@/lib/services/csv-import";

export default async function ImportExportPage() {
  const profile = await getActiveProfile();
  return (
    <div className="space-y-6">
      <PageHeader title="Import and export" description={`Imports go into the ${profile.portalName} portal. Rows tagged with the other profile's id in a “Candidate profile” column are skipped, never mixed.`} />
      <Card title="Import contacts from CSV" description="Supported columns: candidate profile, contact name, job title, company, website, professional profile URL, professional email, business phone, location, source URL, notes.">
        <CsvImport preview={previewImportAction as never} runImport={runImportAction as never} />
      </Card>
      <Card title="Export contacts" description="Values starting with =, +, -, @ are prefixed with ' so spreadsheets do not execute them as formulas.">
        <form action="/api/export/contacts" method="get" className="space-y-3">
          <fieldset className="grid gap-1 text-sm md:grid-cols-4">
            <legend className="mb-1 text-xs font-semibold text-slate-700">Fields</legend>
            {Object.entries(EXPORT_FIELDS).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" name="field" value={k} defaultChecked={["fullName", "title", "company", "email", "emailStatus", "stage", "relevanceScore", "sources"].includes(k)} /> {l}</label>
            ))}
          </fieldset>
          <button className={buttonClass.primary}>Download CSV</button>
        </form>
      </Card>
      <Card title="Full data export">
        <a className={buttonClass.secondary} href="/api/export/profile">Download all {profile.portalName} data (JSON)</a>
      </Card>
    </div>
  );
}
