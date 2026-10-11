import { describe, expect, it } from "vitest";
import { detectConflicts } from "@/lib/domain/conflicts";
import { findDuplicates } from "@/lib/domain/dedupe";
import { categorize, contactFreshness, effectiveEvidenceDate } from "@/lib/domain/freshness";

const now = new Date("2026-10-11T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("freshness", () => {
  it.each([
    [10, "FRESH"],
    [45, "RECENT"],
    [120, "AGING"],
    [400, "STALE"],
  ])("%i days → %s", (d, cat) => {
    expect(categorize(daysAgo(d), now)).toBe(cat);
  });

  it("is UNKNOWN without timestamps", () => {
    expect(categorize(null, now)).toBe("UNKNOWN");
  });

  it("does not treat a recently retrieved old announcement as current", () => {
    const d = effectiveEvidenceDate({ sourceType: "OFFICIAL_ANNOUNCEMENT", observedAt: daysAgo(1), publishedAt: daysAgo(500) });
    expect(categorize(d, now)).toBe("STALE");
  });

  it("treats undated publications as unknown age", () => {
    expect(effectiveEvidenceDate({ sourceType: "NEWS_ARTICLE", observedAt: daysAgo(1) })).toBeNull();
  });

  it("treats a live team page as current at retrieval time", () => {
    const d = effectiveEvidenceDate({ sourceType: "OFFICIAL_TEAM_PAGE", observedAt: daysAgo(2) });
    expect(categorize(d, now)).toBe("FRESH");
  });

  it("does not trust a live page whose own update date is very old", () => {
    const d = effectiveEvidenceDate({ sourceType: "OFFICIAL_TEAM_PAGE", observedAt: daysAgo(2), publishedAt: daysAgo(900) });
    expect(categorize(d, now)).toBe("STALE");
  });

  it("tracks role, email and phone separately", () => {
    const f = contactFreshness(
      [
        { field: "TITLE", sourceType: "OFFICIAL_TEAM_PAGE", observedAt: daysAgo(5) },
        { field: "EMAIL", sourceType: "NEWS_ARTICLE", observedAt: daysAgo(5), publishedAt: daysAgo(300) },
      ],
      daysAgo(100),
      now,
    );
    expect(f.role).toBe("FRESH");
    expect(f.email).toBe("STALE");
    expect(f.phone).toBe("UNKNOWN");
    expect(f.emailValidation).toBe("AGING");
  });
});

describe("conflict detection", () => {
  it("flags contradictory titles and companies", () => {
    const r = detectConflicts(
      [
        { field: "TITLE", value: "Brand Manager", sourceType: "OFFICIAL_TEAM_PAGE", sourceUrl: "https://a.com/team", observedAt: daysAgo(10) },
        { field: "TITLE", value: "Marketing Director", sourceType: "NEWS_ARTICLE", sourceUrl: "https://news.com/x", observedAt: daysAgo(3) },
        { field: "COMPANY", value: "Acme Ltd", sourceType: "OFFICIAL_TEAM_PAGE", observedAt: daysAgo(10) },
        { field: "COMPANY", value: "Other Corp", sourceType: "NEWS_ARTICLE", observedAt: daysAgo(3) },
      ],
      { title: "Brand Manager", company: "Acme" },
    );
    expect(r.some((x) => /conflicting title/i.test(x))).toBe(true);
    expect(r.some((x) => /conflicting company/i.test(x))).toBe(true);
  });

  it("ignores formatting-only differences", () => {
    const r = detectConflicts(
      [
        { field: "COMPANY", value: "Acme Limited", sourceType: "OFFICIAL_TEAM_PAGE", observedAt: daysAgo(1) },
        { field: "COMPANY", value: "ACME", sourceType: "USER_PROVIDED", observedAt: daysAgo(2) },
      ],
      { company: "Acme" },
    );
    expect(r).toEqual([]);
  });
});

describe("duplicate detection", () => {
  const pool = [
    { id: "1", fullName: "Priya Sharma", companyId: "c1", email: "priya.sharma@acme.com" },
    { id: "2", fullName: "Rahul Mehta", companyId: "c2", email: null, profileUrl: "https://www.linkedin.com/in/rahul/" },
  ];
  it("matches by email (case-insensitive)", () => {
    expect(findDuplicates({ fullName: "P. Sharma", companyId: null, email: "PRIYA.SHARMA@acme.com" }, pool)[0]).toMatchObject({ id: "1", reason: "EMAIL" });
  });
  it("matches by name + company even without email", () => {
    expect(findDuplicates({ fullName: "Dr. Priya  Sharma", companyId: "c1" }, pool)[0]).toMatchObject({ id: "1", reason: "NAME_AND_COMPANY", strength: "STRONG" });
  });
  it("does not use email as the only identifier: same name at another company is not a strong match", () => {
    expect(findDuplicates({ fullName: "Priya Sharma", companyId: "c9" }, pool)).toEqual([]);
  });
  it("matches by profile URL", () => {
    expect(findDuplicates({ fullName: "R Mehta", companyId: null, profileUrl: "http://linkedin.com/in/rahul" }, pool)[0]).toMatchObject({ id: "2", reason: "PROFILE_URL" });
  });
});
