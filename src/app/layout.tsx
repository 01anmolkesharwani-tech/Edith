import type { Metadata } from "next";
import Link from "next/link";
import { switchProfileAction, logoutAction } from "@/app/actions/profile";
import { NavLinks } from "@/components/client/NavLinks";
import { ProfileSwitcher } from "@/components/client/ProfileSwitcher";
import { Badge } from "@/components/ui";
import { db } from "@/lib/db";
import { accountReadiness } from "@/lib/sending/accounts";
import { sentInLast24h } from "@/lib/sending/send";
import { accessPasswordConfigured, getActiveProfile } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareerReach",
  description: "Recruitment research, contact evidence and approved one-to-one outreach for two candidate portals.",
};

export const dynamic = "force-dynamic";

async function loadShell() {
  try {
    const profile = await getActiveProfile();
    const [profiles, drafts, followUps, account, sent24h, resumes] = await Promise.all([
      db.candidateProfile.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, portalName: true, candidateName: true } }),
      db.emailDraft.count({ where: { profileId: profile.id, sendState: { in: ["DRAFT", "UNKNOWN"] } } }),
      db.followUp.count({ where: { profileId: profile.id, status: "SCHEDULED", dueDate: { lte: new Date() } } }),
      db.emailAccount.findFirst({ where: { profileId: profile.id, isActive: true } }),
      sentInLast24h(profile.id),
      db.resume.count({ where: { profileId: profile.id } }),
    ]);
    return { profile, profiles, drafts, followUps, account, sent24h, resumes };
  } catch (e) {
    if ((e as Error).message === "Unauthorized") return null; // the login page renders without the shell
    throw e;
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const data = await loadShell();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{data ? <AppShell data={data}>{children}</AppShell> : children}</body>
    </html>
  );
}

function AppShell({ data, children }: { data: NonNullable<Awaited<ReturnType<typeof loadShell>>>; children: React.ReactNode }) {
  const { profile, profiles, drafts, followUps, account, sent24h, resumes } = data;
  const sender = accountReadiness(account);
  const nav = [
    { href: "/", label: "Dashboard" },
    { href: "/discover/companies", label: "Discover Companies" },
    { href: "/discover/contacts", label: "Discover Contacts" },
    { href: "/contacts", label: "Contacts" },
    { href: "/companies", label: "Company Research" },
    { href: "/drafts", label: "Email Drafts", badge: drafts },
    { href: "/pipeline", label: "Outreach Pipeline" },
    { href: "/followups", label: "Follow-ups", badge: followUps },
    { href: "/resumes", label: "Résumés" },
    { href: "/import-export", label: "Import and Export" },
    { href: "/settings", label: "Settings" },
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="px-4 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight text-indigo-700">
            CareerReach
          </Link>
          <p className="text-xs text-slate-500">Research · evidence · approved outreach</p>
        </div>
        <nav aria-label="Main" className="px-2 pb-6">
          <NavLinks items={nav} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur md:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/" className="font-bold text-indigo-700 md:hidden">CareerReach</Link>
            <ProfileSwitcher profiles={profiles} activeId={profile.id} action={switchProfileAction} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {sender.ready ? (
              <Badge tone="green" title="Emails are sent only when you click Send on a reviewed draft">Sender: {account?.fromAddress}</Badge>
            ) : (
              <Link href="/settings#sender"><Badge tone="amber" title={sender.reason ?? ""}>Draft-only mode</Badge></Link>
            )}
            <Badge tone={sent24h >= profile.dailySendLimit ? "red" : "gray"} title="Accepted or pending sends in the last 24 hours">
              Sent (24h): {sent24h}/{profile.dailySendLimit}
            </Badge>
            {!resumes ? <Link href="/resumes"><Badge tone="red">No résumé uploaded</Badge></Link> : null}
            {!profile.candidateName ? <Link href="/settings#profile"><Badge tone="red">Candidate name not set</Badge></Link> : null}
            {accessPasswordConfigured() ? (
              <form action={logoutAction}>
                <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100">Lock</button>
              </form>
            ) : null}
          </div>
        </header>
        <nav aria-label="Main (mobile)" className="border-b border-slate-200 bg-white px-2 py-2 md:hidden">
          <div className="flex gap-1 overflow-x-auto text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded px-2 py-1 text-slate-700 hover:bg-slate-100">{n.label}</Link>
            ))}
          </div>
        </nav>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
