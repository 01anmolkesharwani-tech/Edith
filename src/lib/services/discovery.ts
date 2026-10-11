import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isRoleAddress } from "@/lib/email/validation";
import { extractPage, extractPeople, type ExtractedPerson } from "@/lib/extract/html";
import { parseList } from "@/lib/json";
import { emailDomain, normalizeDomain } from "@/lib/normalize";
import { RobotsCache } from "@/lib/net/robots";
import { FetchError, HostThrottle, safeFetch, UnsafeUrlError, validatePublicUrl, type Fetcher } from "@/lib/net/safe-fetch";
import { braveConfigured, braveSearch, type WebResult } from "@/lib/providers/brave";
import { fetchJobsForBoard } from "@/lib/providers/job-boards";
import { isNeverFetchHost } from "@/lib/providers/search-links";
import { ProviderError } from "@/lib/providers/types";
import { researchWebsite, WebsiteResearchError, type ResearchedPage } from "@/lib/providers/website";
import { companiesById, companiesByIndustry, searchEntities, type WikidataCompany } from "@/lib/providers/wikidata";
import { createContact, findContactDuplicates, recomputeContact } from "./contacts";
import { linkCompany, upsertCompany } from "./companies";
import { NotFoundError, UserError } from "./errors";
import { getSettings, userAgentFor } from "./settings";

export interface DiscoveryDeps {
  fetcher?: Fetcher;
  throttle?: HostThrottle;
}

const sharedThrottle = new HostThrottle();
const robotsCaches = new Map<Fetcher, RobotsCache>();

function robotsFor(fetcher: Fetcher, ua: string): RobotsCache {
  let r = robotsCaches.get(fetcher);
  if (!r) {
    r = new RobotsCache(fetcher, ua);
    robotsCaches.set(fetcher, r);
  }
  return r;
}

async function recordSearch(
  profileId: string,
  data: { kind: string; provider: string; query: string; params?: unknown; resultCount?: number; status: string; errorMessage?: string | null },
) {
  await db.searchHistory.create({
    data: {
      profileId,
      kind: data.kind,
      provider: data.provider,
      query: data.query.slice(0, 500),
      params: data.params ? JSON.stringify(data.params) : null,
      resultCount: data.resultCount ?? 0,
      status: data.status,
      errorMessage: data.errorMessage?.slice(0, 500) ?? null,
    },
  });
}

function sourceTypeForPage(category: ResearchedPage["category"], official: boolean) {
  if (!official) return "PUBLIC_DIRECTORY" as const;
  switch (category) {
    case "news":
      return "OFFICIAL_ANNOUNCEMENT" as const;
    case "careers":
      return "CAREERS_PAGE" as const;
    default:
      return "OFFICIAL_TEAM_PAGE" as const;
  }
}

async function saveDocument(page: ResearchedPage, companyId: string | null) {
  return db.sourceDocument.create({
    data: {
      url: page.url,
      finalUrl: page.finalUrl,
      domain: normalizeDomain(page.finalUrl) ?? "",
      title: page.title,
      httpStatus: page.status,
      contentHash: page.contentHash,
      textExcerpt: page.text.slice(0, 20_000),
      publishedAt: page.publishedAt,
      retrievedAt: page.retrievedAt,
      companyId,
    },
  });
}

interface PersonPersistResult {
  created: number;
  updated: number;
  skipped: number;
}

