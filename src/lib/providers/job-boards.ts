/**
 * Public job-board APIs. Each exposes only postings an employer has chosen to publish,
 * requires no API key for reads, and needs the company's board identifier ("slug").
 * - Greenhouse Job Board API: GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 * - Lever Postings API:       GET https://api.lever.co/v0/postings/{site}?mode=json  (EU: api.eu.lever.co)
 * - Ashby Posting API:        GET https://api.ashbyhq.com/posting-api/job-board/{name}
 */
import type { Fetcher } from "@/lib/net/safe-fetch";
import { getJson, stripHtml } from "./http";
import type { JobPosting } from "./types";

const SLUG_RE = /^[A-Za-z0-9_.%-]{1,100}$/;

function assertSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error("Invalid job board identifier");
  return encodeURIComponent(slug);
}

function date(v: unknown): Date | null {
  if (v == null) return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface GreenhouseResponse {
  jobs?: {
    id: number;
    title: string;
    absolute_url?: string;
    updated_at?: string;
    first_published?: string;
    location?: { name?: string };
    departments?: { name?: string }[];
    content?: string;
  }[];
}

export async function fetchGreenhouseJobs(fetcher: Fetcher, slug: string, userAgent?: string): Promise<JobPosting[]> {
  const data = await getJson<GreenhouseResponse>(
    fetcher,
    "greenhouse",
    `https://boards-api.greenhouse.io/v1/boards/${assertSlug(slug)}/jobs?content=true`,
    userAgent,
  );
  return (data.jobs ?? []).map((j) => ({
    source: "GREENHOUSE" as const,
    externalId: `${slug}:${j.id}`,
    title: j.title,
    department: j.departments?.map((d) => d.name).filter(Boolean).join(", ") || null,
    location: j.location?.name ?? null,
    url: j.absolute_url ?? null,
    postedAt: date(j.first_published ?? j.updated_at),
    descriptionExcerpt: stripHtml(j.content),
  }));
}

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl?: string;
  createdAt?: number;
  categories?: { team?: string; department?: string; location?: string; commitment?: string };
  descriptionPlain?: string;
}

export async function fetchLeverJobs(
  fetcher: Fetcher,
  slug: string,
  region?: "eu",
  userAgent?: string,
): Promise<JobPosting[]> {
  const host = region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const out: JobPosting[] = [];
  const limit = 100;
  for (let skip = 0; skip < 1000; skip += limit) {
    const page = await getJson<LeverPosting[]>(
      fetcher,
      "lever",
      `https://${host}/v0/postings/${assertSlug(slug)}?mode=json&skip=${skip}&limit=${limit}`,
      userAgent,
    );
    for (const p of page) {
      out.push({
        source: "LEVER",
        externalId: `${slug}:${p.id}`,
        title: p.text,
        department: p.categories?.department ?? p.categories?.team ?? null,
        location: p.categories?.location ?? null,
        url: p.hostedUrl ?? null,
        postedAt: date(p.createdAt),
        descriptionExcerpt: stripHtml(p.descriptionPlain),
      });
    }
    if (page.length < limit) break;
  }
  return out;
}

interface AshbyResponse {
  jobs?: {
    id: string;
    title: string;
    department?: string;
    team?: string;
    location?: string;
    jobUrl?: string;
    publishedAt?: string;
    isListed?: boolean;
    descriptionPlain?: string;
  }[];
}

export async function fetchAshbyJobs(fetcher: Fetcher, slug: string, userAgent?: string): Promise<JobPosting[]> {
  const data = await getJson<AshbyResponse>(
    fetcher,
    "ashby",
    `https://api.ashbyhq.com/posting-api/job-board/${assertSlug(slug)}`,
    userAgent,
  );
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      source: "ASHBY" as const,
      externalId: `${slug}:${j.id}`,
      title: j.title,
      department: j.department ?? j.team ?? null,
      location: j.location ?? null,
      url: j.jobUrl ?? null,
      postedAt: date(j.publishedAt),
      descriptionExcerpt: stripHtml(j.descriptionPlain),
    }));
}

export async function fetchJobsForBoard(
  fetcher: Fetcher,
  provider: string,
  slug: string,
  userAgent?: string,
): Promise<JobPosting[]> {
  switch (provider) {
    case "GREENHOUSE":
      return fetchGreenhouseJobs(fetcher, slug, userAgent);
    case "LEVER":
      return fetchLeverJobs(fetcher, slug.replace(/^eu:/, ""), slug.startsWith("eu:") ? "eu" : undefined, userAgent);
    case "LEVER_EU":
      return fetchLeverJobs(fetcher, slug, "eu", userAgent);
    case "ASHBY":
      return fetchAshbyJobs(fetcher, slug, userAgent);
    default:
      throw new Error(`Unknown job board provider: ${provider}`);
  }
}
