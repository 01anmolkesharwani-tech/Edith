import fs from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProfile, listProfiles } from "@/lib/services/profiles";
import { deleteResume, getResume, isPdf, listResumes, readResumeFile, resumeFilePath, safeFilename, saveResume, setDefaultResume, suggestHighlightsFromText } from "@/lib/services/resumes";
import { makePdf } from "../helpers/fixtures";
import { setupWorld } from "../helpers/world";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeAll(async () => {
  w = await setupWorld();
});

describe("profiles", () => {
  it("creates two independent default portals without invented personal data", async () => {
    const all = await listProfiles();
    expect(all.map((p) => p.slug)).toEqual(expect.arrayContaining(["marketing", "finance"]));
    const fresh = await createProfile({ portalName: "Consulting", slug: "consulting" });
    expect(fresh.candidateName).toBeNull();
    expect(fresh.education).toBeNull();
  });
});

describe("résumés", () => {
  it("are associated with exactly one profile and stored outside public/", async () => {
    expect(w.mResume.profileId).toBe(w.marketing.id);
    expect(resumeFilePath(w.mResume)).not.toContain(`${process.cwd()}/public`);
    await expect(fs.stat(resumeFilePath(w.mResume))).resolves.toBeTruthy();
  });

  it("the first upload becomes the default", async () => {
    expect(w.mResume.isDefault).toBe(true);
  });

  it("cannot be read through another profile", async () => {
    await expect(getResume(w.finance.id, w.mResume.id)).rejects.toThrow(/not found/i);
    await expect(readResumeFile(w.finance.id, w.mResume.id)).rejects.toThrow();
    expect((await listResumes(w.finance.id)).some((r) => r.id === w.mResume.id)).toBe(false);
  });

  it("validates type and size by content, and sanitises filenames", async () => {
    await expect(saveResume(w.marketing.id, { name: "evil.pdf", bytes: new TextEncoder().encode("<html>") }, "x")).rejects.toThrow(/PDF/);
    await expect(saveResume(w.marketing.id, { name: "big.pdf", bytes: new Uint8Array(6 * 1024 * 1024).fill(0x25) }, "x")).rejects.toThrow(/5 MB/);
    expect(safeFilename("../../etc/passwd")).toBe("passwd.pdf");
    expect(safeFilename("My CV (final).PDF")).toBe("My CV _final_.PDF");
    expect(isPdf(makePdf("x"))).toBe(true);
  });

  it("supports labelled versions and switching the default", async () => {
    const v2 = await saveResume(w.marketing.id, { name: "brand.pdf", bytes: makePdf("Brand version") }, "Brand");
    await setDefaultResume(w.marketing.id, v2.id);
    const list = await listResumes(w.marketing.id);
    expect(list.filter((r) => r.isDefault).map((r) => r.id)).toEqual([v2.id]);
    await expect(setDefaultResume(w.finance.id, v2.id)).rejects.toThrow();
  });

  it("extracts text and only suggests (never confirms) highlights", async () => {
    const r = await saveResume(w.finance.id, { name: "t.pdf", bytes: makePdf("Valuation Intern at Example Capital, built DCF models") }, "Valuation");
    expect(r.extractedText ?? "").toContain("Valuation Intern");
    const s = suggestHighlightsFromText("• Valuation Intern at Example Capital, built DCF models\n• MBA, Example University");
    expect(s.map((x) => x.kind)).toEqual(["EXPERIENCE", "EDUCATION"]);
    expect(await db.profileHighlight.count({ where: { profileId: w.finance.id } })).toBe(0);
  });

  it("deletion removes the file", async () => {
    const r = await saveResume(w.finance.id, { name: "old.pdf", bytes: makePdf("old") }, "Old");
    await deleteResume(w.finance.id, r.id);
    await expect(fs.stat(resumeFilePath(r))).rejects.toThrow();
  });
});