/** Store extracted people as AUTOMATED contacts (needs review) with field-level evidence. */
async function persistPeople(
  profileId: string,
  company: { id: string; name: string; domain: string | null },
  people: { person: ExtractedPerson; page: ResearchedPage; docId: string; official: boolean; sourceTypeOverride?: string }[],
): Promise<PersonPersistResult> {
  const result: PersonPersistResult = { created: 0, updated: 0, skipped: 0 };
  for (const { person, page, docId, official, sourceTypeOverride } of people.slice(0, 80)) {
    const sourceType = (sourceTypeOverride ?? sourceTypeForPage(page.category, official)) as Prisma.ContactFieldEvidenceCreateManyInput["sourceType"];
    const confidence = person.method === "json-ld" ? "HIGH" : "MEDIUM";
    const publishedAt = sourceType === "OFFICIAL_ANNOUNCEMENT" || sourceType === "NEWS_ARTICLE" ? page.publishedAt : null;
    // Only attach an email to a person when it sits in the same card and is not a shared inbox.
    const email =
      person.email && !isRoleAddress(person.email) && (!company.domain || emailDomain(person.email)?.endsWith(company.domain))
        ? person.email
        : null;
    const base = {
      sourceUrl: page.finalUrl,
      sourceType,
      sourceDocumentId: docId,
      observedAt: page.retrievedAt,
      publishedAt,
      verificationMethod: "AUTOMATED_EXTRACTION" as const,
      origin: "AUTOMATED" as const,
      snippet: person.snippet,
    };
    const evidence: Omit<Prisma.ContactFieldEvidenceCreateManyInput, "contactId">[] = [
      { ...base, field: "NAME", value: person.name, confidence },
    ];
    if (person.title) evidence.push({ ...base, field: "TITLE", value: person.title, confidence });
    if (official) {
      evidence.push({
        ...base,
        field: "COMPANY",
        value: company.name,
        confidence: "MEDIUM",
        notes: "Listed on the company's official website",
      });
    }
    if (email)
      evidence.push({
        ...base,
        field: "EMAIL",
        value: email,
        confidence: "MEDIUM",
        verificationMethod: "EXACT_MATCH_ON_PAGE",
        notes: "Exact address found next to this person on the page",
      });
    if (person.phone) evidence.push({ ...base, field: "PHONE", value: person.phone, confidence: "LOW", notes: "Phone type unknown" });

    const dups = await findContactDuplicates(profileId, {
      fullName: person.name,
      companyId: company.id,
      email,
      profileUrl: person.profileUrl,
    });
    const strong = dups.find((d) => d.strength === "STRONG");
    if (strong) {
      // New observation of a known contact: add evidence (refreshes freshness), don't overwrite fields.
      await db.contactFieldEvidence.createMany({ data: evidence.map((e) => ({ ...e, contactId: strong.id })) });
      await recomputeContact(strong.id);
      result.updated++;
      continue;
    }
    try {
      await createContact(
        profileId,
        {
          fullName: person.name,
          title: person.title,
          companyId: company.id,
          email,
          emailOrigin: email ? "PUBLIC_SOURCE" : null,
          phone: person.phone,
          phoneType: person.phone ? "UNKNOWN" : null,
          profileUrl: person.profileUrl,
        },
        { origin: "AUTOMATED", evidence, allowDuplicate: true },
      );
      result.created++;
    } catch {
      result.skipped++;
    }
  }
  return result;
}

export interface WebsiteResearchSummary {
  pagesFetched: number;
  skipped: { url: string; reason: string }[];
  contactsCreated: number;
  contactsUpdated: number;
  channelsAdded: number;
  atsDetected: string[];
  jobsFound: number | null;
  jobsError: string | null;
}

