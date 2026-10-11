import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { parseList } from "@/lib/json";
import { normalizeCompanyName, normalizeDomain, normalizeUrl } from "@/lib/normalize";
import { NotFoundError, UserError } from "./errors";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length ? v : null))
    .nullable()
    .optional();

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  website: opt(500),
  careersUrl: opt(500),
  leadershipUrl: opt(500),
  industry: opt(200),
  headquarters: opt(200),
  sizeRange: opt(100),
  businessModel: opt(300),
  description: opt(3000),
  descriptionSourceUrl: opt(500),
  atsProvider: z.enum(["GREENHOUSE", "LEVER", "LEVER_EU", "ASHBY", ""]).optional().nullable(),
  atsSlug: opt(100),
});

export type CompanyInput = z.input<typeof companyInputSchema>;

function urlOrNull(v: string | null | undefined, field: string): string | null {
  if (!v) return null;
  const u = normalizeUrl(v);
  if (!u) throw new UserError(`${field} must be a valid http(s) URL.`);
  return u;
}

/** Create or update a shared company record (deduplicated by domain, then by normalised name). */
export async function upsertCompany(
  input: CompanyInput,
  origin: "MANUAL" | "AUTOMATED" | "IMPORTED" = "MANUAL",
  extra: { wikidataId?: string | null; sourceUrl?: string | null } = {},
) {
  const d = companyInputSchema.parse(input);
  const website = urlOrNull(d.website, "Website");
  const domain = normalizeDomain(website);
  const normalizedName = normalizeCompanyName(d.name);
  const data = {
    name: d.name,
    normalizedName,
    website,
    domain,
    careersUrl: urlOrNull(d.careersUrl, "Careers URL"),
    leadershipUrl: urlOrNull(d.leadershipUrl, "Leadership URL"),
    industry: d.industry ?? null,
    headquarters: d.headquarters ?? null,
    sizeRange: d.sizeRange ?? null,
    businessModel: d.businessModel ?? null,
    description: d.description ?? null,
    descriptionSourceUrl: urlOrNull(d.descriptionSourceUrl, "Description source URL"),
    atsProvider: d.atsProvider || null,
    atsSlug: d.atsSlug ?? null,
  };

  let existing =
    (domain ? await db.company.findUnique({ where: { domain } }) : null) ??
    (extra.wikidataId ? await db.company.findUnique({ where: { wikidataId: extra.wikidataId } }) : null);
  if (!existing && normalizedName) {
    existing = await db.company.findFirst({ where: { normalizedName, OR: [{ domain: null }, { domain: domain ?? undefined }] } });
  }

  const sourceUrls = existing ? parseList(existing.sourceUrls) : [];
  if (extra.sourceUrl && !sourceUrls.includes(extra.sourceUrl)) sourceUrls.push(extra.sourceUrl);

  if (existing) {
    // Fill gaps only; never overwrite existing values with empties.
    const patch: Prisma.CompanyUpdateInput = { sourceUrls: JSON.stringify(sourceUrls) };
    for (const [k, v] of Object.entries(data)) {
      if (v != null && (existing as Record<string, unknown>)[k] == null) (patch as Record<string, unknown>)[k] = v;
    }
    if (extra.wikidataId && !existing.wikidataId) patch.wikidataId = extra.wikidataId;
    return db.company.update({ where: { id: existing.id }, data: patch });
  }
  return db.company.create({
    data: { ...data, origin, wikidataId: extra.wikidataId ?? null, sourceUrls: JSON.stringify(sourceUrls) },
  });
}

export async function updateCompany(companyId: string, input: CompanyInput) {
  const d = companyInputSchema.parse(input);
  const existing = await db.company.findUnique({ where: { id: companyId } });
  if (!existing) throw new NotFoundError("Company");
  const website = urlOrNull(d.website, "Website");
  const domain = normalizeDomain(website);
  if (domain && domain !== existing.domain) {
    const clash = await db.company.findUnique({ where: { domain } });
    if (clash && clash.id !== companyId) throw new UserError(`Another company (${clash.name}) already uses ${domain}.`);
  }
  return db.company.update({
    where: { id: companyId },
    data: {
      name: d.name,
      normalizedName: normalizeCompanyName(d.name),
      website,
      domain,
      careersUrl: urlOrNull(d.careersUrl, "Careers URL"),
      leadershipUrl: urlOrNull(d.leadershipUrl, "Leadership URL"),
      industry: d.industry ?? null,
      headquarters: d.headquarters ?? null,
      sizeRange: d.sizeRange ?? null,
      businessModel: d.businessModel ?? null,
      description: d.description ?? null,
      descriptionSourceUrl: urlOrNull(d.descriptionSourceUrl, "Description source URL"),
      atsProvider: d.atsProvider || null,
      atsSlug: d.atsSlug ?? null,
    },
  });
}

