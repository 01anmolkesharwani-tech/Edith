import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accountReadiness } from "@/lib/sending/accounts";
import { checkReadiness, resolveUnknownSend, sendDraft } from "@/lib/sending/send";
import { classifySendError } from "@/lib/sending/transport";
import { upsertCompany } from "@/lib/services/companies";
import { changeStage, createContact } from "@/lib/services/contacts";
import { createDraft, markReviewed, setAcknowledgements, updateDraft } from "@/lib/services/drafts";
import { addSuppression } from "@/lib/services/suppression";
import { mockTransport } from "../helpers/factories";
import { configureSender, setupWorld, uniq } from "../helpers/world";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeAll(async () => {
  w = await setupWorld();
  await configureSender(w.marketing.id, "asha.sender@example.org");
});

beforeEach(async () => {
  // Isolate limits/cooldowns between tests.
  await db.emailSendLog.deleteMany({ where: { profileId: w.marketing.id } });
});

async function readyDraft(profileId = w.marketing.id, email?: string) {
  const company = await upsertCompany({ name: uniq("Send Co "), website: `${uniq("send")}.test` });
  const contact = await createContact(profileId, { fullName: uniq("Recipient "), title: "Brand Manager", companyId: company.id, email: email ?? `${uniq("r")}@send.test` });
  const draft = await createDraft(profileId, contact.id);
  return { contact, draft };
}

async function review(draftId: string, profileId = w.marketing.id) {
  const d = await db.emailDraft.findUniqueOrThrow({ where: { id: draftId } });
  await markReviewed(profileId, draftId, d.contentHash);
  return d.contentHash;
}

describe("drafts", () => {
  it("are never sent automatically on creation", async () => {
    const m = mockTransport();
    const { draft } = await readyDraft();
    expect(draft.sendState).toBe("DRAFT");
    expect(m.sent).toHaveLength(0);
    expect(await db.emailSendLog.count({ where: { draftId: draft.id } })).toBe(0);
  });

  it("attach the active profile's default résumé, never the other candidate's", async () => {
    const { draft } = await readyDraft();
    expect(draft.resumeId).toBe(w.mResume.id);
    await expect(updateDraft(w.marketing.id, draft.id, { subject: "s", body: "b", recipientEmail: "x@send.test", resumeId: w.fResume.id })).rejects.toThrow(/does not belong/);
  });
});

describe("send approval", () => {
  it("requires an explicit review of the final content", async () => {
    const m = mockTransport();
    const { draft } = await readyDraft();
    const r = await sendDraft(w.marketing.id, draft.id, draft.contentHash, { transportFactory: m.factory });
    expect(r.status).toBe("BLOCKED");
    expect(r.message).toMatch(/Review/);
    expect(m.sent).toHaveLength(0);
  });

  it("sends exactly one email with the correct attachment after review", async () => {
    const m = mockTransport();
    const { draft, contact } = await readyDraft();
    const hash = await review(draft.id);
    const r = await sendDraft(w.marketing.id, draft.id, hash, { transportFactory: m.factory });
    expect(r.status).toBe("ACCEPTED");
    expect(r.message).toMatch(/does not guarantee inbox delivery/);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].to.address).toBe(contact.email);
    expect(m.sent[0].attachment?.filename).toBe("Asha_Verma_Resume.pdf");
    expect(m.sent[0].from.address).toBe("asha.sender@example.org");
    const log = await db.emailSendLog.findFirstOrThrow({ where: { draftId: draft.id } });
    expect(log).toMatchObject({ status: "ACCEPTED", attachmentResumeId: w.mResume.id });
    const c = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(c.stage).toBe("SENT");
    expect(await db.followUp.count({ where: { contactId: contact.id, status: "SCHEDULED" } })).toBe(1);
  });

  it("requires re-review when the recipient or attachment changes after review", async () => {
    const m = mockTransport();
    const { draft } = await readyDraft();
    await review(draft.id);
    const changed = await updateDraft(w.marketing.id, draft.id, { subject: draft.subject, body: draft.body, recipientEmail: "changed@send.test", resumeId: draft.resumeId });
    const readiness = await checkReadiness(w.marketing.id, draft.id);
    expect(readiness.items.find((i) => i.code === "NOT_REVIEWED")?.message).toMatch(/changed after you reviewed/);
    const r = await sendDraft(w.marketing.id, draft.id, changed.contentHash, { transportFactory: m.factory });
    expect(r.status).toBe("BLOCKED");
    expect(m.sent).toHaveLength(0);
  });

  it("protects against repeated clicks / concurrent requests", async () => {
    const m = mockTransport("accept", 30);
    const { draft } = await readyDraft();
    const hash = await review(draft.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => sendDraft(w.marketing.id, draft.id, hash, { transportFactory: m.factory })));
    expect(results.filter((r) => r.status === "ACCEPTED")).toHaveLength(1);
    expect(m.sent).toHaveLength(1);
    expect(await db.emailSendLog.count({ where: { draftId: draft.id } })).toBe(1);
    // And a later click after success is blocked too.
    expect((await sendDraft(w.marketing.id, draft.id, hash, { transportFactory: m.factory })).status).toBe("BLOCKED");
  });
});

