import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { HostThrottle } from "@/lib/net/safe-fetch";
import { upsertCompany, linkCompany } from "@/lib/services/companies";
import { discoverCompanies, refreshCompanyJobs, researchCompanyWebsite, saveDiscoveredCompany, webSearch } from "@/lib/services/discovery";
import { getContactDetail, listContacts } from "@/lib/services/contacts";
import { runEmailChecks } from "@/lib/services/verification";
import { fixtureFetcher } from "../helpers/fixtures";
import { setupWorld } from "../helpers/world";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeAll(async () => {
  w = await setupWorld();
  await db.applicationSettings.upsert({ where: { id: 1 }, update: { requestDelayMs: 500 }, create: { id: 1, requestDelayMs: 500 } });
});

const noWait = new HostThrottle(async () => undefined);

const SITE = {
  "https://snackco.test/robots.txt": { body: "User-agent: *\nAllow: /", contentType: "text/plain" },
  "https://snackco.test/": {
    body: `<html><head><meta name="description" content="Snackco makes millet snacks."></head><body>
      <a href="/our-team">Our team</a><a href="/careers">Careers</a><a href="/contact">Contact</a>
      <p>Write to careers@snackco.test</p></body></html>`,
  },
  "https://snackco.test/our-team": {
    body: `<html><body>
      <div><h3>Priya Sharma</h3><p>Head of Marketing</p><a href="mailto:priya.sharma@snackco.test">Email</a></div>
      <div><h3>Ravi Kumar</h3><p>Chief Financial Officer</p></div></body></html>`,
  },
  "https://snackco.test/careers": { body: `<html><body><a href="https://boards.greenhouse.io/snackco">Jobs</a></body></html>` },
  "https://snackco.test/contact": { body: `<html><body><a href="tel:+912240001234">Call us</a></body></html>` },
  "https://boards-api.greenhouse.io/v1/boards/snackco/jobs?content=true": {
    contentType: "application/json",
    body: JSON.stringify({ jobs: [{ id: 7, title: "Assistant Brand Manager", absolute_url: "https://boards.greenhouse.io/snackco/jobs/7", location: { name: "Mumbai" } }] }),
  },
};

