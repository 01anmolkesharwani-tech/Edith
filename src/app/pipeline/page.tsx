import Link from "next/link";
import { changeStageAction } from "@/app/actions/contacts";
import { syncRepliesAction } from "@/app/actions/outreach";
import { ScorePill } from "@/components/badges";
import { ActionForm } from "@/components/client/ActionForm";
import { StageSelect } from "@/components/client/StageSelect";
import { buttonClass, fmtDate, fmtDateTime, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { STAGE_LABELS, STAGES } from "@/lib/domain/stages";
import { getActiveProfile } from "@/lib/session";

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const profile = await getActiveProfile();
  const sp = await searchParams;
  const only = typeof sp.stage === "string" && (STAGES as readonly string[]).includes(sp.stage) ? sp.stage : null;
  const [contacts, account] = await Promise.all([
    db.contact.findMany({
      where: { profileId: profile.id, mergedIntoId: null, ...(only ? { stage: only as never } : {}) },
      include: { company: { select: { name: true } }, sendLogs: { orderBy: { attemptedAt: "desc" }, take: 1 } },
      orderBy: [{ relevanceScore: "desc" }],
    }),
    db.emailAccount.findFirst({ where: { profileId: profile.id, isActive: true } }),
  ]);
  const columns = (only ? [only] : STAGES).map((s) => ({ stage: s, items: contacts.filter((c) => c.stage === s) }));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Outreach pipeline"
        description="Every contact in this profile by stage. Moving a contact to Do Not Contact suppresses future emails; Replied, Rejected and similar stages stop follow-ups."
        actions={
          account?.imapEnabled ? (
            <ActionForm action={syncRepliesAction} submitLabel="Check inbox for replies (read-only)" pendingLabel="Checking inbox…" submitClassName={buttonClass.secondary} className="flex flex-col items-end">
              <span className="text-xs text-slate-500">Last checked {fmtDateTime(account.lastReplySyncAt)}</span>
            </ActionForm>
          ) : (
            <Link href="/settings#sender" className="text-xs text-slate-500 underline">Enable read-only inbox reply tracking</Link>
          )
        }
      />
      {only ? <Link href="/pipeline" className="text-sm text-indigo-700 underline">Show all stages</Link> : null}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => (
          <section key={col.stage} aria-label={STAGE_LABELS[col.stage as keyof typeof STAGE_LABELS]} className="w-64 shrink-0 rounded-lg border border-slate-200 bg-slate-50">
            <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <Link href={`/pipeline?stage=${col.stage}`} className="text-sm font-semibold text-slate-800 hover:underline">{STAGE_LABELS[col.stage as keyof typeof STAGE_LABELS]}</Link>
              <span className="rounded-full bg-white px-2 text-xs text-slate-600 ring-1 ring-slate-200">{col.items.length}</span>
            </header>
            <ul className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
              {col.items.map((c) => (
                <li key={c.id} className="rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm">
                  <div className="flex items-start justify-between gap-1">
                    <Link href={`/contacts/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.fullName}</Link>
                    <ScorePill score={c.relevanceScore} />
                  </div>
                  <div className="text-xs text-slate-600">{c.title ?? "—"}{c.company ? ` · ${c.company.name}` : ""}</div>
                  {c.sendLogs[0] ? <div className="mt-1 text-xs text-slate-500">Last email {fmtDate(c.sendLogs[0].attemptedAt)}{c.sendLogs[0].repliedAt ? " · replied" : ""}{c.sendLogs[0].bouncedAt ? " · bounced" : ""}</div> : null}
                  <div className="mt-2"><StageSelect contactId={c.id} stage={c.stage} action={changeStageAction} /></div>
                </li>
              ))}
              {!col.items.length ? <li className="px-1 py-2 text-xs text-slate-400">Empty</li> : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
