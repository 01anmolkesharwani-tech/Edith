import { z } from "zod";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES } from "@/lib/drafting/builtin-templates";
import { parseList } from "@/lib/json";
import { NotFoundError } from "./errors";

export async function ensureTemplates(profileId: string) {
  const existing = await db.outreachTemplate.findMany({ where: { profileId }, select: { name: true } });
  const have = new Set(existing.map((t) => t.name));
  const missing = BUILTIN_TEMPLATES.filter((t) => !have.has(t.name));
  if (missing.length) {
    await db.outreachTemplate.createMany({
      data: missing.map((t) => ({
        profileId,
        name: t.name,
        recipientType: t.recipientType,
        subjectTemplates: JSON.stringify(t.subjects),
        bodyTemplate: t.body,
        isBuiltIn: true,
      })),
    });
  }
}

export async function listTemplates(profileId: string) {
  await ensureTemplates(profileId);
  return db.outreachTemplate.findMany({ where: { profileId }, orderBy: [{ recipientType: "asc" }, { name: "asc" }] });
}

export async function templateForType(profileId: string, recipientType: string) {
  await ensureTemplates(profileId);
  // Prefer the user's most recently edited template of that type.
  return (
    (await db.outreachTemplate.findFirst({ where: { profileId, recipientType }, orderBy: { updatedAt: "desc" } })) ??
    (await db.outreachTemplate.findFirst({ where: { profileId, recipientType: "NETWORKING" } }))
  );
}

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  recipientType: z.enum(["RECRUITER", "FUNCTIONAL_LEADER", "BUSINESS_HEAD", "SENIOR", "JUNIOR", "OPEN_ROLE", "NETWORKING", "FOLLOW_UP"]),
  subjectTemplates: z.string().trim().min(3).max(2000),
  bodyTemplate: z.string().trim().min(20).max(8000),
});

export async function saveTemplate(profileId: string, input: z.input<typeof templateSchema>, id?: string) {
  const d = templateSchema.parse(input);
  const subjects = d.subjectTemplates
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const data = { name: d.name, recipientType: d.recipientType, subjectTemplates: JSON.stringify(subjects), bodyTemplate: d.bodyTemplate };
  if (id) {
    const t = await db.outreachTemplate.findFirst({ where: { id, profileId } });
    if (!t) throw new NotFoundError("Template");
    return db.outreachTemplate.update({ where: { id }, data });
  }
  return db.outreachTemplate.create({ data: { ...data, profileId } });
}

export async function deleteTemplate(profileId: string, id: string) {
  const r = await db.outreachTemplate.deleteMany({ where: { id, profileId } });
  if (!r.count) throw new NotFoundError("Template");
}

export function templateSubjects(t: { subjectTemplates: string }) {
  return parseList(t.subjectTemplates);
}
