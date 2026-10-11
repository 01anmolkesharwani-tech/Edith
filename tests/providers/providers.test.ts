import { describe, expect, it } from "vitest";
import { RobotsCache } from "@/lib/net/robots";
import { HostThrottle, type FetchOptions, type Fetcher } from "@/lib/net/safe-fetch";
import { braveSearch } from "@/lib/providers/brave";
import { hunterVerify } from "@/lib/providers/hunter";
import { fetchAshbyJobs, fetchGreenhouseJobs, fetchLeverJobs } from "@/lib/providers/job-boards";
import { buildContactQueries, searchLinks } from "@/lib/providers/search-links";
import { ProviderError } from "@/lib/providers/types";
import { researchWebsite } from "@/lib/providers/website";
import { companiesByIndustry, searchEntities } from "@/lib/providers/wikidata";
import { fixtureFetcher } from "../helpers/fixtures";

const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body), contentType: "application/json" });

describe("job boards", () => {
  it("parses Greenhouse postings", async () => {
    const { fetcher, calls } = fixtureFetcher({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": json({
        jobs: [{ id: 1, title: "Brand Manager", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", location: { name: "Mumbai" }, departments: [{ name: "Marketing" }], content: "&lt;p&gt;Own the brand&lt;/p&gt;", first_published: "2026-09-01T00:00:00Z" }],
      }),
    });
    const jobs = await fetchGreenhouseJobs(fetcher, "acme");
    expect(jobs[0]).toMatchObject({ source: "GREENHOUSE", externalId: "acme:1", title: "Brand Manager", department: "Marketing", location: "Mumbai", descriptionExcerpt: "Own the brand" });
    expect(calls[0].opts?.allowedTypes).toContain("application/json");
  });

  it("paginates Lever and supports the EU host", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, text: `Analyst ${i}`, categories: { team: "IB" } }));
    const { fetcher } = fixtureFetcher({
      "https://api.eu.lever.co/v0/postings/bank?mode=json&skip=0&limit=100": json(page1),
      "https://api.eu.lever.co/v0/postings/bank?mode=json&skip=100&limit=100": json([{ id: "z", text: "Associate", createdAt: 1767225600000 }]),
    });
    const jobs = await fetchLeverJobs(fetcher, "bank", "eu");
    expect(jobs).toHaveLength(101);
    expect(jobs[0].department).toBe("IB");
  });

  it("skips unlisted Ashby jobs", async () => {
    const { fetcher } = fixtureFetcher({
      "https://api.ashbyhq.com/posting-api/job-board/startup": json({ jobs: [{ id: "1", title: "Growth Marketer", isListed: true }, { id: "2", title: "Hidden", isListed: false }] }),
    });
    expect((await fetchAshbyJobs(fetcher, "startup")).map((j) => j.title)).toEqual(["Growth Marketer"]);
  });

  it("maps HTTP errors to provider errors", async () => {
    const { fetcher } = fixtureFetcher({ "https://boards-api.greenhouse.io/v1/boards/limited/jobs?content=true": { status: 429, body: "", headers: { "retry-after": "30" } } });
    await expect(fetchGreenhouseJobs(fetcher, "missing")).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await expect(fetchGreenhouseJobs(fetcher, "limited")).rejects.toMatchObject({ kind: "RATE_LIMITED", retryAfterSeconds: 30 });
  });

  it("rejects malformed board identifiers", async () => {
    const { fetcher } = fixtureFetcher({});
    await expect(fetchGreenhouseJobs(fetcher, "../../etc")).rejects.toThrow(/Invalid/);
  });
});

