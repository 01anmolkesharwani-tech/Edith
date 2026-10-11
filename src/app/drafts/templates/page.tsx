import { deleteTemplateAction, saveTemplateAction } from "@/app/actions/outreach";
import { ActionForm } from "@/components/client/ActionForm";
import { ConfirmButton } from "@/components/client/ConfirmButton";
import { Badge, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { RECIPIENT_TYPE_LABELS } from "@/lib/domain/classify";
import { referencedVariables } from "@/lib/drafting/render";
import { getActiveProfile } from "@/lib/session";
import { listTemplates, templateSubjects } from "@/lib/services/templates";

const VARIABLES = [
  ["greeting", "Dear <name>, (formal for senior leaders; no guessed honorifics)"],
  ["candidate.name / candidate.status / candidate.signature / candidate.skills", "From the profile (verified)"],
  ["recipient.name / recipient.firstName / recipient.title / recipient.background", "Recipient; background only if confirmed with a source"],
  ["company.name / company.initiative", "Initiative only from confirmed, sourced research"],
  ["function.label / function.title", "Function matched between recipient and candidate targets"],
  ["experience.primary / experience.capabilities / experience.outcome", "Best confirmed highlight"],
  ["opportunity.title / opportunity.url", "Selected opening (if any)"],
  ["contribution", "Plausible contribution phrase for the recipient type"],
  ["phrases.reachingOut / phrases.interest / phrases.ctaRecruiter / phrases.ctaLeader / phrases.ctaAdvice / phrases.signoff", "Varied wording per recipient"],
  ["previous.subject / previous.date / attachResume", "Follow-ups only"],
];

export default async function TemplatesPage() {
  const profile = await getActiveProfile();
  const templates = await listTemplates(profile.id);
  const types = Object.keys(RECIPIENT_TYPE_LABELS);
  return (
    <div className="space-y-6">
      <PageHeader title="Email templates" description={`Templates for the ${profile.portalName} portal. {{variable}} inserts a verified value; {{#variable}}…{{/variable}} keeps text only when the value exists, so missing information never produces invented content.`} />
      <Card title="Available variables">
        <ul className="grid gap-1 text-xs md:grid-cols-2">{VARIABLES.map(([v, d]) => <li key={v}><code className="rounded bg-slate-100 px-1">{`{{${v}}}`}</code> – {d}</li>)}</ul>
      </Card>
      {templates.map((t) => (
        <Card key={t.id} title={t.name} description={RECIPIENT_TYPE_LABELS[t.recipientType as keyof typeof RECIPIENT_TYPE_LABELS] ?? t.recipientType} actions={t.isBuiltIn ? <Badge>built-in (editable copy)</Badge> : null}>
          <ActionForm action={saveTemplateAction} submitLabel="Save template" className="space-y-3">
            <input type="hidden" name="id" value={t.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name" htmlFor={`n-${t.id}`}><input id={`n-${t.id}`} name="name" defaultValue={t.name} className={inputClass} /></Field>
              <Field label="Recipient type" htmlFor={`r-${t.id}`}><select id={`r-${t.id}`} name="recipientType" defaultValue={t.recipientType} className={inputClass}>{types.map((k) => <option key={k} value={k}>{RECIPIENT_TYPE_LABELS[k as keyof typeof RECIPIENT_TYPE_LABELS]}</option>)}</select></Field>
            </div>
            <Field label="Subject lines (one per line)" htmlFor={`s-${t.id}`}><textarea id={`s-${t.id}`} name="subjectTemplates" rows={3} defaultValue={templateSubjects(t).join("\n")} className={`${inputClass} font-mono text-xs`} /></Field>
            <Field label="Body" htmlFor={`b-${t.id}`} hint={`Uses: ${referencedVariables(t.bodyTemplate).join(", ")}`}><textarea id={`b-${t.id}`} name="bodyTemplate" rows={12} defaultValue={t.bodyTemplate} className={`${inputClass} font-mono text-xs`} /></Field>
          </ActionForm>
          <form action={deleteTemplateAction} className="mt-2">
            <input type="hidden" name="id" value={t.id} />
            <ConfirmButton title="Delete template?" description="Built-in templates are re-created automatically if deleted." confirmLabel="Delete">Delete</ConfirmButton>
          </form>
        </Card>
      ))}
      <Card title="New template">
        <ActionForm action={saveTemplateAction} submitLabel="Create template" resetOnSuccess className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name" htmlFor="nn"><input id="nn" name="name" required className={inputClass} /></Field>
            <Field label="Recipient type" htmlFor="nr"><select id="nr" name="recipientType" className={inputClass}>{types.map((k) => <option key={k} value={k}>{RECIPIENT_TYPE_LABELS[k as keyof typeof RECIPIENT_TYPE_LABELS]}</option>)}</select></Field>
          </div>
          <Field label="Subject lines (one per line)" htmlFor="ns"><textarea id="ns" name="subjectTemplates" rows={2} required className={`${inputClass} font-mono text-xs`} /></Field>
          <Field label="Body" htmlFor="nb"><textarea id="nb" name="bodyTemplate" rows={8} required className={`${inputClass} font-mono text-xs`} defaultValue={"{{greeting}}\n\nI am {{candidate.name}}{{#candidate.status}}, {{candidate.status}}{{/candidate.status}}.\n\n…\n\n{{phrases.signoff}}\n{{candidate.name}}"} /></Field>
        </ActionForm>
      </Card>
    </div>
  );
}