export async function linkCompany(
  profileId: string,
  companyId: string,
  status: "TARGET" | "WATCHING" | "EXCLUDED" = "TARGET",
  notes?: string | null,
) {
  const openings = await db.jobOpportunity.count({ where: { companyId, status: "OPEN" } });
  return db.profileCompany.upsert({
    where: { profileId_companyId: { profileId, companyId } },
    update: { status, ...(notes !== undefined ? { notes } : {}) },
    create: { profileId, companyId, status, notes: notes ?? null, targetType: openings ? "OPEN_ROLE" : "SPECULATIVE" },
  });
}

export async function unlinkCompany(profileId: string, companyId: string) {
  await db.profileCompany.deleteMany({ where: { profileId, companyId } });
}

export interface CompanyFilters {
  q?: string;
  industry?: string;
  status?: string;
  hasOpenings?: boolean;
}

export async function listCompaniesForProfile(profileId: string, f: CompanyFilters = {}) {
  const where: Prisma.ProfileCompanyWhereInput = { profileId };
  if (f.status) where.status = f.status as "TARGET" | "WATCHING" | "EXCLUDED";
  const companyWhere: Prisma.CompanyWhereInput = {};
  if (f.q) companyWhere.OR = [{ name: { contains: f.q } }, { domain: { contains: f.q.toLowerCase() } }];
  if (f.industry) companyWhere.industry = { contains: f.industry };
  if (f.hasOpenings) companyWhere.jobs = { some: { status: "OPEN" } };
  where.company = companyWhere;
  return db.profileCompany.findMany({
    where,
    include: {
      company: {
        include: {
          _count: { select: { jobs: { where: { status: "OPEN" } }, contacts: { where: { profileId, mergedIntoId: null } } } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCompanyForProfile(profileId: string, companyId: string) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    include: {
      jobs: { orderBy: [{ status: "asc" }, { retrievedAt: "desc" }] },
      channels: true,
      documents: { orderBy: { retrievedAt: "desc" }, take: 30 },
      researchItems: { where: { OR: [{ profileId: null }, { profileId }] }, orderBy: { createdAt: "desc" } },
      contacts: { where: { profileId, mergedIntoId: null }, orderBy: { relevanceScore: "desc" } },
      profileLinks: { where: { profileId } },
    },
  });
  if (!company) throw new NotFoundError("Company");
  return company;
}

export async function deleteCompany(companyId: string) {
  // Contacts keep their history (companyId is set null); drafts keep their snapshot.
  await db.company.delete({ where: { id: companyId } });
}

export const jobInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  department: opt(200),
  location: opt(200),
  url: opt(1000),
  postedAt: opt(30),
});

export async function addManualJob(companyId: string, input: z.input<typeof jobInputSchema>) {
  const d = jobInputSchema.parse(input);
  const url = urlOrNull(d.url, "Job URL");
  const job = await db.jobOpportunity.create({
    data: {
      companyId,
      title: d.title,
      department: d.department ?? null,
      location: d.location ?? null,
      url,
      source: "MANUAL",
      postedAt: d.postedAt ? new Date(d.postedAt) : null,
    },
  });
  await db.profileCompany.updateMany({ where: { companyId }, data: { targetType: "OPEN_ROLE" } });
  return job;
}

export async function setJobStatus(jobId: string, status: "OPEN" | "CLOSED" | "UNKNOWN") {
  return db.jobOpportunity.update({ where: { id: jobId }, data: { status } });
}

/** A profile may modify a shared company only if it tracks it (or has contacts there). */
export async function assertCompanyAccess(profileId: string, companyId: string) {
  const [link, contacts] = await Promise.all([
    db.profileCompany.findUnique({ where: { profileId_companyId: { profileId, companyId } } }),
    db.contact.count({ where: { profileId, companyId } }),
  ]);
  if (!link && !contacts) throw new NotFoundError("Company");
}
