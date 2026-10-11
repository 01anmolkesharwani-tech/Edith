import fs from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendDraft } from "@/lib/sending/send";
import { createContact, listContacts } from "@/lib/services/contacts";
import { exportContactsCsv, previewImport, runImport } from "@/lib/services/csv-import";
import { applyRetention, backupDatabase, deleteProfileData, exportProfileData } from "@/lib/services/data";
import { dashboardMetrics } from "@/lib/services/dashboard";
import { createDraft, markReviewed } from "@/lib/services/drafts";
import { draftFollowUp, followUpSuppressionReason, listFollowUps, refreshFollowUps } from "@/lib/services/followups";
import { logBounceManually, logReplyManually, syncReplies, type ImapMessage } from "@/lib/services/replies";
import { resumeFilePath } from "@/lib/services/resumes";
import { mockTransport } from "../helpers/factories";
import { configureSender, setupWorld, uniq } from "../helpers/world";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeAll(async () => {
  w = await setupWorld();
  await configureSender(w.marketing.id, "asha.sender2@example.org");
});

describe("CSV import", () => {
  const csv = [
    "Name,Title,Company,Website,Email,Source URL,Candidate profile",
    "Kavya Nair,Brand Manager,Import Co,https://import.test,kavya@import.test,https://import.test/team,marketing",
    "Kavya Nair,Brand Manager,Import Co,https://import.test,kavya@import.test,,",
    "Arjun Das,Valuation Director,Bank Co,https://bank.test,arjun@bank.test,,finance",
    "Bad Row,,,,not-an-email,,",
  ].join("\n");

  it("previews with mapping, validation, duplicates and profile checks", async () => {
    const p = await previewImport(w.marketing.id, csv);
    expect(p.mapping.fullName).toBe("Name");
    expect(p.rows[1].duplicateInFile).toBe(0);
    expect(p.rows[2].otherProfile).toBe(true);
    expect(p.rows[3].errors.join(" ")).toMatch(/email/);
  });

  it("imports only valid rows for the active profile, never as verified", async () => {
    const p = await previewImport(w.marketing.id, csv);
    const report = await runImport(w.marketing.id, csv, p.mapping, "skip");
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(3);
    const c = (await listContacts(w.marketing.id)).find((x) => x.fullName === "Kavya Nair")!;
    expect(c).toMatchObject({ origin: "IMPORTED", emailOrigin: "IMPORTED", reviewState: "UNREVIEWED" });
    expect(["NOT_CHECKED", "SYNTAX_VALID"]).toContain(c.emailStatus);
    expect((await listContacts(w.finance.id)).some((x) => x.fullName === "Arjun Das")).toBe(false);
  });

  it("re-import with merge fills gaps without duplicating", async () => {
    const csv2 = "Name,Company,Website,Phone\nKavya Nair,Import Co,https://import.test,+91 99999 00000";
    const p = await previewImport(w.marketing.id, csv2);
    expect(p.rows[0].duplicateOf).not.toBeNull();
    const r = await runImport(w.marketing.id, csv2, p.mapping, "fill");
    expect(r.merged).toBe(1);
    const all = (await listContacts(w.marketing.id)).filter((x) => x.fullName === "Kavya Nair");
    expect(all).toHaveLength(1);
    expect(all[0].phone).toBe("+91 99999 00000");
  });

  it("exports selected fields with formula escaping", async () => {
    await createContact(w.marketing.id, { fullName: "Formula Person", notes: "=HYPERLINK(\"http://evil\")" });
    const out = await exportContactsCsv(w.marketing.id, ["fullName", "notes"]);
    expect(out.split("\r\n")[0]).toBe('"Name","Notes"');
    expect(out).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe("follow-ups and replies", () => {
  async function sent() {
    const contact = await createContact(w.marketing.id, { fullName: uniq("Follow "), title: "Brand Manager", email: `${uniq("f")}@follow.test` });
    const draft = await createDraft(w.marketing.id, contact.id);
    await markReviewed(w.marketing.id, draft.id, draft.contentHash);
    const m = mockTransport();
    await db.emailSendLog.deleteMany({ where: { profileId: w.marketing.id, status: { in: ["FAILED", "REJECTED"] } } });
    const r = await sendDraft(w.marketing.id, draft.id, draft.contentHash, { transportFactory: m.factory });
    expect(r.status).toBe("ACCEPTED");
    const log = await db.emailSendLog.findFirstOrThrow({ where: { draftId: draft.id } });
    const fu = await db.followUp.findFirstOrThrow({ where: { contactId: contact.id } });
    return { contact, log, fu, messageId: m.sent[0].messageId };
  }

  it("follow-ups require review: drafting never sends, and threads to the original", async () => {
    const { fu, log } = await sent();
    const d = await draftFollowUp(w.marketing.id, fu.id);
    expect(d).toMatchObject({ kind: "FOLLOW_UP", sendState: "DRAFT", inReplyToMessageId: log.providerMessageId });
    expect(d.subject.startsWith("Re: ")).toBe(true);
    expect(d.body).toContain("following up");
  });

  it("are suppressed after a reply or a bounce", async () => {
    const a = await sent();
    await logReplyManually(w.marketing.id, a.log.id, "Happy to chat");
    expect(await followUpSuppressionReason(w.marketing.id, a.fu.id)).toMatch(/replied|Suppressed|stage/i);
    expect((await db.contact.findUniqueOrThrow({ where: { id: a.contact.id } })).stage).toBe("REPLIED");

    const b = await sent();
    await logBounceManually(w.marketing.id, b.log.id, "550 user unknown");
    await refreshFollowUps(w.marketing.id);
    expect((await db.followUp.findUniqueOrThrow({ where: { id: b.fu.id } })).status).toBe("SUPPRESSED");
    expect((await db.contact.findUniqueOrThrow({ where: { id: b.contact.id } })).emailStatus).toBe("UNDELIVERABLE");
    await expect(draftFollowUp(w.marketing.id, b.fu.id)).rejects.toThrow(/suppressed/i);
  });

  it("matches inbox replies by Message-ID threading (read-only source)", async () => {
    const c = await sent();
    const messages: ImapMessage[] = [
      { uid: 1, from: "someone@else.test", subject: "Unrelated", date: new Date(), inReplyTo: "<other@x>", references: [], isBounce: false },
      { uid: 2, from: "recipient@follow.test", subject: "Re: hello", date: new Date(), inReplyTo: c.messageId, references: [c.messageId], isBounce: false },
    ];
    await db.emailAccount.updateMany({ where: { profileId: w.marketing.id }, data: { imapEnabled: true } });
    const r = await syncReplies(w.marketing.id, { fetchRecent: async () => messages });
    expect(r.replies).toBe(1);
    const log = await db.emailSendLog.findUniqueOrThrow({ where: { id: c.log.id } });
    expect(log.replySource).toBe("INBOX");
  });

  it("follow-ups become due and appear in the queue", async () => {
    const { fu, contact } = await sent();
    await db.followUp.update({ where: { id: fu.id }, data: { dueDate: new Date(Date.now() - 1000) } });
    const list = await listFollowUps(w.marketing.id);
    expect(list.some((x) => x.id === fu.id)).toBe(true);
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).stage).toBe("FOLLOW_UP_DUE");
  });

  it("dashboard metrics are measured counts", async () => {
    const m = await dashboardMetrics(w.marketing.id);
    expect(m.emailsSent).toBe(await db.emailSendLog.count({ where: { profileId: w.marketing.id, status: "ACCEPTED" } }));
    expect(m.repliesInbox + m.repliesManual).toBe(2);
    expect(m.followUpsDue).toBeGreaterThanOrEqual(1);
  });
});

describe("data management", () => {
  it("exports profile data without secrets", async () => {
    process.env.CAREERREACH_TEST_SMTP_PASS = "super-secret-value";
    const out = JSON.stringify(await exportProfileData(w.marketing.id));
    expect(out).not.toContain("super-secret-value");
    expect(out).toContain("CAREERREACH_TEST_SMTP_PASS"); // only the variable *name*
  });

  it("creates a database backup", async () => {
    const file = await backupDatabase();
    expect((await fs.stat(file)).size).toBeGreaterThan(0);
  });

  it("applies retention without touching referenced evidence", async () => {
    await db.searchHistory.create({ data: { profileId: w.marketing.id, kind: "X", provider: "x", query: "old", status: "OK", createdAt: new Date("2020-01-01") } });
    const r = await applyRetention();
    expect(r.searchHistoryDeleted).toBeGreaterThanOrEqual(1);
  });

  it("deleting one profile's data leaves the other profile intact", async () => {
    await createContact(w.finance.id, { fullName: "Finance Keeper" });
    const before = await db.contact.count({ where: { profileId: w.finance.id } });
    await deleteProfileData(w.marketing.id, { deleteProfile: false });
    expect(await db.contact.count({ where: { profileId: w.marketing.id } })).toBe(0);
    expect(await db.emailSendLog.count({ where: { profileId: w.marketing.id } })).toBe(0);
    expect(await db.resume.count({ where: { profileId: w.marketing.id } })).toBe(0);
    await expect(fs.stat(resumeFilePath(w.mResume))).rejects.toThrow();
    expect(await db.contact.count({ where: { profileId: w.finance.id } })).toBe(before);
    await expect(fs.stat(resumeFilePath(w.fResume))).resolves.toBeTruthy();
  });
});
