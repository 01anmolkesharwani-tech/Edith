import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "@/lib/drafting/builtin-templates";
import { generateDraft, type GenerationInput } from "@/lib/drafting/generate";
import { render } from "@/lib/drafting/render";

const tpl = (type: string) => {
  const t = BUILTIN_TEMPLATES.find((x) => x.recipientType === type)!;
  return { recipientType: t.recipientType, subjects: t.subjects, body: t.body };
};

const base: GenerationInput = {
  candidate: { name: "Asha Verma", currentStatus: "An MBA candidate at Example Business School", signature: "asha@example.com", skills: ["consumer research", "Excel"], targetFunctions: ["brand", "marketing"], targetRoles: ["brand management"] },
  highlights: [
    { kind: "EXPERIENCE", title: "Marketing Intern", organization: "Snackco", summary: "Ran a consumer survey of 400 respondents.", capabilities: ["consumer research", "survey design"], tags: ["marketing"], confirmed: true },
    { kind: "ACHIEVEMENT", title: "Won national case competition", organization: null, summary: "Unconfirmed claim", capabilities: [], tags: [], confirmed: false },
  ],
  recipient: { id: "c1", fullName: "Priya Sharma", title: "Head of Marketing", department: null },
  company: { name: "Acme Foods" },
  companyResearch: [{ kind: "GROWTH_INITIATIVE", statement: "The launch of its millet-based snack range in 2026.", sourceUrl: "https://acme.com/news/1", confirmed: true }],
  recipientResearch: [],
  opportunity: null,
  template: tpl("FUNCTIONAL_LEADER"),
};

describe("renderer", () => {
  it("drops sections whose value is missing and reports missing variables", () => {
    const r = render("Hi {{name}}.{{#extra}} Extra: {{extra}}.{{/extra}}{{^extra}} None.{{/extra}} {{absent}}", { name: "A" });
    expect(r.text).toBe("Hi A. None.");
    expect(r.missing).toEqual(["absent"]);
  });
  it("does not evaluate code", () => {
    expect(render("{{constructor.constructor}}", {}).text).toBe("");
  });
});

describe("draft generation", () => {
  it("uses only verified, confirmed facts", () => {
    const d = generateDraft(base);
    expect(d.body).toContain("Asha Verma");
    expect(d.body).toContain("Marketing Intern at Snackco");
    expect(d.body).toContain("millet-based snack range");
    expect(d.body).not.toContain("case competition"); // unconfirmed highlight is never used
    expect(d.body).not.toMatch(/\{\{|\}\}/);
    expect(d.personalization.used.map((u) => u.label)).toEqual(expect.arrayContaining(["Experience (confirmed)", "Company research (confirmed)"]));
  });

  it("falls back to a neutral draft and lists the gaps", () => {
    const d = generateDraft({ ...base, highlights: [], companyResearch: [{ ...base.companyResearch[0], confirmed: false }] });
    expect(d.personalization.neutral).toBe(true);
    expect(d.personalization.gaps.join(" ")).toMatch(/No confirmed experience/);
    expect(d.personalization.gaps.join(" ")).toMatch(/No confirmed company research/);
    expect(d.body).not.toContain("millet");
    expect(d.body).not.toContain("I have been reading about");
  });

  it("blocks when the candidate name is missing instead of inventing one", () => {
    const d = generateDraft({ ...base, candidate: { ...base.candidate, name: null } });
    expect(d.personalization.blocking.length).toBe(1);
  });

  it("varies wording between recipients and on regeneration", () => {
    const bodies = new Set(
      ["a", "b", "c", "d", "e", "f"].map((id) => generateDraft({ ...base, recipient: { ...base.recipient, id }, template: tpl("RECRUITER") }).body),
    );
    expect(bodies.size).toBeGreaterThan(1);
    const v0 = generateDraft({ ...base, variant: 0, template: tpl("RECRUITER") });
    const variants = [1, 2, 3, 4].map((v) => generateDraft({ ...base, variant: v, template: tpl("RECRUITER") }));
    expect(variants.some((v) => v.body !== v0.body || v.subject !== v0.subject)).toBe(true);
  });

  it("produces several professional subject lines", () => {
    const d = generateDraft(base);
    expect(d.subjectAlternatives.length).toBeGreaterThanOrEqual(2);
    for (const s of d.subjectAlternatives) {
      expect(s).not.toMatch(/\{\{|!!|URGENT|re:/i);
      expect(s.length).toBeLessThan(110);
    }
  });

  it("uses a generic greeting when the recipient name is unknown", () => {
    const d = generateDraft({ ...base, recipient: { id: "x", fullName: null, title: null, department: null }, template: tpl("NETWORKING") });
    expect(d.body.startsWith("Dear Hiring Team,")).toBe(true);
  });

  it("covers every built-in recipient type without leftover placeholders", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const d = generateDraft({
        ...base,
        opportunity: { title: "Assistant Brand Manager", url: "https://jobs.example.com/1" },
        template: { recipientType: t.recipientType, subjects: t.subjects, body: t.body },
        followUp: t.recipientType === "FOLLOW_UP" ? { previousSubject: "Interest in brand roles", previousDate: new Date("2026-10-01"), attachResume: true } : null,
      });
      expect(d.body).not.toMatch(/\{\{|\}\}/);
      expect(d.body).toContain("Asha Verma");
    }
  });
});
