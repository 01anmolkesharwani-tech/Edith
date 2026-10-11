import Link from "next/link";
import { draftFollowUpAction, followUpStateAction, logReplyAction } from "@/app/actions/outreach";
import { ActionForm } from "@/components/client/ActionForm";
import { Badge, buttonClass, Empty, fmtDate, PageHeader, Table, Td, Th } from "@/components/ui";
import { getActiveProfile } from "@/lib/session";
import { listFollowUps } from "@/lib/services/followups";

export default async function FollowUpsPage() {
  const profile = await getActiveProfile();
  const items = await listFollowUps(profile.id);
  const now = new Date();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow-ups"
        description={`Follow-ups are scheduled ${profile.followUpAfterDays} days after a sent email (max ${profile.maxFollowUps} per contact). They are never sent automatically: draft one, review it, then send. Replies, bounces, declines and Do Not Contact suppress them.`}
      />
      {items.length === 0 ? (
        <Empty>No follow-ups scheduled.</Empty>
      ) : (
        <Table>
          <thead><tr><Th>Contact</Th><Th>Previous email</Th><Th>Due</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((f) => {
              const due = f.status === "SCHEDULED" && f.dueDate <= now;
              return (
                <tr key={f.id}>
                  <Td><Link href={`/contacts/${f.contact.id}`} className="font-medium text-indigo-700 hover:underline">{f.contact.fullName}</Link><div className="text-xs text-slate-500">{f.contact.company?.name}</div></Td>
                  <Td className="text-xs">{f.previousSend ? <>“{f.previousSend.subject}”<div className="text-slate-500">sent {fmtDate(f.previousSend.attemptedAt)} · {f.previousSend.attachmentFilename ?? "no attachment"}</div></> : "—"}</Td>
                  <Td className="text-xs">{fmtDate(f.dueDate)} {due ? <Badge tone="amber">due</Badge> : null}</Td>
                  <Td>
                    <Badge tone={f.status === "SCHEDULED" ? "blue" : f.status === "DRAFTED" ? "indigo" : f.status === "SENT" ? "green" : "gray"}>{f.status.toLowerCase()}</Badge>
                    {f.suppressedReason ? <div className="mt-1 text-xs text-slate-500">{f.suppressedReason}</div> : null}
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1.5">
                      {f.status === "DRAFTED" && f.draft ? <Link href={`/drafts/${f.draft.id}`} className={buttonClass.small}>Review follow-up</Link> : null}
                      {f.status === "SCHEDULED" ? (
                        <form action={draftFollowUpAction}><input type="hidden" name="id" value={f.id} /><button className={buttonClass.small}>Draft follow-up (no send)</button></form>
                      ) : null}
                      {f.status === "SCHEDULED" || f.status === "SUPPRESSED" || f.status === "SKIPPED" ? (
                        <ActionForm action={followUpStateAction} submitLabel="Reschedule" submitClassName={buttonClass.small} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="op" value="reschedule" />
                          <input type="date" name="dueDate" aria-label="New due date" required defaultValue={f.dueDate.toISOString().slice(0, 10)} className="rounded border border-slate-300 px-1 py-0.5 text-xs" />
                        </ActionForm>
                      ) : null}
                      {f.status === "SCHEDULED" || f.status === "DRAFTED" ? (
                        <ActionForm action={followUpStateAction} submitLabel="Skip" submitClassName={buttonClass.small} className="inline">
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="op" value="skip" />
                        </ActionForm>
                      ) : null}
                      {f.previousSend && !f.previousSend.repliedAt ? (
                        <ActionForm action={logReplyAction} submitLabel="Mark replied" submitClassName={buttonClass.small} className="inline">
                          <input type="hidden" name="sendLogId" value={f.previousSend.id} />
                          <input type="hidden" name="kind" value="reply" />
                        </ActionForm>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