export async function researchCompanyWebsite(
  profileId: string,
  companyId: string,
  deps: DiscoveryDeps = {},
  extraUrls: string[] = [],
): Promise<WebsiteResearchSummary> {
  const settings = await getSettings();
  if (!settings.websiteResearchEnabled) throw new UserError("Website research is disabled in Settings.");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Company");
  if (!company.website) throw new UserError("Add the company's official website first.");
  const fetcher = deps.fetcher ?? safeFetch;
  const ua = userAgentFor(settings);
  const extras = [company.leadershipUrl, ...extraUrls].filter((u): u is string => !!u);

  let research;
  try {
    research = await researchWebsite(
      company.website,
      {
        fetcher,
        robots: robotsFor(fetcher, ua),
        throttle: deps.throttle ?? sharedThrottle,
        userAgent: ua,
        requestDelayMs: settings.requestDelayMs,
        maxPages: settings.maxPagesPerSite,
        timeoutMs: settings.fetchTimeoutMs,
        maxBytes: settings.maxResponseBytes,
      },
      extras,
    );
  } catch (e) {
    const msg = e instanceof WebsiteResearchError ? e.message : `Research failed: ${(e as Error).message}`;
    await recordSearch(profileId, { kind: "WEBSITE", provider: "official-website", query: company.website, status: "ERROR", errorMessage: msg });
    throw new UserError(msg);
  }

  const people: Parameters<typeof persistPeople>[2] = [];
  let channelsAdded = 0;
  const companyDomain = company.domain;
  for (const page of research.pages) {
    const doc = await saveDocument(page, company.id);
    const official = !!companyDomain && (normalizeDomain(page.finalUrl) ?? "").endsWith(companyDomain);
    for (const person of page.people) people.push({ person, page, docId: doc.id, official });
    const personEmails = new Set(page.people.map((p) => p.email).filter(Boolean));
    for (const { email } of page.emails) {
      if (personEmails.has(email) || (companyDomain && !emailDomain(email)?.endsWith(companyDomain))) continue;
      await db.companyChannel.upsert({
        where: { companyId_kind_value: { companyId: company.id, kind: "EMAIL", value: email } },
        update: { observedAt: page.retrievedAt, sourceUrl: page.finalUrl },
        create: { companyId: company.id, kind: "EMAIL", value: email, label: isRoleAddress(email) ? "Shared inbox" : "Listed address", sourceUrl: page.finalUrl, observedAt: page.retrievedAt },
      });
      channelsAdded++;
    }
    if (page.category === "contact" || page.category === "home") {
      for (const { phone } of page.phones.slice(0, 5)) {
        await db.companyChannel.upsert({
          where: { companyId_kind_value: { companyId: company.id, kind: "PHONE", value: phone } },
          update: { observedAt: page.retrievedAt },
          create: { companyId: company.id, kind: "PHONE", value: phone, label: "Company number (not an individual's line)", phoneType: "UNKNOWN", sourceUrl: page.finalUrl, observedAt: page.retrievedAt },
        });
        channelsAdded++;
      }
    }
  }

  const sourceUrls = parseList(company.sourceUrls);
  for (const p of research.pages) if (!sourceUrls.includes(p.finalUrl)) sourceUrls.push(p.finalUrl);
  const ats = research.ats[0];
  await db.company.update({
    where: { id: company.id },
    data: {
      description: company.description ?? research.description,
      descriptionSourceUrl: company.description ? company.descriptionSourceUrl : research.descriptionSourceUrl,
      careersUrl: company.careersUrl ?? research.careersUrl,
      leadershipUrl: company.leadershipUrl ?? research.leadershipUrl,
      atsProvider: company.atsProvider ?? (ats ? (ats.provider === "LEVER" && ats.region === "eu" ? "LEVER_EU" : ats.provider) : null),
      atsSlug: company.atsSlug ?? ats?.slug ?? null,
      lastResearchedAt: new Date(),
      sourceUrls: JSON.stringify(sourceUrls.slice(-100)),
    },
  });
  if (research.description && research.descriptionSourceUrl) {
    const exists = await db.researchItem.findFirst({ where: { companyId: company.id, kind: "DESCRIPTION", sourceUrl: research.descriptionSourceUrl } });
    if (!exists) {
      await db.researchItem.create({
        data: {
          companyId: company.id,
          kind: "DESCRIPTION",
          statement: research.description.slice(0, 500),
          quote: research.description.slice(0, 1000),
          sourceUrl: research.descriptionSourceUrl,
          origin: "AUTOMATED",
          confirmed: false,
        },
      });
    }
  }

  const persisted = await persistPeople(profileId, company, people);

  let jobsFound: number | null = null;
  let jobsError: string | null = null;
  const refreshed = await db.company.findUniqueOrThrow({ where: { id: company.id } });
  if (refreshed.atsProvider && refreshed.atsSlug && settings.jobBoardsEnabled) {
    try {
      jobsFound = (await refreshCompanyJobs(profileId, company.id, deps)).open;
    } catch (e) {
      jobsError = (e as Error).message;
    }
  }

  await recordSearch(profileId, {
    kind: "WEBSITE",
    provider: "official-website",
    query: company.website,
    resultCount: persisted.created + persisted.updated,
    status: "OK",
    params: { pages: research.pages.map((p) => p.finalUrl), skipped: research.skipped },
  });

  return {
    pagesFetched: research.pages.length,
    skipped: research.skipped,
    contactsCreated: persisted.created,
    contactsUpdated: persisted.updated,
    channelsAdded,
    atsDetected: research.ats.map((a) => `${a.provider}:${a.slug}`),
    jobsFound,
    jobsError,
  };
}

/**
 * Research one public page supplied by the user (e.g. a press release or a directory listing).
 * The page must be public, allowed by robots.txt and not on a site whose terms prohibit automated access.
 */
