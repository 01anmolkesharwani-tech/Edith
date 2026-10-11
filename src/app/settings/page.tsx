import { createProfileAction, updateProfileAction } from "@/app/actions/profile";
import { addSuppressionAction, removeSuppressionAction } from "@/app/actions/outreach";
import {
  activateAccountAction,
  backupAction,
  deleteAccountAction,
  deleteProfileDataAction,
  retentionAction,
  saveAccountAction,
  saveAppSettingsAction,
  testAccountAction,
} from "@/app/actions/settings";
import { ActionForm } from "@/components/client/ActionForm";
import { ConfirmButton } from "@/components/client/ConfirmButton";
import { Badge, buttonClass, Card, ExternalLink, Field, fmtDate, fmtDateTime, inputClass, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { providerCatalogue } from "@/lib/providers/registry";
import { accountReadiness, listAccounts, PROVIDER_PRESETS } from "@/lib/sending/accounts";
import { getActiveProfile } from "@/lib/session";
import { listBackups } from "@/lib/services/data";
import { profileLists } from "@/lib/services/profiles";
import { getSettings } from "@/lib/services/settings";
import { listSuppressions } from "@/lib/services/suppression";

export default async function SettingsPage() {
  const profile = await getActiveProfile();
  const lists = profileLists(profile);
  const [accounts, suppressions, settings, backups] = await Promise.all([listAccounts(profile.id), listSuppressions(profile.id), getSettings(), listBackups()]);
  const catalogue = providerCatalogue(settings);
  const envVarSuggestion = `CAREERREACH_SMTP_PASS_${profile.slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const editing = accounts.find((a) => a.isActive) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={`Profile-specific settings apply to the ${profile.portalName} portal only. App-wide settings are marked as such.`} />

      <Card id="profile" title="Candidate profile" description="Use only facts from the candidate's own résumé. These values are used in drafts.">
        <ActionForm action={updateProfileAction} submitLabel="Save profile" className="grid gap-4 md:grid-cols-2">
          <Field label="Portal name" htmlFor="portalName"><input id="portalName" name="portalName" defaultValue={profile.portalName} required className={inputClass} /></Field>
          <Field label="Candidate name (as on the résumé)" htmlFor="candidateName"><input id="candidateName" name="candidateName" defaultValue={profile.candidateName ?? ""} className={inputClass} /></Field>
          <Field label="Current status (verified)" htmlFor="currentStatus" hint='Completes “I am [name], …”, e.g. “an MBA candidate at …”'>
            <input id="currentStatus" name="currentStatus" defaultValue={profile.currentStatus ?? ""} className={inputClass} />
          </Field>
          <Field label="Education (verified)" htmlFor="education"><input id="education" name="education" defaultValue={profile.education ?? ""} className={inputClass} /></Field>
          <Field label="Career objective" htmlFor="careerObjective" className="md:col-span-2"><textarea id="careerObjective" name="careerObjective" rows={2} defaultValue={profile.careerObjective ?? ""} className={inputClass} /></Field>
          <Field label="Email signature lines" htmlFor="signature" hint="Contact details added under the candidate name (phone, LinkedIn URL…)"><textarea id="signature" name="signature" rows={2} defaultValue={profile.signature ?? ""} className={inputClass} /></Field>
          <Field label="Skills (comma-separated)" htmlFor="skills"><textarea id="skills" name="skills" rows={2} defaultValue={lists.skills.join(", ")} className={inputClass} /></Field>
          <Field label="Target roles" htmlFor="targetRoles"><textarea id="targetRoles" name="targetRoles" rows={2} defaultValue={lists.targetRoles.join(", ")} className={inputClass} /></Field>
          <Field label="Target industries" htmlFor="targetIndustries"><textarea id="targetIndustries" name="targetIndustries" rows={2} defaultValue={lists.targetIndustries.join(", ")} className={inputClass} /></Field>
          <Field label="Target functions (scoring keywords)" htmlFor="targetFunctions"><textarea id="targetFunctions" name="targetFunctions" rows={2} defaultValue={lists.targetFunctions.join(", ")} className={inputClass} /></Field>
          <Field label="Target contact titles" htmlFor="targetContactTitles"><textarea id="targetContactTitles" name="targetContactTitles" rows={2} defaultValue={lists.targetContactTitles.join(", ")} className={inputClass} /></Field>
          <Field label="Preferred locations" htmlFor="preferredLocations"><textarea id="preferredLocations" name="preferredLocations" rows={2} defaultValue={lists.preferredLocations.join(", ")} className={inputClass} /></Field>
          <div className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-4">
            <Field label="Daily send limit" htmlFor="dailySendLimit" hint="Conservative default: 15"><input id="dailySendLimit" name="dailySendLimit" type="number" min={1} max={100} defaultValue={profile.dailySendLimit} className={inputClass} /></Field>
            <Field label="Follow up after (days)" htmlFor="followUpAfterDays"><input id="followUpAfterDays" name="followUpAfterDays" type="number" min={2} max={60} defaultValue={profile.followUpAfterDays} className={inputClass} /></Field>
            <Field label="Max follow-ups per contact" htmlFor="maxFollowUps"><input id="maxFollowUps" name="maxFollowUps" type="number" min={0} max={3} defaultValue={profile.maxFollowUps} className={inputClass} /></Field>
            <Field label="Cooldown after failed send (min)" htmlFor="failedSendCooldownMinutes"><input id="failedSendCooldownMinutes" name="failedSendCooldownMinutes" type="number" min={1} max={1440} defaultValue={profile.failedSendCooldownMinutes} className={inputClass} /></Field>
          </div>
        </ActionForm>
      </Card>

      <Card id="sender" title="Sender account" description="Each profile sends only from its own account. Passwords are never stored in the database – only the NAME of a server environment variable.">
        <div className="space-y-4">
          {accounts.length ? (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {accounts.map((a) => {
                const r = accountReadiness(a);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{a.fromName}</strong> &lt;{a.fromAddress}&gt;
                        {a.isActive ? <Badge tone="indigo">Active</Badge> : null}
                        {r.ready ? <Badge tone="green">Ready to send</Badge> : <Badge tone="amber" title={r.reason ?? ""}>Draft-only</Badge>}
                        {a.imapEnabled ? <Badge tone="blue">Reply tracking on</Badge> : null}
                      </div>
                      <div className="text-xs text-slate-500">
                        {a.smtpHost}:{a.smtpPort} · user {a.smtpUser} · secret from env <code>{a.secretEnvVar}</code>
                        {a.lastTestAt ? ` · last test ${fmtDateTime(a.lastTestAt)}: ${a.lastTestResult}` : ""}
                      </div>
                      {!r.ready ? <div className="mt-1 text-xs text-amber-700">{r.reason}</div> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ActionForm action={testAccountAction} className="inline">
                        <input type="hidden" name="id" value={a.id} />
                        <button className={buttonClass.small}>Test connection (sends nothing)</button>
                      </ActionForm>
                      {!a.isActive ? (
                        <form action={activateAccountAction}><input type="hidden" name="id" value={a.id} /><button className={buttonClass.small}>Make active</button></form>
                      ) : null}
                      <form action={deleteAccountAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <ConfirmButton title="Disconnect this account?" description="The configuration is removed from CareerReach. Also revoke the app password in your email provider's security settings." confirmLabel="Disconnect">Disconnect</ConfirmButton>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Notice tone="blue">No sender configured: CareerReach works in draft-only mode. You can still prepare, review and copy every email.</Notice>
          )}

          <div className="rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{editing ? "Edit active account" : "Add a sender account"}</h3>
            <div className="mt-3 grid gap-3 text-xs text-slate-600 md:grid-cols-3">
              {Object.entries(PROVIDER_PRESETS).map(([k, p]) => (
                <div key={k} className="rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="font-semibold text-slate-800">{p.label}</div>
                  {p.smtpHost ? <div>SMTP {p.smtpHost}:{p.smtpPort} ({p.smtpSecure ? "TLS" : "STARTTLS"}) · IMAP {p.imapHost}:{p.imapPort}</div> : null}
                  <div className="mt-1">{p.notes}</div>
                </div>
              ))}
            </div>
            <ActionForm action={saveAccountAction} submitLabel="Save account" className="mt-4 grid gap-3 md:grid-cols-3">
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <Field label="Label" htmlFor="a-label"><input id="a-label" name="label" defaultValue={editing?.label ?? "Primary"} className={inputClass} /></Field>
              <Field label="From name" htmlFor="a-fromName"><input id="a-fromName" name="fromName" defaultValue={editing?.fromName ?? profile.candidateName ?? ""} required className={inputClass} /></Field>
              <Field label="From address" htmlFor="a-from"><input id="a-from" name="fromAddress" type="email" defaultValue={editing?.fromAddress ?? ""} required className={inputClass} /></Field>
              <Field label="SMTP host" htmlFor="a-host"><input id="a-host" name="smtpHost" defaultValue={editing?.smtpHost ?? "smtp.gmail.com"} required className={inputClass} /></Field>
              <Field label="SMTP port" htmlFor="a-port"><input id="a-port" name="smtpPort" type="number" defaultValue={editing?.smtpPort ?? 465} required className={inputClass} /></Field>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="smtpSecure" defaultChecked={editing?.smtpSecure ?? true} /> Implicit TLS (port 465)</label>
              <Field label="SMTP username" htmlFor="a-user"><input id="a-user" name="smtpUser" defaultValue={editing?.smtpUser ?? ""} required className={inputClass} /></Field>
              <Field label="Env variable holding the app password" htmlFor="a-env" hint={<>Put <code>{envVarSuggestion}=…</code> in <code>.env</code> and restart. Never your normal password.</>}>
                <input id="a-env" name="secretEnvVar" defaultValue={editing?.secretEnvVar ?? envVarSuggestion} required className={inputClass} />
              </Field>
              <Field label="Provider daily limit (informational)" htmlFor="a-limit"><input id="a-limit" name="providerDailyLimit" type="number" defaultValue={editing?.providerDailyLimit ?? ""} className={inputClass} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="imapEnabled" defaultChecked={editing?.imapEnabled ?? false} /> Enable read-only reply tracking (IMAP)</label>
              <Field label="IMAP host" htmlFor="a-imap"><input id="a-imap" name="imapHost" defaultValue={editing?.imapHost ?? "imap.gmail.com"} className={inputClass} /></Field>
              <Field label="IMAP port" htmlFor="a-imapport"><input id="a-imapport" name="imapPort" type="number" defaultValue={editing?.imapPort ?? 993} className={inputClass} /></Field>
            </ActionForm>
          </div>
        </div>
      </Card>

      <Card id="suppression" title="Do Not Contact list" description="Suppressed addresses or domains can never be emailed. Global entries apply to both profiles.">
        <ActionForm action={addSuppressionAction} submitLabel="Add" resetOnSuccess className="mb-4 grid gap-3 md:grid-cols-[2fr_2fr_auto_auto] md:items-end">
          <Field label="Email or domain" htmlFor="s-val"><input id="s-val" name="value" required className={inputClass} placeholder="name@company.com or company.com" /></Field>
          <Field label="Reason" htmlFor="s-reason"><input id="s-reason" name="reason" className={inputClass} /></Field>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="global" /> Both profiles</label>
        </ActionForm>
        {suppressions.length ? (
          <Table>
            <thead><tr><Th>Address / domain</Th><Th>Scope</Th><Th>Reason</Th><Th>Added</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {suppressions.map((s) => (
                <tr key={s.id}>
                  <Td>{s.email ?? `*@${s.domain}`}</Td>
                  <Td>{s.profileId ? "This profile" : "Both profiles"}</Td>
                  <Td>{s.reason}</Td>
                  <Td>{fmtDate(s.createdAt)}</Td>
                  <Td><form action={removeSuppressionAction}><input type="hidden" name="id" value={s.id} /><ConfirmButton title="Remove from Do Not Contact?" description="This address could be emailed again." confirmLabel="Remove">Remove</ConfirmButton></form></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="text-sm text-slate-500">The list is empty.</p>}
      </Card>

      <Card id="integrations" title="Integrations and data sources" description="What each source allows, as reviewed on the date shown. Missing optional keys never break core features.">
        <Table>
          <thead><tr><Th>Source</Th><Th>Status</Th><Th>Account / key / card</Th><Th>Automated access</Th><Th>Quota</Th><Th>Docs</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {catalogue.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium text-slate-900">{p.name}</Td>
                <Td>{p.available ? <Badge tone="green">Available</Badge> : <Badge tone="gray" title={p.unavailableReason}>{p.unavailableReason ?? "Unavailable"}</Badge>}</Td>
                <Td className="text-xs">
                  {p.requiresAccount ? "Account" : "No account"} · {p.requiresApiKey ? "API key" : "no key"} · {p.requiresPaymentMethod === true ? "payment method required" : p.requiresPaymentMethod === "unknown" ? "card: check plan" : "no card"}
                </Td>
                <Td className="text-xs">{p.automatedAccess}</Td>
                <Td className="text-xs">{p.quota}</Td>
                <Td className="text-xs"><ExternalLink href={p.docsUrl}>Docs</ExternalLink><div className="text-slate-400">reviewed {p.docsCheckedOn}</div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Discovery settings (app-wide)" description="Applies to both profiles.">
        <ActionForm action={saveAppSettingsAction} submitLabel="Save settings" className="grid gap-3 md:grid-cols-3">
          <Field label="Contact for the crawler User-Agent" htmlFor="ua" hint="Email or URL so site operators can reach you (Wikimedia asks for this)." className="md:col-span-3">
            <input id="ua" name="userAgentContact" defaultValue={settings.userAgentContact ?? ""} className={inputClass} />
          </Field>
          <Field label="Delay between requests to a site (ms)" htmlFor="delay"><input id="delay" name="requestDelayMs" type="number" defaultValue={settings.requestDelayMs} className={inputClass} /></Field>
          <Field label="Max pages per website" htmlFor="maxp"><input id="maxp" name="maxPagesPerSite" type="number" defaultValue={settings.maxPagesPerSite} className={inputClass} /></Field>
          <Field label="Request timeout (ms)" htmlFor="to"><input id="to" name="fetchTimeoutMs" type="number" defaultValue={settings.fetchTimeoutMs} className={inputClass} /></Field>
          <Field label="Max response size (bytes)" htmlFor="mb"><input id="mb" name="maxResponseBytes" type="number" defaultValue={settings.maxResponseBytes} className={inputClass} /></Field>
          <Field label="Keep search history (days)" htmlFor="rh"><input id="rh" name="searchHistoryRetentionDays" type="number" defaultValue={settings.searchHistoryRetentionDays} className={inputClass} /></Field>
          <Field label="Keep unreferenced pages (days)" htmlFor="rd"><input id="rd" name="sourceDocumentRetentionDays" type="number" defaultValue={settings.sourceDocumentRetentionDays} className={inputClass} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="websiteResearchEnabled" defaultChecked={settings.websiteResearchEnabled} /> Official website research</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="jobBoardsEnabled" defaultChecked={settings.jobBoardsEnabled} /> Public job-board APIs</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="wikidataEnabled" defaultChecked={settings.wikidataEnabled} /> Wikidata company discovery</label>
          <label className="flex items-center gap-2 text-sm md:col-span-3"><input type="checkbox" name="smtpDiagnosticsEnabled" defaultChecked={settings.smtpDiagnosticsEnabled} /> Allow optional SMTP recipient diagnostics (no email is sent; results are never treated as verification; may be blocked or considered unwelcome by some servers)</label>
        </ActionForm>
      </Card>

      <Card id="data" title="Data management">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <h3 className="font-semibold text-slate-900">Export & backup</h3>
            <p><a className={buttonClass.secondary} href="/api/export/profile">Download this profile&apos;s data (JSON)</a></p>
            <ActionForm action={backupAction} submitLabel="Create database backup" submitClassName={buttonClass.secondary}>
              <p className="text-xs text-slate-500">Writes a consistent SQLite copy to <code>data/backups/</code>. Restore with <code>npm run db:restore -- &lt;file&gt;</code> while the app is stopped.</p>
            </ActionForm>
            {backups.length ? (
              <ul className="text-xs text-slate-600">
                {backups.slice(0, 5).map((b) => <li key={b.name}>{b.name} · {(b.size / 1024).toFixed(0)} KB</li>)}
              </ul>
            ) : null}
            <ActionForm action={retentionAction} submitLabel="Apply retention now" submitClassName={buttonClass.secondary}>
              <p className="text-xs text-slate-500">Deletes search history and unreferenced retrieved pages older than the limits above.</p>
            </ActionForm>
          </div>
          <div className="space-y-3 text-sm">
            <h3 className="font-semibold text-red-800">Delete this profile&apos;s data</h3>
            <p className="text-xs text-slate-600">Removes all contacts, evidence, drafts, sent-email logs, follow-ups, résumés (files included), templates and sender accounts of <strong>{profile.portalName}</strong>. The other profile and shared company records are not affected.</p>
            <ActionForm action={deleteProfileDataAction} submitLabel="Delete all data for this profile" submitClassName={buttonClass.danger}>
              <Field label='Type "DELETE" to confirm' htmlFor="confirm-del"><input id="confirm-del" name="confirm" className={inputClass} autoComplete="off" /></Field>
            </ActionForm>
          </div>
        </div>
      </Card>

      <Card title="Add another portal" description="The app is not limited to two career paths.">
        <ActionForm action={createProfileAction} submitLabel="Create portal" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label="Portal name" htmlFor="np-name"><input id="np-name" name="portalName" required className={inputClass} placeholder="Consulting" /></Field>
          <Field label="Short id" htmlFor="np-slug"><input id="np-slug" name="slug" required className={inputClass} placeholder="consulting" /></Field>
        </ActionForm>
      </Card>
    </div>
  );
}
