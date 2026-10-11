import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { linkCompany, upsertCompany } from "@/lib/services/companies";
import {
  addEvidence,
  changeStage,
  confirmCurrentRole,
  createContact,
  DuplicateContactError,
  getContactDetail,
  listContacts,
  mergeContacts,
} from "@/lib/services/contacts";
import { applyEmailGuess, emailGuesses, runEmailChecks } from "@/lib/services/verification";
import { suppressionFor } from "@/lib/services/suppression";
import type { DnsResolver } from "@/lib/email/validation";
import { setupWorld, uniq } from "../helpers/world";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeAll(async () => {
  w = await setupWorld();
});

const mxResolver: DnsResolver = {
  resolveMx: async () => [{ exchange: "mx.acme.test", priority: 10 }],
  resolve4: async () => [],
  resolve6: async () => [],
};

describe("companies", () => {
  it("are shared and deduplicated by domain", async () => {
    const a = await upsertCompany({ name: "Acme Foods", website: "https://www.acmefoods.test/" });
    const b = await upsertCompany({ name: "Acme Foods Pvt Ltd", website: "acmefoods.test", industry: "FMCG" });
    expect(b.id).toBe(a.id);
    expect(b.industry).toBe("FMCG");
  });
  it("profile links are independent (target in one, excluded in the other)", async () => {
    const c = await upsertCompany({ name: uniq("Co"), website: `${uniq("d")}.test` });
    await linkCompany(w.marketing.id, c.id, "TARGET");
    await linkCompany(w.finance.id, c.id, "EXCLUDED");
    const links = await db.profileCompany.findMany({ where: { companyId: c.id } });
    expect(links.map((l) => l.status).sort()).toEqual(["EXCLUDED", "TARGET"]);
  });
});