export async function researchSinglePage(
  profileId: string,
  companyId: string,
  url: string,
  sourceType: "OFFICIAL_TEAM_PAGE" | "OFFICIAL_BIO" | "OFFICIAL_ANNOUNCEMENT" | "PUBLIC_DIRECTORY" | "NEWS_ARTICLE",
  deps: DiscoveryDeps = {},
) {
  const settings = await getSettings();
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Company");
  let u: URL;
  try {
    u = validatePublicUrl(url);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  if (isNeverFetchHost(u.hostname)) throw new UserError("This site's terms prohibit automated collection. Add details manually instead.");
  const fetcher = deps.fetcher ?? safeFetch;
  const ua = userAgentFor(settings);
  const robots = robotsFor(fetcher, ua);
  if (!(await robots.allowed(u.toString()))) throw new UserError("robots.txt disallows automated access to this page.");
  await (deps.throttle ?? sharedThrottle).wait(u.host, settings.requestDelayMs);
  let res;
  try {
    res = await fetcher(u.toString(), { userAgent: ua, timeoutMs: settings.fetchTimeoutMs, maxBytes: settings.maxResponseBytes });
  } catch (e) {
    throw new UserError(e instanceof UnsafeUrlError || e instanceof FetchError ? e.message : "Could not retrieve the page.");
  }
  if (res.status < 200 || res.status >= 300) throw new UserError(`The page returned HTTP ${res.status}.`);
  const extracted = extractPage(res.body, res.finalUrl);
  const page: ResearchedPage = {
    url,
    finalUrl: res.finalUrl,
    category: sourceType === "OFFICIAL_ANNOUNCEMENT" || sourceType === "NEWS_ARTICLE" ? "news" : "leadership",
    status: res.status,
    title: extracted.title,
    description: extracted.description,
    text: extracted.text,
    contentHash: (await import("node:crypto")).createHash("sha256").update(res.body).digest("hex"),
    publishedAt: extracted.publishedAt,
    retrievedAt: res.retrievedAt,
    people: extractPeople(res.body, res.finalUrl),
    emails: extracted.emails,
    phones: extracted.phones,
  };
  const doc = await saveDocument(page, company.id);
  const official = !!company.domain && (normalizeDomain(page.finalUrl) ?? "").endsWith(company.domain);
  const persisted = await persistPeople(
    profileId,
    company,
    page.people.map((person) => ({ person, page, docId: doc.id, official, sourceTypeOverride: sourceType })),
  );
  await recordSearch(profileId, { kind: "PAGE", provider: "public-page", query: url, resultCount: persisted.created + persisted.updated, status: "OK" });
  return { documentId: doc.id, title: page.title, publishedAt: page.publishedAt, people: page.people.length, ...persisted };
}

export async function refreshCompanyJobs(profileId: string, companyId: string, deps: DiscoveryDeps = {}) {
  const settings = await getSettings();
  if (!settings.jobBoardsEnabled) throw new UserError("Job-board lookups are disabled in Settings.");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Company");
  if (!company.atsProvider || !company.atsSlug) {
    throw new UserError("No public job board is configured. Set the ATS provider and board identifier on the company.");
  }
  const fetcher = deps.fetcher ?? safeFetch;
  let postings;
  try {
    postings = await fetchJobsForBoard(fetcher, company.atsProvider, company.atsSlug, userAgentFor(settings));
  } catch (e) {
    const msg = e instanceof ProviderError ? `${e.provider}: ${e.message}` : (e as Error).message;
    await recordSearch(profileId, { kind: "JOBS", provider: company.atsProvider.toLowerCase(), query: company.atsSlug, status: e instanceof ProviderError && e.kind === "RATE_LIMITED" ? "RATE_LIMITED" : "ERROR", errorMessage: msg });
    throw new UserError(msg);
  }
  const now = new Date();
  const seen: string[] = [];
  for (const p of postings) {
    seen.push(p.externalId);
    await db.jobOpportunity.upsert({
      where: { source_externalId: { source: p.source, externalId: p.externalId } },
      update: { title: p.title, department: p.department, location: p.location, url: p.url, lastSeenAt: now, status: "OPEN", descriptionExcerpt: p.descriptionExcerpt },
      create: {
        companyId,
        source: p.source,
        externalId: p.externalId,
        title: p.title,
        department: p.department,
        location: p.location,
        url: p.url,
        postedAt: p.postedAt,
        descriptionExcerpt: p.descriptionExcerpt,
        retrievedAt: now,
        lastSeenAt: now,
      },
    });
  }
  const source = postings[0]?.source ?? (company.atsProvider.startsWith("LEVER") ? "LEVER" : company.atsProvider);
  const closed = await db.jobOpportunity.updateMany({
    where: { companyId, source, status: "OPEN", externalId: { notIn: seen } },
    data: { status: "CLOSED" },
  });
  const open = await db.jobOpportunity.count({ where: { companyId, status: "OPEN" } });
  await db.profileCompany.updateMany({ where: { companyId }, data: { targetType: open ? "OPEN_ROLE" : "SPECULATIVE" } });
  await recordSearch(profileId, { kind: "JOBS", provider: company.atsProvider.toLowerCase(), query: company.atsSlug, resultCount: postings.length, status: "OK" });
  // Openings affect relevance scores of this company's contacts.
  const contacts = await db.contact.findMany({ where: { companyId, mergedIntoId: null }, select: { id: true } });
  for (const c of contacts) await recomputeContact(c.id);
  return { fetched: postings.length, open, closed: closed.count };
}

export interface CompanyCandidate extends WikidataCompany {
  existingCompanyId: string | null;
  excluded: boolean;
}

export async function discoverCompanies(
  profileId: string,
  params: { industry?: string; country?: string; name?: string },
  deps: DiscoveryDeps = {},
): Promise<{ candidates: CompanyCandidate[]; resolved: { industry?: string; country?: string } }> {
  const settings = await getSettings();
  if (!settings.wikidataEnabled) throw new UserError("Wikidata discovery is disabled in Settings.");
  const fetcher = deps.fetcher ?? safeFetch;
  const ua = userAgentFor(settings);
  const query = [params.name, params.industry, params.country].filter(Boolean).join(" | ");
  let found: WikidataCompany[] = [];
  const resolved: { industry?: string; country?: string } = {};
  try {
    if (params.name) {
      const ents = await searchEntities(fetcher, params.name, ua, 8);
      found = await companiesById(fetcher, ua, ents.map((e) => e.id));
    } else if (params.industry) {
      const ind = (await searchEntities(fetcher, params.industry, ua, 3))[0];
      if (!ind) throw new UserError(`Wikidata has no entity matching industry "${params.industry}".`);
      resolved.industry = `${ind.label} (${ind.id})`;
      let countryId: string | null = null;
      if (params.country) {
        const c = (await searchEntities(fetcher, params.country, ua, 3))[0];
        if (c) {
          countryId = c.id;
          resolved.country = `${c.label} (${c.id})`;
        }
      }
      found = await companiesByIndustry(fetcher, ua, ind.id, countryId, 50);
    } else {
      throw new UserError("Enter a company name or an industry.");
    }
  } catch (e) {
    if (e instanceof UserError) throw e;
    const msg = e instanceof ProviderError ? e.message : (e as Error).message;
    await recordSearch(profileId, { kind: "COMPANY", provider: "wikidata", query, status: "ERROR", errorMessage: msg });
    throw new UserError(`Wikidata lookup failed: ${msg}`);
  }
  await recordSearch(profileId, { kind: "COMPANY", provider: "wikidata", query, resultCount: found.length, status: "OK", params });

  const out: CompanyCandidate[] = [];
  for (const f of found) {
    const domain = normalizeDomain(f.website);
    const existing =
      (await db.company.findUnique({ where: { wikidataId: f.wikidataId } })) ??
      (domain ? await db.company.findUnique({ where: { domain } }) : null);
    const link = existing ? await db.profileCompany.findUnique({ where: { profileId_companyId: { profileId, companyId: existing.id } } }) : null;
    out.push({ ...f, existingCompanyId: existing?.id ?? null, excluded: link?.status === "EXCLUDED" });
  }
  return { candidates: out, resolved };
}

export async function saveDiscoveredCompany(profileId: string, c: WikidataCompany) {
  const company = await upsertCompany(
    {
      name: c.name,
      website: c.website,
      industry: c.industry,
      headquarters: [c.headquarters, c.country].filter(Boolean).join(", ") || null,
      sizeRange: c.employees ? `${c.employees.toLocaleString("en")} employees (Wikidata)` : null,
      description: c.description,
      descriptionSourceUrl: c.description ? c.sourceUrl : null,
    },
    "AUTOMATED",
    { wikidataId: c.wikidataId, sourceUrl: c.sourceUrl },
  );
  await linkCompany(profileId, company.id, "TARGET");
  return company;
}

export async function webSearch(profileId: string, query: string): Promise<WebResult[]> {
  if (!braveConfigured()) throw new UserError("Web search API is not configured (optional). Use the browser search links instead.");
  try {
    const results = await braveSearch(query);
    await recordSearch(profileId, { kind: "WEB", provider: "brave", query, resultCount: results.length, status: "OK" });
    return results;
  } catch (e) {
    const msg = (e as Error).message;
    await recordSearch(profileId, { kind: "WEB", provider: "brave", query, status: e instanceof ProviderError && e.kind === "RATE_LIMITED" ? "RATE_LIMITED" : "ERROR", errorMessage: msg });
    throw new UserError(msg);
  }
}
