"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

interface ActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

interface ReadinessItem {
  code: string;
  level: "BLOCKER" | "CONFIRM" | "WARNING";
  message: string;
}

interface Readiness {
  canSend: boolean;
  items: ReadinessItem[];
  sentLast24h: number;
  dailyLimit: number;
  account: { fromAddress: string; fromName: string; label: string } | null;
}

interface SendResult {
  status: "ACCEPTED" | "REJECTED" | "FAILED" | "UNKNOWN" | "BLOCKED";
  message: string;
}

export interface ComposerProps {
  draft: {
    id: string;
    kind: string;
    subject: string;
    subjectAlternatives: string[];
    body: string;
    recipientEmail: string;
    recipientName: string | null;
    resumeId: string | null;
    opportunityId: string | null;
    templateId: string | null;
    contentHash: string;
    reviewedHash: string | null;
    sendState: string;
    lastError: string | null;
    guessAcknowledged: boolean;
    duplicateAcknowledged: boolean;
  };
  candidateName: string | null;
  portalName: string;
  contact: {
    id: string;
    fullName: string;
    title: string | null;
    company: string | null;
    email: string | null;
    emailStatusLabel: string;
    emailStatusMeaning: string;
    emailStatusTone: string;
    isGuess: boolean;
  };
  evidence: { field: string; value: string; sourceUrl: string | null; sourceType: string; observedAt: string; method: string }[];
  personalization: { used: { label: string; value: string; sourceUrl?: string | null }[]; gaps: string[]; blocking: string[] };
  resumes: { id: string; label: string; originalFilename: string; sizeBytes: number; isDefault: boolean }[];
  openings: { id: string; title: string }[];
  templates: { id: string; name: string; recipientType: string }[];
  initialReadiness: Readiness;
  actions: {
    save: (id: string, input: { subject: string; body: string; recipientEmail: string; resumeId: string | null; opportunityId: string | null }) => Promise<ActionResult<{ contentHash: string }>>;
    regenerate: (id: string, templateId?: string | null) => Promise<ActionResult<{ subject: string; body: string; subjectAlternatives: string; contentHash: string }>>;
    review: (id: string, hash: string) => Promise<ActionResult>;
    acknowledge: (id: string, ack: { guess?: boolean; duplicate?: boolean }) => Promise<ActionResult>;
    readiness: (id: string) => Promise<ActionResult<Readiness>>;
    send: (id: string, hash: string) => Promise<ActionResult<SendResult>>;
    resolveUnknown: (id: string, wasSent: boolean) => Promise<ActionResult>;
  };
}

const TONE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
};