describe("pre-send validation", () => {
  it("blocks suppressed (Do Not Contact) recipients", async () => {
    const m = mockTransport();
    const { draft, contact } = await readyDraft();
    const hash = await review(draft.id);
    await addSuppression(w.marketing.id, { value: contact.email!, reason: "Asked not to be contacted" });
    const r = await sendDraft(w.marketing.id, draft.id, hash, { transportFactory: m.factory });
    expect(r.status).toBe("BLOCKED");
    expect(r.message).toMatch(/Do Not Contact/);
    expect(m.sent).toHaveLength(0);
  });

  it("blocks contacts in the Do Not Contact stage", async () => {
    const { draft, contact } = await readyDraft();
    await changeStage(w.marketing.id, contact.id, "DO_NOT_CONTACT");
    const r = await checkReadiness(w.marketing.id, draft.id);
    expect(r.items.map((i) => i.code)).toEqual(expect.arrayContaining(["DNC"]));
  });

  it("requires acknowledgement for guessed / uncertain addresses", async () => {
    const m = mockTransport();
    const { draft, contact } = await readyDraft();
    await db.contact.update({ where: { id: contact.id }, data: { emailOrigin: "PATTERN_GUESS", emailStatus: "UNCERTAIN" } });
    const hash = await review(draft.id);
    expect((await sendDraft(w.marketing.id, draft.id, hash, { transportFactory: m.factory })).message).toMatch(/pattern guess/);
    await setAcknowledgements(w.marketing.id, draft.id, { guess: true });
    expect((await sendDraft(w.marketing.id, draft.id, hash, { transportFactory: m.factory })).status).toBe("ACCEPTED");
  });

  it("detects duplicate outreach to the same recipient and requires confirmation", async () => {
    const m = mockTransport();
    const { draft, contact } = await readyDraft();
    await sendDraft(w.marketing.id, draft.id, await review(draft.id), { transportFactory: m.factory });
    const second = await createDraft(w.marketing.id, contact.id);
    const hash = await review(second.id);
    const r = await sendDraft(w.marketing.id, second.id, hash, { transportFactory: m.factory });
    expect(r.status).toBe("BLOCKED");
    expect(r.message).toMatch(/already contacted/);
    expect(m.sent).toHaveLength(1);
  });

  it("enforces the daily limit", async () => {
    const m = mockTransport();
    for (let i = 0; i < 5; i++) {
      const { draft } = await readyDraft();
      expect((await sendDraft(w.marketing.id, draft.id, await review(draft.id), { transportFactory: m.factory })).status).toBe("ACCEPTED");
    }
    const { draft } = await readyDraft();
    const r = await sendDraft(w.marketing.id, draft.id, await review(draft.id), { transportFactory: m.factory });
    expect(r.status).toBe("BLOCKED");
    expect(r.message).toMatch(/Daily sending limit/);
    expect(m.sent).toHaveLength(5);
  });

  it("works in draft-only mode when no sender is configured (finance profile)", async () => {
    const { draft } = await readyDraft(w.finance.id);
    await review(draft.id, w.finance.id);
    const r = await checkReadiness(w.finance.id, draft.id);
    expect(r.canSend).toBe(false);
    expect(r.items.find((i) => i.code === "NO_SENDER")?.message).toMatch(/draft-only/);
    expect(draft.resumeId).toBe(w.fResume.id);
  });

  it("blocks when the sender secret is missing from the environment", () => {
    expect(accountReadiness({ provider: "SMTP", secretEnvVar: "CAREERREACH_NOT_SET_VAR", smtpHost: "h", smtpUser: "u" }).ready).toBe(false);
  });

  it("blocks sending without a résumé", async () => {
    const { draft } = await readyDraft();
    await updateDraft(w.marketing.id, draft.id, { subject: draft.subject, body: draft.body, recipientEmail: draft.recipientEmail!, resumeId: null });
    const r = await checkReadiness(w.marketing.id, draft.id);
    expect(r.items.map((i) => i.code)).toContain("NO_RESUME");
  });
});

