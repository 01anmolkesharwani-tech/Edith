import { z } from "zod";
import { db } from "@/lib/db";
import { emailDomain, normalizeDomain, normalizeEmail } from "@/lib/normalize";
import { NotFoundError, UserError } from "./errors";

/** Is this address suppressed for the profile (profile-specific or global Do Not Contact)? */
export async function suppressionFor(profileId: string, email: string | null | undefined, contactId?: string | null) {
  const e = normalizeEmail(email);
  const domain = e ? emailDomain(e) : null;
  const or = [
    ...(e ? [{ email: e }] : []),
    ...(domain ? [{ domain }] : []),
    ...(contactId ? [{ contactId }] : []),
  ];
  if (!or.length) return null;
  return db.suppressionRecord.findFirst({ where: { AND: [{ OR: [{ profileId }, { profileId: null }] }, { OR: or }] } });
}

export const suppressionSchema = z.object({
  value: z.string().trim().min(3).max(254),
  reason: z.string().trim().max(500).optional(),
  global: z.coerce.boolean().optional(),
});

export async function addSuppression(profileId: string, input: z.input<typeof suppressionSchema>) {
  const d = suppressionSchema.parse(input);
  const isEmail = d.value.includes("@");
  const email = isEmail ? normalizeEmail(d.value) : null;
  const domain = isEmail ? null : normalizeDomain(d.value);
  if (!email && !domain) throw new UserError("Enter an email address or a domain.");
  const rec = await db.suppressionRecord.create({
    data: { profileId: d.global ? null : profileId, email, domain, reason: d.reason || "Added manually" },
  });
  // Move matching contacts to Do Not Contact and stop scheduled follow-ups.
  const contacts = await db.contact.findMany({
    where: {
      ...(d.global ? {} : { profileId }),
      ...(email ? { emailNormalized: email } : { emailNormalized: { endsWith: `@${domain}` } }),
    },
  });
  for (const c of contacts) {
    await db.contact.update({ where: { id: c.id }, data: { stage: "DO_NOT_CONTACT" } });
    await db.followUp.updateMany({ where: { contactId: c.id, status: "SCHEDULED" }, data: { status: "SUPPRESSED", suppressedReason: "Do Not Contact" } });
  }
  return rec;
}

export async function listSuppressions(profileId: string) {
  return db.suppressionRecord.findMany({ where: { OR: [{ profileId }, { profileId: null }] }, orderBy: { createdAt: "desc" } });
}

export async function removeSuppression(profileId: string, id: string) {
  const r = await db.suppressionRecord.deleteMany({ where: { id, OR: [{ profileId }, { profileId: null }] } });
  if (!r.count) throw new NotFoundError("Suppression record");
}