function kb(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`;
}

export function Composer(props: ComposerProps) {
  const { draft, actions } = props;
  const router = useRouter();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [recipientEmail, setRecipientEmail] = useState(draft.recipientEmail);
  const [resumeId, setResumeId] = useState<string | null>(draft.resumeId);
  const [opportunityId, setOpportunityId] = useState<string | null>(draft.opportunityId);
  const [alternatives, setAlternatives] = useState(draft.subjectAlternatives);
  const [hash, setHash] = useState(draft.contentHash);
  const [templateId, setTemplateId] = useState(draft.templateId ?? "");
  const [readiness, setReadiness] = useState<Readiness>(props.initialReadiness);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ackGuess, setAckGuess] = useState(draft.guessAcknowledged);
  const [ackDuplicate, setAckDuplicate] = useState(draft.duplicateAcknowledged);
  const [ackChanged, setAckChanged] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [pending, startTransition] = useTransition();
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  const saved = { subject: draft.subject, body: draft.body, recipientEmail: draft.recipientEmail, resumeId: draft.resumeId, opportunityId: draft.opportunityId };
  const [savedState, setSavedState] = useState(saved);
  const dirty =
    subject !== savedState.subject || body !== savedState.body || recipientEmail !== savedState.recipientEmail || resumeId !== savedState.resumeId || opportunityId !== savedState.opportunityId;
  const editable = draft.sendState === "DRAFT" || draft.sendState === "FAILED";
  const resume = props.resumes.find((r) => r.id === resumeId) ?? null;
  const changedSinceReview = !!draft.reviewedHash && draft.reviewedHash !== hash;
  const recipientChanged = recipientEmail.trim().toLowerCase() !== (props.contact.email ?? "").toLowerCase();

  const confirmItems = useMemo(() => readiness.items.filter((i) => i.level === "CONFIRM" && i.code !== "NOT_REVIEWED"), [readiness]);
  const blockers = readiness.items.filter((i) => i.level === "BLOCKER");
  const warnings = readiness.items.filter((i) => i.level === "WARNING");
  const needsGuessAck = confirmItems.some((i) => i.code === "UNCERTAIN_EMAIL");
  const needsDupAck = confirmItems.some((i) => i.code === "DUPLICATE");
  const sendEnabled =
    editable &&
    !blockers.length &&
    (!needsGuessAck || ackGuess) &&
    (!needsDupAck || ackDuplicate) &&
    (!changedSinceReview || ackChanged) &&
    !sending &&
    !result;

  async function save(): Promise<string | null> {
    const r = await actions.save(draft.id, { subject, body, recipientEmail, resumeId, opportunityId });
    if (!r.ok || !r.data) {
      setMessage({ tone: "error", text: r.error ?? "Could not save." });
      return null;
    }
    setHash(r.data.contentHash);
    setSavedState({ subject, body, recipientEmail, resumeId, opportunityId });
    const rd = await actions.readiness(draft.id);
    if (rd.ok && rd.data) setReadiness(rd.data);
    return r.data.contentHash;
  }

  function onSave() {
    startTransition(async () => {
      if (await save()) setMessage({ tone: "ok", text: "Draft saved." });
    });
  }

  function onRegenerate() {
    if (dirty && !window.confirm("Regenerating replaces your unsaved edits to the subject and message. Continue?")) return;
    startTransition(async () => {
      const r = await actions.regenerate(draft.id, templateId || null);
      if (!r.ok || !r.data) return setMessage({ tone: "error", text: r.error ?? "Could not regenerate." });
      setSubject(r.data.subject);
      setBody(r.data.body);
      setAlternatives(JSON.parse(r.data.subjectAlternatives));
      setHash(r.data.contentHash);
      setSavedState((s) => ({ ...s, subject: r.data!.subject, body: r.data!.body }));
      setMessage({ tone: "ok", text: "Regenerated with alternative wording. Review it carefully." });
      router.refresh();
    });
  }

  function openPreview() {
    setMessage(null);
    startTransition(async () => {
      const h = dirty ? await save() : hash;
      if (!h) return;
      const rd = await actions.readiness(draft.id);
      if (rd.ok && rd.data) setReadiness(rd.data);
      setPreviewOpen(true);
    });
  }

  /** One click: records the review of exactly this content, then sends it. */
  async function onSend() {
    if (sendingRef.current) return; // repeated-click guard (server also enforces idempotency)
    sendingRef.current = true;
    setSending(true);
    try {
      if (needsGuessAck || needsDupAck) {
        const a = await actions.acknowledge(draft.id, { guess: needsGuessAck ? ackGuess : undefined, duplicate: needsDupAck ? ackDuplicate : undefined });
        if (!a.ok) throw new Error(a.error ?? "Could not record acknowledgement.");
      }
      const rv = await actions.review(draft.id, hash);
      if (!rv.ok) throw new Error(rv.error ?? "Could not record review.");
      const s = await actions.send(draft.id, hash);
      if (!s.ok || !s.data) throw new Error(s.error ?? "Send failed.");
      setResult(s.data);
      router.refresh();
    } catch (e) {
      setResult({ status: "FAILED", message: (e as Error).message });
      sendingRef.current = false; // only a definite client-side failure before sending re-enables
    } finally {
      setSending(false);
    }
  }

  const evidenceFor = (field: string) => props.evidence.filter((e) => e.field === field).slice(0, 3);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        {draft.sendState === "SENT" ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">This email was accepted by the mail server for delivery. It cannot be edited or sent again.</div> : null}
        {draft.sendState === "UNKNOWN" || readiness.items.some((i) => i.code === "OUTCOME_UNKNOWN") ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="font-medium">The outcome of the last send attempt is unknown.</p>
            <p className="mt-1">{draft.lastError}</p>
            <p className="mt-1">Check the Sent folder of {readiness.account?.fromAddress ?? "your mailbox"}. It will not be retried automatically.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="rounded bg-white px-2 py-1 text-xs font-medium ring-1 ring-red-300" onClick={() => startTransition(async () => { await actions.resolveUnknown(draft.id, true); router.refresh(); })}>It is in my Sent folder</button>
              <button type="button" className="rounded bg-white px-2 py-1 text-xs font-medium ring-1 ring-red-300" onClick={() => startTransition(async () => { await actions.resolveUnknown(draft.id, false); router.refresh(); })}>It was not sent</button>
            </div>
          </div>
        ) : null}
        {draft.sendState === "FAILED" && draft.lastError ? <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">Last attempt failed: {draft.lastError}</div> : null}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-700">To</label>
              <input id="to" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} disabled={!editable} className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-50" />
              {recipientChanged ? <p className="mt-1 text-xs text-amber-700">Differs from the contact record ({props.contact.email ?? "none"}); no verification history for this address.</p> : null}
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-700">From</span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{readiness.account ? `${readiness.account.fromName} <${readiness.account.fromAddress}>` : <span className="text-amber-700">No sender configured – draft-only mode</span>}</div>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="subject" className="mb-1 block text-xs font-medium text-slate-700">Subject</label>
            <input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable} maxLength={200} className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
            {editable && alternatives.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Subject alternatives">
                {alternatives.map((a) => (
                  <button key={a} type="button" onClick={() => setSubject(a)} className={`rounded-full px-2.5 py-1 text-xs ring-1 ${a === subject ? "bg-indigo-50 text-indigo-800 ring-indigo-300" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}>{a}</button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <label htmlFor="body" className="mb-1 block text-xs font-medium text-slate-700">Message</label>
            <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} rows={18} className="block w-full rounded-md border border-slate-300 px-3 py-2 font-[inherit] text-sm leading-relaxed disabled:bg-slate-50" />
            <p className="mt-1 text-xs text-slate-500">{body.trim().split(/\s+/).filter(Boolean).length} words · plain text · no tracking pixels</p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="attachment" className="mb-1 block text-xs font-medium text-slate-700">Attachment ({props.portalName} résumés only)</label>
              <select id="attachment" value={resumeId ?? ""} onChange={(e) => setResumeId(e.target.value || null)} disabled={!editable} className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">{draft.kind === "FOLLOW_UP" ? "No attachment" : "— choose a résumé —"}</option>
                {props.resumes.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.originalFilename}{r.isDefault ? " (default)" : ""}</option>)}
              </select>
              {resume ? (
                <p className="mt-1 text-xs text-slate-600">Will attach <strong>{resume.originalFilename}</strong> ({kb(resume.sizeBytes)}) · <a href={`/api/resumes/${resume.id}`} target="_blank" rel="noopener" className="text-indigo-700 underline">preview PDF</a></p>
              ) : props.resumes.length === 0 ? (
                <p className="mt-1 text-xs text-red-700">No résumé uploaded for this profile – sending is disabled. <Link href="/resumes" className="underline">Upload one</Link>.</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="opp" className="mb-1 block text-xs font-medium text-slate-700">Related opening</label>
              <select id="opp" value={opportunityId ?? ""} onChange={(e) => setOpportunityId(e.target.value || null)} disabled={!editable} className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">None – general / speculative outreach</option>
                {props.openings.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            </div>
          </div>

          {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-md px-3 py-2 text-sm ${message.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}

          {editable ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={openPreview} disabled={pending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">Review &amp; send…</button>
              <button type="button" onClick={onSave} disabled={pending || !dirty} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">{dirty ? "Save draft" : "Saved"}</button>
              <span className="flex items-center gap-1">
                <label htmlFor="tpl" className="sr-only">Template</label>
                <select id="tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
                  {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button type="button" onClick={onRegenerate} disabled={pending} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Regenerate draft</button>
              </span>
              <button type="button" onClick={() => navigator.clipboard?.writeText(`Subject: ${subject}\n\n${body}`).then(() => setMessage({ tone: "ok", text: "Copied subject and message to the clipboard." }))} className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Copy text</button>
              <Link href={`/contacts/${props.contact.id}`} className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Open evidence</Link>
            </div>
          ) : null}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-slate-900">Recipient</h2>
          <p className="mt-1"><Link href={`/contacts/${props.contact.id}`} className="font-medium text-indigo-700 hover:underline">{props.contact.fullName}</Link></p>
          <p className="text-slate-600">{props.contact.title ?? "title unknown"}{props.contact.company ? ` · ${props.contact.company}` : ""}</p>
          <p className="mt-2 flex flex-wrap items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[props.contact.emailStatusTone] ?? TONE.gray}`} title={props.contact.emailStatusMeaning}>{props.contact.emailStatusLabel}</span>
            {props.contact.isGuess ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE.amber}`}>Guessed address</span> : null}
          </p>
          <p className="mt-1 text-xs text-slate-500">{props.contact.emailStatusMeaning}</p>
          <h3 className="mt-3 text-xs font-semibold uppercase text-slate-500">Evidence</h3>
          <ul className="mt-1 space-y-1 text-xs">
            {["TITLE", "EMAIL", "COMPANY"].flatMap((f) =>
              evidenceFor(f).map((e, i) => (
                <li key={`${f}-${i}`}>
                  <strong>{f.toLowerCase()}:</strong> {e.value} — {e.sourceUrl ? <a className="text-indigo-700 underline" href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceType.replace(/_/g, " ").toLowerCase()}</a> : e.sourceType.replace(/_/g, " ").toLowerCase()} · {e.method.replace(/_/g, " ").toLowerCase()} · {e.observedAt.slice(0, 10)}
                </li>
              )),
            )}
            {!props.evidence.length ? <li className="text-slate-400">No evidence recorded.</li> : null}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-slate-900">Personalisation used</h2>
          {props.personalization.blocking.map((b) => <p key={b} className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">{b}</p>)}
          <ul className="mt-2 space-y-1 text-xs">
            {props.personalization.used.map((u) => (
              <li key={u.label}><strong>{u.label}:</strong> {u.value} {u.sourceUrl ? <a href={u.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">source</a> : null}</li>
            ))}
            {!props.personalization.used.length ? <li className="text-slate-500">Neutral draft – no verified personal details used.</li> : null}
          </ul>
          {props.personalization.gaps.length ? (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase text-slate-500">Missing information</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">{props.personalization.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </>
          ) : null}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-slate-900">Pre-send checks</h2>
          <p className="mt-1 text-xs text-slate-500">Sent in last 24h: {readiness.sentLast24h}/{readiness.dailyLimit}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {readiness.items.map((i) => (
              <li key={i.code} className={i.level === "BLOCKER" ? "text-red-800" : i.level === "CONFIRM" ? "text-amber-800" : "text-slate-600"}>
                <strong>{i.level === "BLOCKER" ? "Blocked" : i.level === "CONFIRM" ? "Needs confirmation" : "Note"}:</strong> {i.message}
              </li>
            ))}
            {!readiness.items.length ? <li className="text-emerald-700">All checks passed.</li> : null}
          </ul>
        </section>
      </aside>

      <Dialog.Root open={previewOpen} onOpenChange={(o) => { if (!sending) setPreviewOpen(o); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(96vw,46rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl focus:outline-none">
            <Dialog.Title className="text-lg font-semibold text-slate-900">Final preview</Dialog.Title>
            <Dialog.Description className="text-sm text-slate-600">This is exactly what will be sent. Nothing is sent until you click “Send email”.</Dialog.Description>

            <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <dt className="text-slate-500">From</dt><dd>{readiness.account ? `${readiness.account.fromName} <${readiness.account.fromAddress}>` : "— (draft-only mode)"}</dd>
              <dt className="text-slate-500">To</dt><dd className="font-mono">{draft.recipientName ? `${draft.recipientName} <${recipientEmail}>` : recipientEmail}</dd>
              <dt className="text-slate-500">Subject</dt><dd className="font-medium">{subject}</dd>
              <dt className="text-slate-500">Attachment</dt><dd>{resume ? `${resume.originalFilename} (${kb(resume.sizeBytes)}, ${resume.label})` : "none"}</dd>
              <dt className="text-slate-500">Candidate</dt><dd>{props.candidateName ?? "—"} · {props.portalName} portal</dd>
            </dl>
            <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 p-3 font-sans text-sm leading-relaxed text-slate-800">{body}</pre>

            {blockers.length ? (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                <p className="font-medium">Sending is blocked:</p>
                <ul className="mt-1 list-disc pl-5">{blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
              </div>
            ) : null}
            {warnings.length ? <ul className="mt-3 list-disc pl-5 text-xs text-slate-600">{warnings.map((w) => <li key={w.code}>{w.message}</li>)}</ul> : null}

            <div className="mt-3 space-y-2 text-sm">
              {changedSinceReview ? (
                <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-900"><input type="checkbox" checked={ackChanged} onChange={(e) => setAckChanged(e.target.checked)} className="mt-0.5" /> The recipient, attachment or message changed after my last review. I have reviewed the version above.</label>
              ) : null}
              {needsGuessAck ? (
                <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-900"><input type="checkbox" checked={ackGuess} onChange={(e) => setAckGuess(e.target.checked)} className="mt-0.5" /> {confirmItems.find((i) => i.code === "UNCERTAIN_EMAIL")?.message} I accept the risk of sending to it.</label>
              ) : null}
              {needsDupAck ? (
                <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-900"><input type="checkbox" checked={ackDuplicate} onChange={(e) => setAckDuplicate(e.target.checked)} className="mt-0.5" /> {confirmItems.find((i) => i.code === "DUPLICATE")?.message}</label>
              ) : null}
            </div>

            {result ? (
              <div role="status" className={`mt-4 rounded-md border p-3 text-sm ${result.status === "ACCEPTED" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : result.status === "UNKNOWN" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-300 bg-red-50 text-red-900"}`}>
                <p className="font-semibold">{result.status === "ACCEPTED" ? "Sent – accepted by the mail server" : result.status === "UNKNOWN" ? "Outcome unknown" : result.status === "BLOCKED" ? "Not sent" : "Send failed"}</p>
                <p className="mt-1">{result.message}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Dialog.Close disabled={sending} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">{result ? "Close" : "Cancel"}</Dialog.Close>
              {!result ? (
                <button type="button" onClick={onSend} disabled={!sendEnabled} aria-busy={sending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {sending ? "Sending…" : "Send email"}
                </button>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
