import Link from "next/link";
import { Badge, buttonClass, Empty, fmtDate, inputClass, PageHeader, Table, Td, Th } from "@/components/ui";
import { getActiveProfile } from "@/lib/session";
import { listCompaniesForProfile } from "@/lib/services/companies";

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const profile = await getActiveProfile();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const rows = await listCompaniesForProfile(profile.id, {
    q: one("q") || undefined,
    industry: one("industry") || undefined,
    status: one("status") || undefined,
    hasOpenings: one("openings") === "1",
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Company research"
        description="Companies tracked by this profile. Company facts are shared between profiles; target/excluded status, contacts and outreach are not."
        actions={<Link href="/discover/companies" className={buttonClass.primary}>Discover companies</Link>}
      />
      <form className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div><label className="text-xs text-slate-600" htmlFor="q">Search</label><input id="q" name="q" defaultValue={one("q")} className={inputClass} /></div>
        <div><label className="text-xs text-slate-600" htmlFor="industry">Industry</label><input id="industry" name="industry" defaultValue={one("industry")} className={inputClass} /></div>
        <div>
          <label className="text-xs text-slate-600" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={one("status")} className={inputClass}>
            <option value="">All</option><option value="TARGET">Target</option><option value="WATCHING">Watching</option><option value="EXCLUDED">Excluded</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="openings" value="1" defaultChecked={one("openings") === "1"} /> With open roles</label>
        <button className={buttonClass.secondary}>Filter</button>
      </form>
      {rows.length === 0 ? (
        <Empty>No companies yet. <Link className="text-indigo-700 underline" href="/discover/companies">Discover or add companies</Link>.</Empty>
      ) : (
        <Table>
          <thead><tr><Th>Company</Th><Th>Industry</Th><Th>Status</Th><Th>Openings</Th><Th>Contacts</Th><Th>Last researched</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ company: c, status, targetType }) => (
              <tr key={c.id}>
                <Td><Link href={`/companies/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.name}</Link><div className="text-xs text-slate-500">{c.domain ?? "no website"}</div></Td>
                <Td className="text-xs">{c.industry ?? "—"}</Td>
                <Td>
                  <Badge tone={status === "EXCLUDED" ? "red" : status === "TARGET" ? "indigo" : "gray"}>{status.toLowerCase()}</Badge>{" "}
                  {status !== "EXCLUDED" ? <Badge tone={targetType === "OPEN_ROLE" ? "green" : "gray"} title={targetType === "OPEN_ROLE" ? "A relevant opening was observed" : "No vacancy observed – networking target"}>{targetType === "OPEN_ROLE" ? "open role" : "speculative"}</Badge> : null}
                </Td>
                <Td>{c._count.jobs}</Td>
                <Td>{c._count.contacts}</Td>
                <Td className="text-xs">{fmtDate(c.lastResearchedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
