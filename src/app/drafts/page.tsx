import Link from "next/link";
import { EmailStatusBadge } from "@/components/badges";
import { Badge, buttonClass, Empty, fmtDateTime, PageHeader, Table, Td, Th } from "@/components/ui";
import { getActiveProfile } from "@/lib/session";
import { listDrafts } from "@/lib/services/drafts";

export default async function DraftsPage({ searchParams }: PageProps<"/drafts">) {
  const profile = await getActiveProfile();
  const sp = await searchParams;
  const show = sp.show === "all" ? "all" : sp.show === "sent" ? "sent" : "open";
  const drafts = await listDrafts(
    profile.id,
    show === "all" ? ["DRAFT", "SENDING", "SENT", "FAILED", "UNKNOWN", "CANCELLED"] : show === "sent" ? ["SENT"] : ["DRAFT", "FAILED", "UNKNOWN", "SENDING"],
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Email drafts"
        description="The queue of drafts awaiting your review. Each email goes to one recipient and is sent only when you click Send in its final preview. There is no bulk send."
        actions={<Link href="/drafts/templates" className={buttonClass.secondary}>Edit templates</Link>}
      />
      <nav className="flex gap-2 text-sm" aria-label="Filter drafts">
        {[["open", "Awaiting action"], ["sent", "Sent"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/drafts?show=${k}`} aria-current={show === k ? "page" : undefined} className={`rounded-md px-3 py-1.5 ${show === k ? "bg-indigo-50 font-medium text-indigo-800" : "text-slate-600 hover:bg-slate-100"}`}>{l}</Link>
        ))}
      </nav>
      {drafts.length === 0 ? (
        <Empty>No drafts here. Use “Prepare email” on a contact to create one.</Empty>
      ) : (
        <Table>
          <thead><tr><Th>Recipient</Th><Th>Subject</Th><Th>Attachment</Th><Th>State</Th><Th>Updated</Th><Th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {drafts.map((d) => (
              <tr key={d.id}>
                <Td>
                  <div className="font-medium text-slate-900">{d.contact.fullName}</div>
                  <div className="text-xs text-slate-500">{d.contact.title ?? ""}{d.contact.company ? ` · ${d.contact.company.name}` : ""}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs"><span className="font-mono">{d.recipientEmail ?? "no address"}</span> <EmailStatusBadge status={d.contact.emailStatus} origin={d.contact.emailOrigin} /></div>
                </Td>
                <Td>{d.subject}{d.kind === "FOLLOW_UP" ? <> <Badge tone="blue">follow-up</Badge></> : null}</Td>
                <Td className="text-xs">{d.resume ? d.resume.originalFilename : <span className="text-red-700">none</span>}</Td>
                <Td><Badge tone={d.sendState === "SENT" ? "green" : d.sendState === "UNKNOWN" || d.sendState === "FAILED" ? "red" : d.reviewedHash === d.contentHash ? "blue" : "gray"}>{d.sendState === "DRAFT" ? (d.reviewedHash === d.contentHash ? "reviewed" : "awaiting review") : d.sendState.toLowerCase()}</Badge></Td>
                <Td className="text-xs">{fmtDateTime(d.updatedAt)}</Td>
                <Td><Link href={`/drafts/${d.id}`} className={buttonClass.small}>{d.sendState === "DRAFT" || d.sendState === "FAILED" ? "Review email" : "Open"}</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
