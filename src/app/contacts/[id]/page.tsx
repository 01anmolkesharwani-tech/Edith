import Link from "next/link";
import { notFound } from "next/navigation";
import { addResearchAction } from "@/app/actions/companies";
import {
  addEvidenceAction,
  applyGuessAction,
  changeStageStateAction,
  confirmRoleAction,
  deleteContactAction,
  deleteEvidenceAction,
  emailGuessesAction,
  mergeContactsAction,
  recheckSourceAction,
  runChecksAction,
  setReviewAction,
  updateContactAction,
} from "@/app/actions/contacts";
import { createDraftAction, logReplyAction } from "@/app/actions/outreach";
import { EmailStatusBadge, FreshnessBadge, OriginBadge, ReviewBadge, ScorePill, SourceTypeLabel, StageBadge } from "@/components/badges";
import { ContactFields, SOURCE_TYPES } from "@/components/ContactForm";
import { ActionForm } from "@/components/client/ActionForm";
import { ConfirmButton } from "@/components/client/ConfirmButton";
import { EmailGuesses } from "@/components/client/EmailGuesses";
import { Badge, buttonClass, Card, ExternalLink, Field, fmtDate, fmtDateTime, hostOf, inputClass, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import type { ContactFreshness } from "@/lib/domain/freshness";
import type { ScoreResult } from "@/lib/domain/scoring";
import { STAGE_LABELS, STAGES } from "@/lib/domain/stages";
import { EMAIL_STATUS_INFO, type EmailStatusValue } from "@/lib/email/validation";
import { parseList, parseObject } from "@/lib/json";
import { hunterConfigured } from "@/lib/providers/hunter";
import { getActiveProfile } from "@/lib/session";
import { findContactDuplicates, getContactDetail } from "@/lib/services/contacts";
import { NotFoundError } from "@/lib/services/errors";
import { getSettings } from "@/lib/services/settings";
import { suppressionFor } from "@/lib/services/suppression";

const FIELD_LABELS: Record<string, string> = {
  NAME: "Name",
  TITLE: "Title",
  COMPANY: "Company",
  DEPARTMENT: "Department",
  LOCATION: "Location",
  EMAIL: "Email",
  PHONE: "Phone",
  PROFILE_URL: "Profile URL",
  BIO_URL: "Biography URL",
};

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const profile = await getActiveProfile();
  let c;
  try {
    c = await getContactDetail(profile.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [companies, dups, settings, suppression] = await Promise.all([
    db.company.findMany({ where: { OR: [{ profileLinks: { some: { profileId: profile.id } } }, { id: c.companyId ?? "" }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    findContactDuplicates(profile.id, { id: c.id, fullName: c.fullName, companyId: c.companyId, email: c.email, profileUrl: c.profileUrl }),
    getSettings(),
    suppressionFor(profile.id, c.email, c.id),
  ]);
  const dupContacts = dups.length ? await db.contact.findMany({ where: { id: { in: dups.map((d) => d.id) } }, include: { company: true } }) : [];
  const breakdown = parseObject<Partial<ScoreResult> & { emailReasons?: string[]; freshness?: ContactFreshness }>(c.relevanceBreakdown, {});
  const reasons = parseList(c.reviewReasons);
  const fresh = breakdown.freshness;
  const statusInfo = EMAIL_STATUS_INFO[c.emailStatus as EmailStatusValue];
  const evidenceByField = Object.entries(
    c.evidence.reduce<Record<string, typeof c.evidence>>((acc, e) => {
      (acc[e.field] ??= []).push(e);
      return acc;
    }, {}),
  );
  const canDraft = !!c.email && c.stage !== "DO_NOT_CONTACT" && !suppression;
  const openJobs = c.company?.jobs ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{c.title ?? <em>title unknown</em>}{c.company ? <> at <Link className="text-indigo-700 hover:underline" href={`/companies/${c.company.id}`}>{c.company.name}</Link></> : null}</span>
            <ScorePill score={c.relevanceScore} />
            <StageBadge stage={c.stage} />
            <OriginBadge origin={c.origin} />
            <ReviewBadge state={c.reviewState} />
            {fresh ? <FreshnessBadge value={fresh.role} /> : null}
          </span>
        }
        actions={
          canDraft ? (
            <form action={createDraftAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="contactId" value={c.id} />
              {openJobs.length ? (
                <select name="opportunityId" aria-label="Related opening" className="rounded-md border border-slate-300 px-2 py-2 text-sm">
                  <option value="">General outreach (no specific opening)</option>
                  {openJobs.map((j) => <option key={j.id} value={j.id}>Opening: {j.title}</option>)}
                </select>
              ) : null}
              <button className={buttonClass.primary} title="Creates a draft for review – nothing is sent">Prepare email</button>
            </form>
          ) : (
            <span className="text-xs text-slate-500">{suppression ? "On the Do Not Contact list" : c.stage === "DO_NOT_CONTACT" ? "Do Not Contact" : "Add an email address to prepare an email"}</span>
          )
        }
      />

      {reasons.length ? (
        <Notice tone={c.reviewState === "NEEDS_REVIEW" ? "red" : "amber"}>
          <p className="font-medium">Review before outreach</p>
          <ul className="mt-1 list-disc pl-5">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Contact details" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Email</dt><dd className="flex flex-wrap items-center gap-2">{c.email ? <span className="font-mono">{c.email}</span> : "—"} <EmailStatusBadge status={c.emailStatus} origin={c.emailOrigin} /></dd></div>
            <div><dt className="text-xs text-slate-500">Phone</dt><dd>{c.phone ? <>{c.phone} <Badge>{(c.phoneType ?? "UNKNOWN").replace(/_/g, " ").toLowerCase()}</Badge></> : "— (a direct number is not required)"}</dd></div>
            <div><dt className="text-xs text-slate-500">Department</dt><dd>{c.department ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Seniority (from title)</dt><dd>{c.seniority?.toLowerCase() ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Location</dt><dd>{c.location ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Profile</dt><dd>{c.profileUrl ? <ExternalLink href={c.profileUrl}>{hostOf(c.profileUrl)}</ExternalLink> : "—"}{c.bioUrl ? <> · <ExternalLink href={c.bioUrl}>official bio</ExternalLink></> : null}</dd></div>
            <div><dt className="text-xs text-slate-500">Discovered</dt><dd>{fmtDateTime(c.discoveredAt)}</dd></div>
            <div><dt className="text-xs text-slate-500">Last observed</dt><dd>{fmtDateTime(c.lastObservedAt)}</dd></div>
            {c.notes ? <div className="md:col-span-2"><dt className="text-xs text-slate-500">Notes</dt><dd className="whitespace-pre-wrap">{c.notes}</dd></div> : null}
          </dl>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-indigo-700">Edit contact</summary>
            <ActionForm action={updateContactAction} submitLabel="Save changes" className="mt-3 space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <ContactFields
                companies={companies}
                defaults={{ fullName: c.fullName, title: c.title, companyId: c.companyId ?? "", department: c.department, location: c.location, email: c.email, phone: c.phone, phoneType: c.phoneType, profileUrl: c.profileUrl, bioUrl: c.bioUrl, notes: c.notes }}
              />
            </ActionForm>
          </details>
        </Card>

        <Card title="Pipeline & review">
          <ActionForm action={changeStageStateAction} submitLabel="Update stage" className="space-y-2">
            <input type="hidden" name="id" value={c.id} />
            <Field label="Stage" htmlFor="stage">
              <select id="stage" name="stage" defaultValue={c.stage} className={inputClass}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
            </Field>
            <Field label="Note (optional)" htmlFor="stage-note"><input id="stage-note" name="note" className={inputClass} /></Field>
          </ActionForm>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["CONFIRMED", "NEEDS_REVIEW"] as const).filter((s) => s !== c.reviewState).map((s) => (
              <form key={s} action={setReviewAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="state" value={s} />
                <button className={buttonClass.small}>{s === "CONFIRMED" ? "Mark reviewed" : "Flag for review"}</button>
              </form>
            ))}
          </div>
          {c.title ? (
            <ActionForm action={confirmRoleAction} submitLabel="I confirmed this role is current" submitClassName={buttonClass.small} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={c.id} />
              <input name="note" aria-label="How did you confirm it?" placeholder="How? e.g. checked official team page today" className={inputClass} />
            </ActionForm>
          ) : null}
        </Card>
      </div>

      <Card title="Field-level evidence" description="Each value is assessed independently. A source that supports the title does not verify the email.">
        {evidenceByField.length ? (
          <div className="space-y-4">
            {evidenceByField.map(([field, items]) => (
              <div key={field}>
                <h3 className="mb-1 text-sm font-semibold text-slate-800">{FIELD_LABELS[field] ?? field}</h3>
                <Table>
                  <thead><tr><Th>Observed value</Th><Th>Source</Th><Th>Method</Th><Th>Confidence</Th><Th>Observed</Th><Th>Published</Th><Th>Origin</Th><Th /></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((e) => (
                      <tr key={e.id}>
                        <Td>
                          <span className="font-medium">{e.value}</span>
                          {e.snippet ? <details className="mt-1"><summary className="cursor-pointer text-xs text-slate-500">snippet</summary><p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">“{e.snippet}”</p></details> : null}
                          {e.notes ? <p className="text-xs text-slate-500">{e.notes}</p> : null}
                        </Td>
                        <Td>{e.sourceUrl ? <ExternalLink href={e.sourceUrl} className="text-xs">{hostOf(e.sourceUrl)}</ExternalLink> : <span className="text-xs text-slate-400">no URL</span>}<div><SourceTypeLabel type={e.sourceType} /></div></Td>
                        <Td className="text-xs">{e.verificationMethod.replace(/_/g, " ").toLowerCase()}</Td>
                        <Td><Badge tone={e.confidence === "HIGH" ? "green" : e.confidence === "MEDIUM" ? "blue" : "gray"}>{e.confidence.toLowerCase()}</Badge></Td>
                        <Td className="text-xs">{fmtDate(e.observedAt)}</Td>
                        <Td className="text-xs">{fmtDate(e.publishedAt)}</Td>
                        <Td><OriginBadge origin={e.origin} /></Td>
                        <Td>
                          <form action={deleteEvidenceAction}>
                            <input type="hidden" name="evidenceId" value={e.id} />
                            <ConfirmButton title="Delete this evidence?" description="Derived status, freshness and score will be recalculated." confirmLabel="Delete">Delete</ConfirmButton>
                          </form>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">No evidence recorded.</p>}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">Add evidence</summary>
          <ActionForm action={addEvidenceAction} submitLabel="Add evidence" resetOnSuccess className="mt-3 grid gap-3 md:grid-cols-3">
            <input type="hidden" name="id" value={c.id} />
            <Field label="Field" htmlFor="ev-f"><select id="ev-f" name="field" className={inputClass}>{Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Observed value" htmlFor="ev-v"><input id="ev-v" name="value" required className={inputClass} /></Field>
            <Field label="Source type" htmlFor="ev-t"><select id="ev-t" name="sourceType" className={inputClass}>{SOURCE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Source URL" htmlFor="ev-u"><input id="ev-u" name="sourceUrl" className={inputClass} /></Field>
            <Field label="Source published on" htmlFor="ev-p"><input id="ev-p" name="publishedAt" type="date" className={inputClass} /></Field>
            <Field label="Exact text from the source" htmlFor="ev-s"><input id="ev-s" name="snippet" className={inputClass} /></Field>
            <Field label="Notes" htmlFor="ev-n" className="md:col-span-3"><input id="ev-n" name="notes" className={inputClass} /></Field>
          </ActionForm>
        </details>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Email verification" description={statusInfo?.meaning}>
          {c.email ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-mono">{c.email}</span><EmailStatusBadge status={c.emailStatus} origin={c.emailOrigin} /><span className="text-xs text-slate-500">last checked {fmtDateTime(c.emailCheckedAt)}</span></div>
              {breakdown.emailReasons?.length ? <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">{breakdown.emailReasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
              <ActionForm action={runChecksAction} submitLabel="Run checks" pendingLabel="Checking…" className="mt-3 space-y-2">
                <input type="hidden" name="id" value={c.id} />
                <p className="text-xs text-slate-500">Syntax → domain → MX → exact public-source match. No test email is ever sent.</p>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="provider" disabled={!hunterConfigured()} /> Use verification provider (Hunter){hunterConfigured() ? " – uses 1 credit" : " – not configured"}</label>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="smtp" disabled={!settings.smtpDiagnosticsEnabled} /> SMTP diagnostic{settings.smtpDiagnosticsEnabled ? " (stops before DATA; not proof)" : " – disabled in Settings"}</label>
              </ActionForm>
              <ActionForm action={recheckSourceAction} submitLabel="Check page for this exact address" pendingLabel="Retrieving…" submitClassName={buttonClass.small} className="mt-4 space-y-2">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Public page that should list the address" htmlFor="rc-url"><input id="rc-url" name="url" required defaultValue={c.evidence.find((e) => e.field === "EMAIL" && e.sourceUrl)?.sourceUrl ?? c.bioUrl ?? ""} className={inputClass} /></Field>
              </ActionForm>
              {c.verifications.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-indigo-700">Check history ({c.verifications.length})</summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {c.verifications.map((v) => (
                      <li key={v.id}><span className="font-mono">{v.email}</span> · {v.stage.replace(/_/g, " ").toLowerCase()} · <strong>{v.result.toLowerCase()}</strong> · {v.details} · {v.provider ? `${v.provider} · ` : ""}{fmtDateTime(v.checkedAt)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-500">No email on record. Add one with its source, or look at pattern-based guesses (always labelled uncertain).</p>
          )}
          {c.company?.domain ? <div className="mt-4"><EmailGuesses contactId={c.id} load={emailGuessesAction as never} apply={applyGuessAction} /></div> : null}
        </Card>

        <Card title="Relevance score" description="Explainable: each component lists its reasons. Missing data receives neutral partial credit.">
          {breakdown.components ? (
            <ul className="space-y-3">
              {breakdown.components.map((comp) => (
                <li key={comp.key}>
                  <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-800">{comp.label}</span><span className="font-mono">{comp.points}/{comp.max}</span></div>
                  <div className="mt-1 h-1.5 w-full rounded bg-slate-100"><div className="h-1.5 rounded bg-indigo-500" style={{ width: `${(comp.points / comp.max) * 100}%` }} /></div>
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{comp.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </li>
              ))}
              <li className="flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold"><span>Total</span><span>{breakdown.total}/100</span></li>
            </ul>
          ) : <p className="text-sm text-slate-500">Not scored yet.</p>}
          {fresh ? (
            <div className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
              <p className="mb-1 font-semibold">Freshness (heuristic, not a guarantee)</p>
              <p>Role confirmed: {fmtDate(fresh.dates.roleConfirmedAt)} · <FreshnessBadge value={fresh.role} /></p>
              <p className="mt-1">Email last observed: {fmtDate(fresh.dates.emailLastObservedAt)} · <FreshnessBadge value={fresh.email} /></p>
              <p className="mt-1">Phone last observed: {fmtDate(fresh.dates.phoneLastObservedAt)} · <FreshnessBadge value={fresh.phone} /></p>
              <p className="mt-1">Email last validated: {fmtDate(fresh.dates.emailValidatedAt)} · <FreshnessBadge value={fresh.emailValidation} /></p>
              <p className="mt-1">Pages last retrieved: {fmtDate(fresh.dates.lastRetrievedAt)}</p>
            </div>
          ) : null}
        </Card>
      </div>

      {c.company ? (
        <Card title="Recipient background" description="Confirmed, sourced facts about this person's professional work can be referenced in emails. Do not infer personal motivations.">
          {c.researchItems.length ? (
            <ul className="mb-3 space-y-1 text-sm">
              {c.researchItems.map((r) => (
                <li key={r.id}>{r.confirmed ? <Badge tone="green">confirmed</Badge> : <Badge tone="amber">unconfirmed</Badge>} {r.statement} {r.sourceUrl ? <ExternalLink className="text-xs" href={r.sourceUrl}>source</ExternalLink> : null}</li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={addResearchAction} submitLabel="Add background" resetOnSuccess className="grid gap-3 md:grid-cols-[2fr_2fr_auto] md:items-end">
            <input type="hidden" name="companyId" value={c.company.id} />
            <input type="hidden" name="contactId" value={c.id} />
            <input type="hidden" name="kind" value="RECIPIENT_BACKGROUND" />
            <Field label='Statement (completes “your work on …”)' htmlFor="rb-s"><input id="rb-s" name="statement" required className={inputClass} placeholder="the brand relaunch of …" /></Field>
            <Field label="Source URL" htmlFor="rb-u"><input id="rb-u" name="sourceUrl" className={inputClass} /></Field>
            <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" name="confirmed" /> Confirmed</label>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Outreach">
        {c.drafts.length === 0 && c.sendLogs.length === 0 ? <p className="text-sm text-slate-500">No outreach yet.</p> : null}
        {c.drafts.length ? (
          <ul className="mb-4 space-y-1 text-sm">
            {c.drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={d.sendState === "SENT" ? "green" : d.sendState === "FAILED" || d.sendState === "UNKNOWN" ? "red" : "gray"}>{d.sendState.toLowerCase()}</Badge>
                <Link href={`/drafts/${d.id}`} className="text-indigo-700 hover:underline">{d.subject}</Link>
                <span className="text-xs text-slate-500">{d.kind === "FOLLOW_UP" ? "follow-up · " : ""}updated {fmtDateTime(d.updatedAt)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {c.sendLogs.length ? (
          <Table>
            <thead><tr><Th>Sent</Th><Th>Subject / attachment</Th><Th>Provider result</Th><Th>Reply / bounce</Th><Th>Record manually</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {c.sendLogs.map((l) => (
                <tr key={l.id}>
                  <Td className="text-xs">{fmtDateTime(l.attemptedAt)}<div>{l.fromAddress} → {l.toAddress}</div></Td>
                  <Td className="text-xs">{l.subject}<div className="text-slate-500">{l.attachmentFilename ?? "no attachment"}</div></Td>
                  <Td className="text-xs"><Badge tone={l.status === "ACCEPTED" ? "green" : l.status === "UNKNOWN" ? "amber" : "red"}>{l.status === "ACCEPTED" ? "accepted by server" : l.status.toLowerCase()}</Badge><div className="mt-1 font-mono text-[10px] text-slate-400">{l.providerMessageId}</div>{l.errorMessage ? <div className="text-red-700">{l.errorMessage}</div> : null}</Td>
                  <Td className="text-xs">
                    {l.repliedAt ? <div><Badge tone="green">replied</Badge> {fmtDate(l.repliedAt)} ({l.replySource === "INBOX" ? "observed in inbox" : "recorded manually"})</div> : <div className="text-slate-400">no reply recorded</div>}
                    {l.bouncedAt ? <div><Badge tone="red">bounced</Badge> {l.bounceSource === "INBOX" ? "observed in inbox" : "recorded manually"}</div> : null}
                    <div className="mt-1 text-slate-400">Opens are not tracked.</div>
                  </Td>
                  <Td>
                    {l.status === "ACCEPTED" ? (
                      <ActionForm action={logReplyAction} submitLabel="Record" submitClassName={buttonClass.small} className="space-y-1">
                        <input type="hidden" name="sendLogId" value={l.id} />
                        <select name="kind" aria-label="Kind" className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs"><option value="reply">Reply received</option><option value="bounce">Bounce received</option></select>
                        <input name="note" aria-label="Note" placeholder="note" className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs" />
                      </ActionForm>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
        {c.followUps.length ? (
          <p className="mt-3 text-xs text-slate-600">Follow-ups: {c.followUps.map((f) => `#${f.sequence} ${f.status.toLowerCase()} (due ${fmtDate(f.dueDate)})${f.suppressedReason ? ` – ${f.suppressedReason}` : ""}`).join(" · ")} · <Link href="/followups" className="text-indigo-700 underline">open queue</Link></p>
        ) : null}
      </Card>

      {dupContacts.length ? (
        <Card title="Possible duplicates" description="Merging moves all evidence, drafts, sent-email logs and activity into this contact; the other record is kept as a merged tombstone.">
          <ul className="space-y-2 text-sm">
            {dupContacts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span><Link className="text-indigo-700 hover:underline" href={`/contacts/${d.id}`}>{d.fullName}</Link> · {d.title ?? "—"} · {d.company?.name ?? "—"} · {d.email ?? "no email"} <Badge>{dups.find((x) => x.id === d.id)?.reason.replace(/_/g, " ").toLowerCase()}</Badge></span>
                <ActionForm action={mergeContactsAction} className="inline">
                  <input type="hidden" name="primaryId" value={c.id} />
                  <input type="hidden" name="secondaryId" value={d.id} />
                  <ConfirmButton title="Merge contacts?" description={`"${d.fullName}" will be merged into "${c.fullName}". History is preserved.`} confirmLabel="Merge" tone="primary" className={buttonClass.small}>Merge into this</ConfirmButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Activity history">
        <ol className="space-y-1.5 text-sm">
          {c.activities.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2">
              <span>{a.summary}</span>
              <span className="text-xs text-slate-500"><Badge tone={a.source === "PROVIDER" ? "green" : a.source === "INBOX" ? "blue" : a.source === "MANUAL" ? "gray" : "indigo"}>{a.source.toLowerCase()}</Badge> {fmtDateTime(a.occurredAt)}</span>
            </li>
          ))}
        </ol>
      </Card>

      <ActionForm action={deleteContactAction} className="inline">
        <input type="hidden" name="id" value={c.id} />
        <ConfirmButton title="Delete contact?" description="Deletes the contact with its evidence, drafts and outreach history for this profile. Consider “Do Not Contact” instead if you want to prevent future emails." confirmLabel="Delete" className={buttonClass.danger}>Delete contact</ConfirmButton>
      </ActionForm>
    </div>
  );
}
