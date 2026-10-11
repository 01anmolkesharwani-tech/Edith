/**
 * Official-website research. Fetches the homepage and a small number of relevant pages
 * (leadership/team, careers, about, news, contact) — never an indiscriminate crawl.
 * Respects robots.txt, applies per-host delays, and keeps the retrieved text as evidence.
 */
import { createHash } from "node:crypto";
import {
  categorizeLinks,
  detectAts,
  extractPage,
  extractPeople,
  type AtsReference,
  type ExtractedPerson,
  type LinkCategory,
  type PageLink,
} from "@/lib/extract/html";
import { crawlDelaySeconds, type RobotsCache } from "@/lib/net/robots";
import { FetchError, type Fetcher, type HostThrottle, UnsafeUrlError, validatePublicUrl } from "@/lib/net/safe-fetch";
import { isNeverFetchHost } from "./search-links";

export interface ResearchedPage {
  url: string;
  finalUrl: string;
  category: LinkCategory | "home";
  status: number;
  title: string | null;
  description: string | null;
  text: string;
  contentHash: string;
  publishedAt: Date | null;
  retrievedAt: Date;
  people: ExtractedPerson[];
  emails: { email: string; snippet: string }[];
  phones: { phone: string; snippet: string }[];
}

export interface WebsiteResearchResult {
  rootUrl: string;
  pages: ResearchedPage[];
  skipped: { url: string; reason: string }[];
  description: string | null;
  descriptionSourceUrl: string | null;
  careersUrl: string | null;
  leadershipUrl: string | null;
  ats: AtsReference[];
}

export interface WebsiteResearchDeps {
  fetcher: Fetcher;
  robots: RobotsCache;
  throttle: HostThrottle;
  userAgent: string;
  requestDelayMs: number;
  maxPages: number;
  timeoutMs: number;
  maxBytes: number;
}

const PLAN: [LinkCategory, number][] = [
  ["leadership", 3],
  ["careers", 2],
  ["about", 1],
  ["contact", 1],
  ["news", 1],
];

const PEOPLE_CATEGORIES = new Set<ResearchedPage["category"]>(["leadership", "about", "contact", "careers", "news", "home"]);

export class WebsiteResearchError extends Error {}

export async function researchWebsite(
  website: string,
  deps: WebsiteResearchDeps,
  extraUrls: string[] = [],
): Promise<WebsiteResearchResult> {
  let root: URL;
  try {
    root = validatePublicUrl(/^[a-z]+:\/\//i.test(website) ? website : `https://${website}`);
  } catch (e) {
    throw new WebsiteResearchError((e as Error).message);
  }
  if (isNeverFetchHost(root.hostname)) {
    throw new WebsiteResearchError(
      "This site's terms prohibit automated collection. Open it in your browser and add details manually.",
    );
  }

  const pages: ResearchedPage[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const robotsToken = "careerreachbot";

  interface Fetched {
    page: ResearchedPage;
    links: PageLink[];
    html: string;
  }

  const fetchPage = async (url: string, category: ResearchedPage["category"]): Promise<Fetched | null> => {
    let u: URL;
    try {
      u = validatePublicUrl(url);
    } catch (e) {
      skipped.push({ url, reason: (e as Error).message });
      return null;
    }
    if (isNeverFetchHost(u.hostname)) {
      skipped.push({ url, reason: "Site terms prohibit automated collection" });
      return null;
    }
    if (!(await deps.robots.allowed(u.toString(), robotsToken))) {
      skipped.push({ url, reason: "Disallowed by robots.txt" });
      return null;
    }
    const robots = await deps.robots.get(u.origin);
    const delay = Math.max(deps.requestDelayMs, (crawlDelaySeconds(robots, robotsToken) ?? 0) * 1000);
    await deps.throttle.wait(u.host, Math.min(delay, 30_000));
    try {
      const res = await deps.fetcher(u.toString(), {
        userAgent: deps.userAgent,
        timeoutMs: deps.timeoutMs,
        maxBytes: deps.maxBytes,
      });
      if (res.status < 200 || res.status >= 300) {
        skipped.push({ url, reason: `HTTP ${res.status}` });
        return null;
      }
      const extracted = extractPage(res.body, res.finalUrl);
      return {
        links: extracted.links,
        html: res.body,
        page: {
          url,
          finalUrl: res.finalUrl,
          category,
          status: res.status,
          title: extracted.title,
          description: extracted.description,
          text: extracted.text.slice(0, 60_000),
          contentHash: createHash("sha256").update(res.body).digest("hex"),
          publishedAt: extracted.publishedAt,
          retrievedAt: res.retrievedAt,
          people: PEOPLE_CATEGORIES.has(category) ? extractPeople(res.body, res.finalUrl) : [],
          emails: extracted.emails,
          phones: extracted.phones,
        },
      };
    } catch (e) {
      const reason = e instanceof UnsafeUrlError || e instanceof FetchError ? e.message : `Error: ${(e as Error).message}`;
      skipped.push({ url, reason });
      return null;
    }
  };

  const home = await fetchPage(root.toString(), "home");
  if (!home) {
    throw new WebsiteResearchError(`Homepage could not be retrieved: ${skipped.at(-1)?.reason ?? "unknown error"}`);
  }
  pages.push(home.page);
  const categories = categorizeLinks(home.links, home.page.finalUrl);
  const ats = detectAts(home.links, home.html);

  const queue: [string, LinkCategory][] = [];
  for (const u of extraUrls) queue.push([u, "leadership"]);
  for (const [cat, n] of PLAN) for (const href of categories[cat].slice(0, n)) queue.push([href, cat]);

  const seen = new Set([home.page.finalUrl, home.page.url]);
  for (const [href, cat] of queue) {
    if (pages.length >= deps.maxPages) break;
    if (seen.has(href)) continue;
    seen.add(href);
    const fetched = await fetchPage(href, cat);
    if (!fetched) continue;
    pages.push(fetched.page);
    if (cat === "careers") ats.push(...detectAts(fetched.links, fetched.html));
  }

  const uniqueAts = [...new Map(ats.map((a) => [`${a.provider}:${a.slug}`, a])).values()];
  const about = pages.find((p) => p.category === "about" && p.description) ?? (home.page.description ? home.page : null);

  return {
    rootUrl: home.page.finalUrl,
    pages,
    skipped,
    description: about?.description ?? null,
    descriptionSourceUrl: about?.finalUrl ?? null,
    careersUrl: categories.careers[0] ?? null,
    leadershipUrl: categories.leadership[0] ?? null,
    ats: uniqueAts,
  };
}