describe("contacts", () => {
  it("manual creation records field-level evidence labelled MANUAL", async () => {
    const company = await upsertCompany({ name: "Evidence Co", website: "evidence.test" });
    const c = await createContact(w.marketing.id, {
      fullName: "Priya Sharma",
      title: "Brand Manager",
      companyId: company.id,
      email: "priya@evidence.test",
      sourceUrl: "https://evidence.test/team",
      sourceType: "OFFICIAL_TEAM_PAGE",
    });
    const detail = await getContactDetail(w.marketing.id, c.id);
    const fields = detail.evidence.map((e) => e.field).sort();
    expect(fields).toEqual(["COMPANY", "EMAIL", "NAME", "TITLE"]);
    expect(detail.evidence.every((e) => e.origin === "MANUAL" && e.verificationMethod === "MANUAL_ENTRY")).toBe(true);
    expect(c.origin).toBe("MANUAL");
    expect(c.relevanceScore).toBeGreaterThan(0);
    expect(JSON.parse(c.relevanceBreakdown!).components).toHaveLength(5);
  });

  it("missing fields stay missing", async () => {
    const c = await createContact(w.marketing.id, { fullName: "Only Name Person" });
    expect([c.email, c.phone, c.title, c.companyId]).toEqual([null, null, null, null]);
    expect(c.emailStatus).toBe("NOT_CHECKED");
  });

  it("detects duplicates within a profile but not across profiles", async () => {
    const company = await upsertCompany({ name: "Dup Co", website: "dup.test" });
    await createContact(w.marketing.id, { fullName: "Rahul Mehta", companyId: company.id });
    await expect(createContact(w.marketing.id, { fullName: "Rahul  Mehta", companyId: company.id })).rejects.toBeInstanceOf(DuplicateContactError);
    await expect(createContact(w.finance.id, { fullName: "Rahul Mehta", companyId: company.id })).resolves.toBeTruthy();
  });

  it("keeps contacts isolated per profile", async () => {
    const c = await createContact(w.finance.id, { fullName: uniq("Finance Person ") });
    expect((await listContacts(w.marketing.id)).some((x) => x.id === c.id)).toBe(false);
    await expect(getContactDetail(w.marketing.id, c.id)).rejects.toThrow(/not found/i);
    await expect(changeStage(w.marketing.id, c.id, "SENT")).rejects.toThrow();
  });

  it("merging preserves evidence and history", async () => {
    const a = await createContact(w.marketing.id, { fullName: "Merge Target", title: "Brand Manager" });
    const b = await createContact(w.marketing.id, { fullName: "Merge Source", email: "merge@x.test" }, { allowDuplicate: true });
    await addEvidence(w.marketing.id, b.id, { field: "TITLE", value: "Brand Lead", sourceType: "NEWS_ARTICLE", sourceUrl: "https://news.test/a" });
    await mergeContacts(w.marketing.id, a.id, b.id);
    const merged = await getContactDetail(w.marketing.id, a.id);
    expect(merged.email).toBe("merge@x.test");
    expect(merged.evidence.length).toBeGreaterThanOrEqual(5);
    expect(merged.activities.some((x) => x.type === "MERGE")).toBe(true);
    const tomb = await db.contact.findUniqueOrThrow({ where: { id: b.id } });
    expect(tomb.mergedIntoId).toBe(a.id);
    expect((await listContacts(w.marketing.id)).some((x) => x.id === b.id)).toBe(false);
    // Conflicting titles from different sources are flagged for review.
    expect(JSON.parse(merged.reviewReasons).join(" ")).toMatch(/Conflicting title/);
  });

  it("assesses title and email independently (official bio does not verify email)", async () => {
    const company = await upsertCompany({ name: "Indep Co", website: "indep.test" });
    const c = await createContact(w.marketing.id, { fullName: "Anita Rao", title: "Category Manager", companyId: company.id, email: "anita@indep.test", sourceType: "OFFICIAL_BIO", sourceUrl: "https://indep.test/bio" });
    // The email was entered with the bio as source, but MANUAL entry is not an observed public listing.
    expect(c.emailStatus).toBe("NOT_CHECKED");
    await runEmailChecks(w.marketing.id, c.id, {}, { resolver: mxResolver });
    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.emailStatus).toBe("DOMAIN_CONFIGURED");
  });

  it("runs email checks without a provider and records each stage", async () => {
    const c = await createContact(w.marketing.id, { fullName: uniq("Check Person "), email: "check@acme.test" });
    const records = await runEmailChecks(w.marketing.id, c.id, { provider: true, smtp: true }, { resolver: mxResolver });
    const stages = Object.fromEntries(records.map((r) => [r.stage, r.result]));
    expect(stages).toMatchObject({ SYNTAX: "PASS", DOMAIN: "PASS", MX: "PASS", PUBLIC_MATCH: "INCONCLUSIVE", PROVIDER: "SKIPPED", SMTP_DIAGNOSTIC: "SKIPPED" });
  });

  it("pattern guesses are stored as uncertain", async () => {
    const company = await upsertCompany({ name: "Guess Co", website: "guess.test" });
    const known = await createContact(w.marketing.id, { fullName: "Known Person", companyId: company.id });
    await db.contactFieldEvidence.create({
      data: { contactId: known.id, field: "EMAIL", value: "known.person@guess.test", sourceType: "OFFICIAL_TEAM_PAGE", sourceUrl: "https://guess.test/team", verificationMethod: "EXACT_MATCH_ON_PAGE", confidence: "MEDIUM", origin: "AUTOMATED" },
    });
    const c = await createContact(w.marketing.id, { fullName: "Neha Gupta", companyId: company.id });
    const g = await emailGuesses(w.marketing.id, c.id);
    expect(g.inferred).toBe("neha.gupta@guess.test");
    await applyEmailGuess(w.marketing.id, c.id, g.inferred!);
    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.emailOrigin).toBe("PATTERN_GUESS");
    expect(after.emailStatus).toBe("UNCERTAIN");
  });

  it("confirming the current role adds user-confirmed evidence", async () => {
    const c = await createContact(w.marketing.id, { fullName: uniq("Role Person "), title: "Head of Marketing" });
    await confirmCurrentRole(w.marketing.id, c.id);
    const d = await getContactDetail(w.marketing.id, c.id);
    expect(d.evidence.some((e) => e.verificationMethod === "USER_CONFIRMED")).toBe(true);
    expect(d.roleConfirmedAt).not.toBeNull();
  });

  it("Do Not Contact adds a suppression record", async () => {
    const c = await createContact(w.marketing.id, { fullName: uniq("DNC Person "), email: "dnc@acme.test" });
    await changeStage(w.marketing.id, c.id, "DO_NOT_CONTACT", { note: "Asked not to be contacted" });
    expect(await suppressionFor(w.marketing.id, "DNC@acme.test")).not.toBeNull();
    expect(await suppressionFor(w.finance.id, "dnc@acme.test")).toBeNull();
  });
});
