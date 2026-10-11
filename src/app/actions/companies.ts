"use server";

import { redirect } from "next/navigation";
import { bool, formObject, run, str, type ActionState } from "@/lib/action-utils";
import { activeProfileId } from "@/lib/session";
import { addManualJob, assertCompanyAccess, deleteCompany, linkCompany, setJobStatus, unlinkCompany, updateCompany, upsertCompany } from "@/lib/services/companies";
import {
  discoverCompanies,
  refreshCompanyJobs,
  researchCompanyWebsite,
  researchSinglePage,
  saveDiscoveredCompany,
  webSearch,
  type CompanyCandidate,
} from "@/lib/services/discovery";
import { addResearchItem, deleteResearchItem, setResearchConfirmed } from "@/lib/services/research";
import type { WikidataCompany } from "@/lib/providers/wikidata";
import type { WebResult } from "@/lib/providers/brave";
import { db } from "@/lib/db";
import { UserError } from "@/lib/services/errors";

export async function createCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null;
  const res = await run(async () => {
    const profileId = await activeProfileId();
    const c = await upsertCompany(formObject(fd) as never, "MANUAL");
    await linkCompany(profileId, c.id, (str(fd, "status") || "TARGET") as never, str(fd, "notes") || null);
    id = c.id;
  });
  if (res.ok && id) redirect(`/companies/${id}`);
  return res;
}

export async function updateCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await assertCompanyAccess(await activeProfileId(), str(fd, "id"));
    await updateCompany(str(fd, "id"), formObject(fd) as never);
  }, "Company saved.");
}

export async function setCompanyStatusAction(fd: FormData) {
  const profileId = await activeProfileId();
  const status = str(fd, "status");
  if (status === "REMOVE") await unlinkCompany(profileId, str(fd, "companyId"));
  else await linkCompany(profileId, str(fd, "companyId"), status as never, fd.has("notes") ? str(fd, "notes") : undefined);
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/", "layout");
}

export async function deleteCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await run(async () => {
    await assertCompanyAccess(await activeProfileId(), str(fd, "companyId"));
    const others = await db.profileCompany.count({ where: { companyId: str(fd, "companyId") } });
    if (others > 1) throw new UserError("The other profile also tracks this company. Remove it from your list instead.");
    await deleteCompany(str(fd, "companyId"));
  });
  if (res.ok) redirect("/companies");
  return res;
}

export async function researchWebsiteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    async () => {
      const extra = str(fd, "extraUrls").split(/\s+/).filter(Boolean).slice(0, 5);
      return researchCompanyWebsite(await activeProfileId(), str(fd, "companyId"), {}, extra);
    },
    (s) =>
      `Fetched ${s.pagesFetched} page(s); ${s.contactsCreated} new contact(s), ${s.contactsUpdated} updated; ${s.channelsAdded} company channel(s).` +
      (s.atsDetected.length ? ` Job board detected: ${s.atsDetected.join(", ")}.` : "") +
      (s.jobsFound != null ? ` ${s.jobsFound} open role(s).` : "") +
      (s.jobsError ? ` Job lookup failed: ${s.jobsError}` : "") +
      (s.skipped.length ? ` Skipped: ${s.skipped.map((x) => `${x.url} (${x.reason})`).join("; ")}` : ""),
  );
}

export async function researchPageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    async () => researchSinglePage(await activeProfileId(), str(fd, "companyId"), str(fd, "url"), (str(fd, "sourceType") || "PUBLIC_DIRECTORY") as never),
    (r) => `Retrieved "${r.title ?? "page"}": ${r.people} person(s) found; ${r.created} new contact(s), ${r.updated} updated.`,
  );
}

export async function refreshJobsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => refreshCompanyJobs(await activeProfileId(), str(fd, "companyId")), (r) => `${r.fetched} posting(s) retrieved; ${r.open} open; ${r.closed} marked closed.`);
}

export async function addJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await assertCompanyAccess(await activeProfileId(), str(fd, "companyId"));
    await addManualJob(str(fd, "companyId"), formObject(fd) as never);
  }, "Opening added (manual).");
}

export async function setJobStatusAction(fd: FormData) {
  const job = await db.jobOpportunity.findUniqueOrThrow({ where: { id: str(fd, "jobId") } });
  await assertCompanyAccess(await activeProfileId(), job.companyId);
  await setJobStatus(job.id, str(fd, "status") as never);
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/", "layout");
}

export async function discoverCompaniesAction(_: ActionState<{ candidates: CompanyCandidate[]; resolved: Record<string, string> }>, fd: FormData) {
  return run(
    async () => discoverCompanies(await activeProfileId(), { name: str(fd, "name") || undefined, industry: str(fd, "industry") || undefined, country: str(fd, "country") || undefined }),
    (r) => `${r.candidates.length} compan${r.candidates.length === 1 ? "y" : "ies"} found on Wikidata.`,
  );
}

export async function saveDiscoveredCompanyAction(candidate: WikidataCompany): Promise<ActionState<{ id: string }>> {
  return run(async () => ({ id: (await saveDiscoveredCompany(await activeProfileId(), candidate)).id }), "Added to your target companies.");
}

export async function webSearchAction(_: ActionState<WebResult[]>, fd: FormData) {
  return run(async () => webSearch(await activeProfileId(), str(fd, "q")), (r) => `${r.length} web result(s). These are leads to review, not verified contacts.`);
}

export async function addResearchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await addResearchItem(await activeProfileId(), str(fd, "companyId"), {
      kind: (str(fd, "kind") || "OTHER") as never,
      statement: str(fd, "statement"),
      quote: str(fd, "quote") || null,
      sourceUrl: str(fd, "sourceUrl") || null,
      publishedAt: str(fd, "publishedAt") || null,
      contactId: str(fd, "contactId") || null,
      confirmed: bool(fd, "confirmed"),
      shared: bool(fd, "shared"),
    });
  }, "Research saved.");
}

export async function toggleResearchAction(fd: FormData) {
  await setResearchConfirmed(await activeProfileId(), str(fd, "id"), bool(fd, "confirmed"));
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/", "layout");
}

export async function deleteResearchAction(fd: FormData) {
  await deleteResearchItem(await activeProfileId(), str(fd, "id"));
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/", "layout");
}
