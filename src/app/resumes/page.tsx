import { addSuggestedHighlightAction, deleteResumeAction, renameResumeAction, setDefaultResumeAction, uploadResumeAction } from "@/app/actions/resumes";
import { deleteHighlightAction, saveHighlightAction, toggleHighlightAction } from "@/app/actions/profile";
import { ActionForm } from "@/components/client/ActionForm";
import { ConfirmButton } from "@/components/client/ConfirmButton";
import { Badge, buttonClass, Card, Empty, Field, fmtDateTime, inputClass, Notice, PageHeader } from "@/components/ui";
import { parseList } from "@/lib/json";
import { getActiveProfile } from "@/lib/session";
import { listHighlights } from "@/lib/services/profiles";
import { listResumes, suggestHighlightsFromText } from "@/lib/services/resumes";

const KINDS = ["EXPERIENCE", "PROJECT", "ACHIEVEMENT", "CERTIFICATION", "EDUCATION", "SKILL", "OTHER"];

function kb(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`;
}

export default async function ResumesPage({ searchParams }: PageProps<"/resumes">) {
  const profile = await getActiveProfile();
  const sp = await searchParams;
  const [resumes, highlights] = await Promise.all([listResumes(profile.id), listHighlights(profile.id)]);
  const suggestFrom = resumes.find((r) => r.id === sp.suggest) ?? null;
  const suggestions = suggestFrom?.extractedText ? suggestHighlightsFromText(suggestFrom.extractedText) : [];
  const existingTitles = new Set(highlights.map((h) => h.title.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Résumés"
        description={`Résumés and verified facts for the ${profile.portalName} portal only. Files are stored locally outside the web root and are never attached to the other candidate's emails.`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Upload a résumé" description="PDF only, up to 5 MB. The first upload becomes the default attachment.">
          <ActionForm action={uploadResumeAction} submitLabel="Upload" pendingLabel="Uploading…" resetOnSuccess>
            <Field label="PDF file" htmlFor="file">
              <input id="file" name="file" type="file" accept="application/pdf,.pdf" required className="block w-full text-sm" />
            </Field>
            <Field label="Version label" htmlFor="label" hint="e.g. General, Marketing, Finance, Valuation, Consulting">
              <input id="label" name="label" defaultValue="General" maxLength={40} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="makeDefault" /> Make this the default attachment
            </label>
          </ActionForm>
        </Card>

        <Card title="Versions" className="lg:col-span-2">
          {resumes.length === 0 ? (
            <Notice tone="red">No résumé uploaded. Sending is disabled for this profile until a résumé is uploaded.</Notice>
          ) : (
            <ul className="divide-y divide-slate-100">
              {resumes.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{r.originalFilename}</span>
                      <Badge tone="indigo">{r.label}</Badge>
                      {r.isDefault ? <Badge tone="green">Default attachment</Badge> : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {kb(r.sizeBytes)} · uploaded {fmtDateTime(r.uploadedAt)} · text {r.extractedText ? "extracted" : "not extractable"} · sha256 {r.sha256.slice(0, 12)}…
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a href={`/api/resumes/${r.id}`} target="_blank" rel="noopener" className={buttonClass.small}>Preview</a>
                    {!r.isDefault ? (
                      <form action={setDefaultResumeAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className={buttonClass.small}>Make default</button>
                      </form>
                    ) : null}
                    <form action={renameResumeAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <label className="sr-only" htmlFor={`label-${r.id}`}>Label</label>
                      <input id={`label-${r.id}`} name="label" defaultValue={r.label} maxLength={40} className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" />
                      <button className={buttonClass.small}>Rename</button>
                    </form>
                    {r.extractedText ? <a href={`/resumes?suggest=${r.id}#suggestions`} className={buttonClass.small}>Suggest highlights</a> : null}
                    <ActionForm action={deleteResumeAction} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <ConfirmButton title="Delete résumé?" description={`${r.originalFilename} will be removed from local storage. Drafts using it must be changed first.`} confirmLabel="Delete">Delete</ConfirmButton>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        id="highlights"
        title="Verified candidate facts (highlights)"
        description="Only CONFIRMED highlights are used when drafting emails. Never add achievements, numbers or experience that are not on the résumé."
      >
        {highlights.length === 0 ? <Empty>No highlights yet. Add them below or use “Suggest highlights” on a résumé.</Empty> : null}
        <ul className="divide-y divide-slate-100">
          {highlights.map((h) => (
            <li key={h.id} className="py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <Badge tone="gray">{h.kind.toLowerCase()}</Badge>
                  <span className="font-medium text-slate-900">{h.title}</span>
                  {h.organization ? <span className="text-sm text-slate-600">· {h.organization}</span> : null}
                  {h.confirmed ? <Badge tone="green">Confirmed – used in emails</Badge> : <Badge tone="amber">Not confirmed – not used</Badge>}
                  {h.source?.startsWith("resume:") ? <Badge tone="blue">from résumé text</Badge> : null}
                </summary>
                <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto]">
                  <ActionForm action={saveHighlightAction} submitLabel="Save changes" className="grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="id" value={h.id} />
                    <Field label="Type" htmlFor={`k-${h.id}`}>
                      <select id={`k-${h.id}`} name="kind" defaultValue={h.kind} className={inputClass}>
                        {KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
                      </select>
                    </Field>
                    <Field label="Title / role" htmlFor={`t-${h.id}`}><input id={`t-${h.id}`} name="title" defaultValue={h.title} className={inputClass} /></Field>
                    <Field label="Organisation" htmlFor={`o-${h.id}`}><input id={`o-${h.id}`} name="organization" defaultValue={h.organization ?? ""} className={inputClass} /></Field>
                    <Field label="Capabilities (comma-separated)" htmlFor={`c-${h.id}`}><input id={`c-${h.id}`} name="capabilities" defaultValue={parseList(h.capabilities).join(", ")} className={inputClass} /></Field>
                    <Field label="Verified summary / outcome" htmlFor={`s-${h.id}`} className="md:col-span-2"><textarea id={`s-${h.id}`} name="summary" defaultValue={h.summary ?? ""} rows={2} className={inputClass} /></Field>
                    <Field label="Tags (e.g. brand, valuation)" htmlFor={`g-${h.id}`}><input id={`g-${h.id}`} name="tags" defaultValue={parseList(h.tags).join(", ")} className={inputClass} /></Field>
                    <label className="flex items-center gap-2 self-end text-sm">
                      <input type="checkbox" name="confirmed" defaultChecked={h.confirmed} /> I confirm this matches the résumé
                    </label>
                  </ActionForm>
                  <div className="flex gap-2 md:flex-col">
                    <form action={toggleHighlightAction}>
                      <input type="hidden" name="id" value={h.id} />
                      <input type="hidden" name="confirmed" value={h.confirmed ? "false" : "true"} />
                      <button className={buttonClass.small}>{h.confirmed ? "Unconfirm" : "Confirm"}</button>
                    </form>
                    <form action={deleteHighlightAction}>
                      <input type="hidden" name="id" value={h.id} />
                      <ConfirmButton title="Delete highlight?" description={h.title} confirmLabel="Delete">Delete</ConfirmButton>
                    </form>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="mt-4 rounded-md border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">Add a highlight</summary>
          <ActionForm action={saveHighlightAction} submitLabel="Add highlight" resetOnSuccess className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Type" htmlFor="nk"><select id="nk" name="kind" className={inputClass}>{KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}</select></Field>
            <Field label="Title / role" htmlFor="nt"><input id="nt" name="title" required className={inputClass} placeholder="e.g. Marketing Intern" /></Field>
            <Field label="Organisation" htmlFor="no"><input id="no" name="organization" className={inputClass} /></Field>
            <Field label="Capabilities" htmlFor="nc"><input id="nc" name="capabilities" className={inputClass} placeholder="consumer research, campaign analysis" /></Field>
            <Field label="Verified summary / outcome" htmlFor="ns" className="md:col-span-2"><textarea id="ns" name="summary" rows={2} className={inputClass} placeholder="Only facts stated on the résumé" /></Field>
            <Field label="Tags" htmlFor="ng"><input id="ng" name="tags" className={inputClass} /></Field>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="confirmed" /> I confirm this matches the résumé</label>
          </ActionForm>
        </details>
      </Card>

      {suggestFrom ? (
        <Card id="suggestions" title={`Suggestions from ${suggestFrom.originalFilename}`} description="Lines detected in the résumé text. Adding one creates an UNCONFIRMED highlight that you must edit and confirm.">
          {suggestions.length === 0 ? (
            <Empty>No suggestions could be detected. Add highlights manually.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {suggestions.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span><Badge>{s.kind.toLowerCase()}</Badge> {s.title}</span>
                  {existingTitles.has(s.title.toLowerCase()) ? (
                    <span className="text-xs text-slate-500">already added</span>
                  ) : (
                    <form action={addSuggestedHighlightAction}>
                      <input type="hidden" name="resumeId" value={suggestFrom.id} />
                      <input type="hidden" name="kind" value={s.kind} />
                      <input type="hidden" name="title" value={s.title} />
                      <input type="hidden" name="summary" value={s.summary} />
                      <button className={buttonClass.small}>Add as unconfirmed</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-slate-600">Show extracted text</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700">{suggestFrom.extractedText}</pre>
          </details>
        </Card>
      ) : null}
    </div>
  );
}