describe("wikidata", () => {
  it("searches entities and queries companies by industry", async () => {
    const calls: { url: string; opts?: FetchOptions }[] = [];
    const common = { finalUrl: "", truncated: false, headers: {}, retrievedAt: new Date() };
    const f: Fetcher = async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes("wbsearchentities")) return { ...common, url, status: 200, contentType: "application/json", body: JSON.stringify({ search: [{ id: "Q1234", label: "food industry" }] }) };
      return {
        ...common,
        url,
        status: 200,
        contentType: "application/sparql-results+json",
        body: JSON.stringify({
          results: { bindings: [{ company: { value: "http://www.wikidata.org/entity/Q42" }, companyLabel: { value: "Acme Foods" }, website: { value: "https://acmefoods.com" }, industryLabel: { value: "food industry" }, employees: { value: "5000" } }] },
        }),
      };
    };
    const ents = await searchEntities(f, "food", "UA");
    expect(ents[0].id).toBe("Q1234");
    const companies = await companiesByIndustry(f, "UA", "Q1234", null);
    expect(companies[0]).toMatchObject({ wikidataId: "Q42", name: "Acme Foods", website: "https://acmefoods.com", employees: 5000, sourceUrl: "https://www.wikidata.org/wiki/Q42" });
    expect(calls.every((c) => c.opts?.userAgent === "UA")).toBe(true);
  });
  it("refuses non-QID input (no SPARQL injection)", async () => {
    const { fetcher } = fixtureFetcher({});
    await expect(companiesByIndustry(fetcher, "UA", "Q1 } DELETE {", null)).rejects.toThrow(/Invalid/);
  });
});

describe("optional providers without keys", () => {
  it("Brave reports unavailable without an API key", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    await expect(braveSearch("x")).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });
  it("Hunter reports unavailable without an API key", async () => {
    delete process.env.HUNTER_API_KEY;
    await expect(hunterVerify("a@b.com")).rejects.toBeInstanceOf(ProviderError);
  });
  it("Brave maps quota exhaustion", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test";
    await expect(braveSearch("x", async () => ({ status: 429, json: async () => ({}) }))).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    delete process.env.BRAVE_SEARCH_API_KEY;
  });
});

describe("manual research links", () => {
  it("builds editable queries and links, not contact records", () => {
    const q = buildContactQueries({ company: "Acme Foods", domain: "acmefoods.com", titles: ["brand manager"] });
    expect(q[0]).toBe('"Acme Foods" "brand manager"');
    expect(searchLinks(q[0])[0].url).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
  });
});

describe("official website research", () => {
  const home = `<html><head><meta name="description" content="Acme makes snacks."></head><body>
    <a href="/leadership">Leadership</a><a href="/careers">Careers</a><a href="/private/board">Board</a>
    <a href="https://www.linkedin.com/company/acme">LinkedIn</a></body></html>`;
  const leadership = `<html><body><div><h3>Priya Sharma</h3><p>Head of Marketing</p></div></body></html>`;
  const careers = `<html><body><a href="https://jobs.lever.co/acme">Open roles</a></body></html>`;

  function deps(pages: Parameters<typeof fixtureFetcher>[0]) {
    const { fetcher, calls } = fixtureFetcher(pages);
    return {
      calls,
      deps: {
        fetcher,
        robots: new RobotsCache(fetcher, "UA"),
        throttle: new HostThrottle(async () => undefined),
        userAgent: "UA",
        requestDelayMs: 0,
        maxPages: 5,
        timeoutMs: 1000,
        maxBytes: 100000,
      },
    };
  }

  it("fetches only relevant pages, respects robots.txt and finds people + ATS", async () => {
    const { deps: d, calls } = deps({
      "https://acme.com/robots.txt": { body: "User-agent: *\nDisallow: /private/", contentType: "text/plain" },
      "https://acme.com/": { body: home },
      "https://acme.com/leadership": { body: leadership },
      "https://acme.com/careers": { body: careers },
    });
    const r = await researchWebsite("acme.com", d);
    expect(r.pages.map((p) => p.category)).toEqual(["home", "leadership", "careers"]);
    expect(r.pages[1].people[0]).toMatchObject({ name: "Priya Sharma", title: "Head of Marketing" });
    expect(r.ats[0]).toMatchObject({ provider: "LEVER", slug: "acme" });
    expect(r.description).toBe("Acme makes snacks.");
    expect(calls.some((c) => c.url.includes("/private/"))).toBe(false);
    expect(calls.some((c) => c.url.includes("linkedin"))).toBe(false);
  });

  it("refuses to research a site when robots.txt cannot be read (5xx)", async () => {
    const { deps: d } = deps({ "https://acme.com/robots.txt": { status: 503, body: "" }, "https://acme.com/": { body: home } });
    await expect(researchWebsite("https://acme.com/", d)).rejects.toThrow(/robots/i);
  });

  it("refuses prohibited and private destinations", async () => {
    const { deps: d } = deps({});
    await expect(researchWebsite("https://www.linkedin.com/company/acme", d)).rejects.toThrow(/terms/);
    await expect(researchWebsite("http://127.0.0.1/", d)).rejects.toThrow();
  });
});