describe("send failures", () => {
  it("records definite failures, applies a cooldown and never retries automatically", async () => {
    const bad = mockTransport("auth-error");
    const { draft } = await readyDraft();
    const r = await sendDraft(w.marketing.id, draft.id, await review(draft.id), { transportFactory: bad.factory });
    expect(r.status).toBe("FAILED");
    expect(bad.sent).toHaveLength(1);
    const d = await db.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(d.sendState).toBe("FAILED");
    expect(d.idempotencyKey).not.toBe(draft.idempotencyKey);
    // Cooldown blocks the next attempt (for any draft in this profile).
    const good = mockTransport();
    const again = await sendDraft(w.marketing.id, draft.id, d.contentHash, { transportFactory: good.factory });
    expect(again.message).toMatch(/paused after a failed attempt/);
    expect(good.sent).toHaveLength(0);
  });

  it("treats recipient rejection as a failure, not a send", async () => {
    const rej = mockTransport("reject");
    const { draft, contact } = await readyDraft();
    const r = await sendDraft(w.marketing.id, draft.id, await review(draft.id), { transportFactory: rej.factory });
    expect(r.status).toBe("REJECTED");
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).stage).not.toBe("SENT");
  });

  it("marks ambiguous failures UNKNOWN and blocks until the user resolves them", async () => {
    const t = mockTransport("timeout");
    const { draft } = await readyDraft();
    const hash = await review(draft.id);
    const r = await sendDraft(w.marketing.id, draft.id, hash, { transportFactory: t.factory });
    expect(r.status).toBe("UNKNOWN");
    expect(r.message).toMatch(/Sent folder/);
    const readiness = await checkReadiness(w.marketing.id, draft.id);
    expect(readiness.items.map((i) => i.code)).toContain("OUTCOME_UNKNOWN");
    await resolveUnknownSend(w.marketing.id, draft.id, true);
    expect((await db.emailDraft.findUniqueOrThrow({ where: { id: draft.id } })).sendState).toBe("SENT");
  });

  it("classifies transport errors conservatively", () => {
    expect(classifySendError({ code: "EAUTH", responseCode: 535, message: "bad" }).outcome).toBe("FAILED");
    expect(classifySendError({ code: "ECONNECTION" }).outcome).toBe("FAILED");
    expect(classifySendError({ code: "ETIMEDOUT", command: "DATA" }).outcome).toBe("UNKNOWN");
    expect(classifySendError({ message: "socket closed" }).outcome).toBe("UNKNOWN");
  });

  it("never leaks secrets into error messages", () => {
    expect(classifySendError({ message: "auth failed password=hunter2" }).message).not.toContain("hunter2");
  });
});

describe("cross-profile isolation", () => {
  it("one profile cannot send another profile's draft", async () => {
    const m = mockTransport();
    const { draft } = await readyDraft();
    const hash = await review(draft.id);
    await expect(sendDraft(w.finance.id, draft.id, hash, { transportFactory: m.factory })).rejects.toThrow(/not found/i);
    expect(m.sent).toHaveLength(0);
  });

  it("a sender address cannot be shared between profiles", async () => {
    await expect(configureSender(w.finance.id, "asha.sender@example.org")).rejects.toThrow(/other profile/);
  });
});
