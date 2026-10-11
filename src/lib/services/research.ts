import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeUrl } from "@/lib/normalize";
import { NotFoundError, UserError } from "./errors";

export const RESEARCH_KINDS = [
  "DESCRIPTION",
  "BUSINESS_MODEL",
  "PRODUCT_OR_SERVICE",
  "BUSINESS_UNIT",
  "STRATEGIC_PRIORITY",
  "GROWTH_INITIATIVE",
  "NEWS",
  "RECIPIENT_BACKGROUND",
  "OTHER",
] as const;

export const researchSchema = z.object({
  kind: z.enum(RESEARCH_KINDS),
  statement: z.string().trim().min(5, "Write a short factual statement").max(500),
  quote: z.string().trim().max(2000).optional().nullable(),
  sourceUrl: z.string().trim().max(1000).optional().nullable(),
  publishedAt: z.string().trim().max(30).optional().nullable(),
  contactId: z.string().trim().max(40).optional().nullable(),
  confirmed: z.coerce.boolean().optional(),
  shared: z.coerce.boolean().optional(),
});

export async function addResearchItem(profileId: string, companyId: string, input: z.input<typeof researchSchema>) {
  const d = researchSchema.parse(input);
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Company");
  const sourceUrl = d.sourceUrl ? normalizeUrl(d.sourceUrl) : null;
  if (d.sourceUrl && !sourceUrl) throw new UserError("Source URL must be a valid http(s) URL.");
  if (d.confirmed && !sourceUrl) throw new UserError("Add a source URL before marking research as confirmed for use in emails.");
  if (d.contactId) {
    const c = await db.contact.findFirst({ where: { id: d.contactId, profileId } });
    if (!c) throw new NotFoundError("Contact");
  }
  const publishedAt = d.publishedAt ? new Date(d.publishedAt) : null;
  return db.researchItem.create({
    data: {
      companyId,
      // Recipient research is always profile-private; company research may be shared.
      profileId: d.contactId || !d.shared ? profileId : null,
      contactId: d.contactId || null,
      kind: d.contactId ? "RECIPIENT_BACKGROUND" : d.kind,
      statement: d.statement,
      quote: d.quote || null,
      sourceUrl,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      confirmed: !!d.confirmed,
      origin: "MANUAL",
    },
  });
}

export async function setResearchConfirmed(profileId: string, itemId: string, confirmed: boolean) {
  const item = await db.researchItem.findFirst({ where: { id: itemId, OR: [{ profileId }, { profileId: null }] } });
  if (!item) throw new NotFoundError("Research item");
  if (confirmed && !item.sourceUrl) throw new UserError("Research needs a source URL before it can be used in emails.");
  await db.researchItem.update({ where: { id: itemId }, data: { confirmed } });
}

export async function deleteResearchItem(profileId: string, itemId: string) {
  const r = await db.researchItem.deleteMany({ where: { id: itemId, OR: [{ profileId }, { profileId: null }] } });
  if (!r.count) throw new NotFoundError("Research item");
}

const SIGNAL_RE =
  /\b(launch(ed|es)?|expan(d|ded|ding|sion)|acquir(e|ed|es|ition)|partnership|invest(ed|ment|ing)|new (product|brand|market|facility|office)|growth|strategy|priorit(y|ies)|announce(d|s)?|enter(ed|s|ing)? (the )?\w+ market|portfolio|digital|sustainab\w+|raised|funding)\b/i;

/**
 * Suggest candidate research statements from retrieved official pages: sentences containing
 * growth / strategy signals. Suggestions must be reviewed and confirmed by the user.
 */
export async function researchSuggestions(companyId: string, limit = 15) {
  const docs = await db.sourceDocument.findMany({ where: { companyId }, orderBy: { retrievedAt: "desc" }, take: 20 });
  const out: { sentence: string; sourceUrl: string; documentId: string; publishedAt: Date | null; retrievedAt: Date }[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const sentences = (d.textExcerpt ?? "").split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const s of sentences) {
      const t = s.trim();
      if (t.length < 40 || t.length > 300 || !SIGNAL_RE.test(t)) continue;
      const key = t.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ sentence: t, sourceUrl: d.finalUrl, documentId: d.id, publishedAt: d.publishedAt, retrievedAt: d.retrievedAt });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
