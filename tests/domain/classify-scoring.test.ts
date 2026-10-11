import { describe, expect, it } from "vitest";
import { classifyRecipientType, classifySeniority, looksLikeJobTitle } from "@/lib/domain/classify";
import { scoreContact, type ScoringProfile } from "@/lib/domain/scoring";

const marketing: ScoringProfile = {
  targetFunctions: ["marketing", "brand", "category", "consumer insights"],
  targetContactTitles: ["brand manager", "head of marketing", "talent acquisition"],
  targetIndustries: ["FMCG", "consumer goods", "food"],
  preferredLocations: ["Mumbai", "Bengaluru"],
  targetRoles: ["brand management", "marketing"],
};

const finance: ScoringProfile = {
  targetFunctions: ["investment banking", "corporate finance", "valuation", "M&A"],
  targetContactTitles: ["valuation director", "managing director", "finance recruiter"],
  targetIndustries: ["investment banking", "financial services"],
  preferredLocations: [],
  targetRoles: ["investment banking", "valuation"],
};

describe("title classification", () => {
  it.each([
    ["Talent Acquisition Manager", "RECRUITER"],
    ["Campus Recruiter", "RECRUITER"],
    ["Head of Marketing", "FUNCTIONAL_LEADER"],
    ["Chief Executive Officer", "BUSINESS_HEAD"],
    ["Managing Director, Investment Banking", "BUSINESS_HEAD"],
    ["Senior Brand Manager", "SENIOR"],
    ["Investment Banking Analyst", "JUNIOR"],
    [null, "NETWORKING"],
  ])("%s → %s", (title, type) => {
    expect(classifyRecipientType(title)).toBe(type);
  });

  it("treats Associate Director as senior, not junior", () => {
    expect(classifySeniority("Associate Director, Valuation")).toBe("SENIOR");
    expect(classifySeniority("Summer Analyst")).toBe("INTERN");
  });

  it("recognises job titles", () => {
    expect(looksLikeJobTitle("Category Head – Beverages")).toBe(true);
    expect(looksLikeJobTitle("Read our latest stories")).toBe(false);
  });
});

describe("relevance scoring", () => {
  it("returns an explainable breakdown that sums to the total", () => {
    const r = scoreContact(marketing, {
      contact: { title: "Brand Manager", location: "Mumbai" },
      company: { industry: "FMCG" },
      targetStatus: "TARGET",
      openingTitles: ["Assistant Brand Manager"],
      titleEvidence: { sourceType: "OFFICIAL_TEAM_PAGE", verificationMethod: "AUTOMATED_EXTRACTION" },
      emailStatus: "PUBLICLY_LISTED",
      hasEmail: true,
      freshness: "FRESH",
    });
    expect(r.components.map((c) => c.max)).toEqual([30, 20, 20, 15, 15]);
    expect(r.total).toBe(r.components.reduce((s, c) => s + c.points, 0));
    expect(r.total).toBeGreaterThanOrEqual(85);
    for (const c of r.components) expect(c.reasons.length).toBeGreaterThan(0);
  });

  it("does not treat missing data as irrelevance", () => {
    const r = scoreContact(marketing, { contact: {}, company: null });
    expect(r.components.find((c) => c.key === "role")!.points).toBeGreaterThan(0);
    expect(r.components.find((c) => c.key === "role")!.reasons[0]).toMatch(/unknown/i);
    expect(r.total).toBeGreaterThan(20);
  });

  it("values junior professionals in the target function for networking", () => {
    const junior = scoreContact(finance, { contact: { title: "Investment Banking Analyst" } });
    const unrelatedExec = scoreContact(finance, { contact: { title: "Chief Technology Officer" } });
    expect(junior.total).toBeGreaterThan(unrelatedExec.total);
  });

  it("adapts to the active profile", () => {
    const input = { contact: { title: "Valuation Director" } };
    expect(scoreContact(finance, input).total).toBeGreaterThan(scoreContact(marketing, input).total);
  });

  it("flags excluded companies", () => {
    const r = scoreContact(marketing, { contact: { title: "Brand Manager" }, company: { industry: "FMCG" }, targetStatus: "EXCLUDED" });
    expect(r.flags).toContain("EXCLUDED_COMPANY");
    expect(r.components.find((c) => c.key === "company")!.points).toBe(0);
  });
});
