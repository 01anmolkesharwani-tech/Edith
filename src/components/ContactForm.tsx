import { Field, inputClass } from "./ui";

const SOURCE_TYPES: [string, string][] = [
  ["USER_PROVIDED", "My own knowledge / record"],
  ["OFFICIAL_TEAM_PAGE", "Official team / leadership page"],
  ["OFFICIAL_BIO", "Official biography"],
  ["OFFICIAL_ANNOUNCEMENT", "Official announcement / press release"],
  ["CAREERS_PAGE", "Careers page"],
  ["JOB_POSTING", "Job posting"],
  ["PROFESSIONAL_PROFILE", "Public professional profile"],
  ["NEWS_ARTICLE", "News article"],
  ["PUBLIC_DIRECTORY", "Public business directory"],
  ["OTHER", "Other"],
];

export function ContactFields({
  companies,
  defaults = {},
  companyId,
  showEvidence = true,
}: {
  companies: { id: string; name: string }[];
  defaults?: Partial<Record<string, string | null>>;
  companyId?: string;
  showEvidence?: boolean;
}) {
  const v = (k: string) => defaults[k] ?? "";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Full name *" htmlFor="cf-name"><input id="cf-name" name="fullName" required defaultValue={v("fullName")} className={inputClass} /></Field>
      <Field label="Current title" htmlFor="cf-title"><input id="cf-title" name="title" defaultValue={v("title")} className={inputClass} /></Field>
      <Field label="Company" htmlFor="cf-company">
        <select id="cf-company" name="companyId" defaultValue={companyId ?? v("companyId")} className={inputClass}>
          <option value="">— none —</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Department" htmlFor="cf-dept"><input id="cf-dept" name="department" defaultValue={v("department")} className={inputClass} /></Field>
      <Field label="Location" htmlFor="cf-loc"><input id="cf-loc" name="location" defaultValue={v("location")} className={inputClass} /></Field>
      <Field label="Professional email" htmlFor="cf-email" hint="Leave empty if unknown – missing data stays missing."><input id="cf-email" name="email" type="email" defaultValue={v("email")} className={inputClass} /></Field>
      <Field label="Business phone" htmlFor="cf-phone"><input id="cf-phone" name="phone" defaultValue={v("phone")} className={inputClass} /></Field>
      <Field label="Phone type" htmlFor="cf-ptype">
        <select id="cf-ptype" name="phoneType" defaultValue={v("phoneType") || "UNKNOWN"} className={inputClass}>
          <option value="UNKNOWN">Unknown</option>
          <option value="DIRECT_BUSINESS_LINE">Direct business line</option>
          <option value="OFFICE_LINE">Office line</option>
          <option value="COMPANY_SWITCHBOARD">Company switchboard</option>
          <option value="PUBLIC_PROFESSIONAL_MOBILE">Public professional mobile</option>
        </select>
      </Field>
      <Field label="Public professional profile URL" htmlFor="cf-purl"><input id="cf-purl" name="profileUrl" defaultValue={v("profileUrl")} className={inputClass} /></Field>
      <Field label="Official biography URL" htmlFor="cf-bio"><input id="cf-bio" name="bioUrl" defaultValue={v("bioUrl")} className={inputClass} /></Field>
      <Field label="Notes" htmlFor="cf-notes" className="md:col-span-2"><textarea id="cf-notes" name="notes" rows={2} defaultValue={v("notes")} className={inputClass} /></Field>
      {showEvidence ? (
        <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3 md:col-span-3 md:grid-cols-4">
          <legend className="px-1 text-xs font-semibold text-slate-700">Where did this information come from? (recorded as manual evidence)</legend>
          <Field label="Source URL" htmlFor="cf-src" className="md:col-span-2"><input id="cf-src" name="sourceUrl" className={inputClass} placeholder="https://…" /></Field>
          <Field label="Source type" htmlFor="cf-stype">
            <select id="cf-stype" name="sourceType" className={inputClass}>{SOURCE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Source published on" htmlFor="cf-pub"><input id="cf-pub" name="publishedAt" type="date" className={inputClass} /></Field>
          <Field label="Evidence notes" htmlFor="cf-evn" className="md:col-span-4"><input id="cf-evn" name="evidenceNotes" className={inputClass} /></Field>
        </fieldset>
      ) : null}
    </div>
  );
}

export { SOURCE_TYPES };