describe("official website discovery", () => {
  it("creates automated, review-required contacts with field-level evidence", async () => {
    const company = await upsertCompany({ name: "Snackco", website: "https://snackco.test/" });
    await linkCompany(w.marketing.id, company.id, "TARGET");
    const { fetcher } = fixtureFetcher(SITE);
    const summary = await researchCompanyWebsite(w.marketing.id, company.id, { fetcher, throttle: noWait });
    expect(summary.pagesFetched).toBe(4);
    expect(summary.contactsCreated).toBe(2);
    expect(summary.atsDetected).toEqual(["GREENHOUSE:snackco"]);
    expect(summary.jobsFound).toBe(1);

    const contacts = await listContacts(w.marketing.id, { companyId: company.id });
    const priya = contacts.find((c) => c.fullName === "Priya Sharma")!;
    expect(priya).toMatchObject({ origin: "AUTOMATED", reviewState: "UNREVIEWED", email: "priya.sharma@snackco.test", emailOrigin: "PUBLIC_SOURCE" });
    const detail = await getContactDetail(w.marketing.id, priya.id);
    const email = detail.evidence.find((e) => e.field === "EMAIL")!;
    expect(email).toMatchObject({ sourceUrl: "https://snackco.test/our-team", verificationMethod: "EXACT_MATCH_ON_PAGE", origin: "AUTOMATED" });
    expect(email.sourceDocumentId).toBeTruthy();
    expect(detail.evidence.find((e) => e.field === "TITLE")?.snippet).toContain("Head of Marketing");
    expect(priya.emailStatus).toBe("PUBLICLY_LISTED");
    // Marketing head should outrank the CFO for the marketing profile.
    const ravi = contacts.find((c) => c.fullName === "Ravi Kumar")!;
    expect(priya.relevanceScore!).toBeGreaterThan(ravi.relevanceScore!);

    // Shared inbox and switchboard are stored at company level, never on a person.
    const channels = await db.companyChannel.findMany({ where: { companyId: company.id } });
    expect(channels.map((c) => c.value)).toEqual(expect.arrayContaining(["careers@snackco.test", "+912240001234"]));
    expect(contacts.some((c) => c.email === "careers@snackco.test")).toBe(false);
    const link = await db.profileCompany.findFirstOrThrow({ where: { companyId: company.id, profileId: w.marketing.id } });
    expect(link.targetType).toBe("OPEN_ROLE");
  });

  it("re-running adds observations instead of duplicating contacts", async () => {
    const company = await db.company.findUniqueOrThrow({ where: { domain: "snackco.test" } });
    const { fetcher } = fixtureFetcher(SITE);
    const s = await researchCompanyWebsite(w.marketing.id, company.id, { fetcher, throttle: noWait });
    expect(s.contactsCreated).toBe(0);
    expect(s.contactsUpdated).toBe(2);
    expect((await listContacts(w.marketing.id, { companyId: company.id })).length).toBe(2);
  });

  it("discovered contacts go only to the active profile", async () => {
    const company = await db.company.findUniqueOrThrow({ where: { domain: "snackco.test" } });
    expect((await listContacts(w.finance.id, { companyId: company.id })).length).toBe(0);
  });

  it("public-match stage passes for an address the app observed", async () => {
    const c = (await listContacts(w.marketing.id)).find((x) => x.fullName === "Priya Sharma")!;
    const r = await runEmailChecks(w.marketing.id, c.id, {}, {
      resolver: { resolveMx: async () => [{ exchange: "mx.snackco.test", priority: 1 }], resolve4: async () => [], resolve6: async () => [] },
    });
    expect(r.find((x) => x.stage === "PUBLIC_MATCH")?.result).toBe("PASS");
  });

  it("job refresh closes postings that disappeared", async () => {
    const company = await db.company.findUniqueOrThrow({ where: { domain: "snackco.test" } });
    const { fetcher } = fixtureFetcher({
      "https://boards-api.greenhouse.io/v1/boards/snackco/jobs?content=true": { contentType: "application/json", body: JSON.stringify({ jobs: [] }) },
    });
    const r = await refreshCompanyJobs(w.marketing.id, company.id, { fetcher });
    expect(r).toMatchObject({ fetched: 0, open: 0, closed: 1 });
    const link = await db.profileCompany.findFirstOrThrow({ where: { companyId: company.id, profileId: w.marketing.id } });
    expect(link.targetType).toBe("SPECULATIVE");
  });

  it("an unreachable site fails gracefully and is logged", async () => {
    const company = await upsertCompany({ name: "Down Co", website: "https://down.test/" });
    await linkCompany(w.marketing.id, company.id, "TARGET");
    const { fetcher } = fixtureFetcher({ "https://down.test/robots.txt": { status: 404, body: "" } });
    await expect(researchCompanyWebsite(w.marketing.id, company.id, { fetcher, throttle: noWait })).rejects.toThrow(/Homepage could not be retrieved/);
    const h = await db.searchHistory.findFirstOrThrow({ where: { profileId: w.marketing.id, status: "ERROR" }, orderBy: { createdAt: "desc" } });
    expect(h.errorMessage).toMatch(/HTTP 404/);
  });
});

it("a profile cannot research a company it does not track", async () => {
  const company = await upsertCompany({ name: "Untracked Co", website: "https://untracked.test/" });
  const { fetcher, calls } = fixtureFetcher({});
  await expect(researchCompanyWebsite(w.finance.id, company.id, { fetcher, throttle: noWait })).rejects.toThrow(/not found/i);
  expect(calls).toHaveLength(0);
});

describe("company discovery via Wikidata", () => {
  it("lists candidates and saves the chosen one as an automated target", async () => {
    const { fetcher } = fixtureFetcher({});
    const f: typeof fetcher = async (url, opts) => {
      const base = await fetcher(url, opts);
      if (url.includes("wbsearchentities")) return { ...base, status: 200, contentType: "application/json", body: JSON.stringify({ search: [{ id: "Q99", label: "Example Bank" }] }) };
      return {
        ...base,
        status: 200,
        contentType: "application/sparql-results+json",
        body: JSON.stringify({ results: { bindings: [{ company: { value: "http://www.wikidata.org/entity/Q99" }, companyLabel: { value: "Example Bank" }, website: { value: "https://examplebank.test" }, industryLabel: { value: "investment banking" } }] } }),
      };
    };
    const r = await discoverCompanies(w.finance.id, { name: "Example Bank" }, { fetcher: f });
    expect(r.candidates[0]).toMatchObject({ name: "Example Bank", existingCompanyId: null });
    const saved = await saveDiscoveredCompany(w.finance.id, r.candidates[0]);
    expect(saved).toMatchObject({ origin: "AUTOMATED", wikidataId: "Q99", domain: "examplebank.test" });
  });

  it("reports provider failure without crashing", async () => {
    const { fetcher } = fixtureFetcher({});
    await expect(discoverCompanies(w.finance.id, { name: "Nothing" }, { fetcher })).rejects.toThrow(/Wikidata lookup failed/);
  });
});

describe("optional web search", () => {
  it("explains that it is not configured instead of failing", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    await expect(webSearch(w.marketing.id, "x")).rejects.toThrow(/not configured/);
  });
});
