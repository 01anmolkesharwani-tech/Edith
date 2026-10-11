import { z } from "zod";
import { db } from "@/lib/db";
import { parseList, splitList, toJsonList } from "@/lib/json";
import { NotFoundError } from "./errors";

import { DEFAULT_PROFILES } from "./profile-defaults";

export { DEFAULT_PROFILES };

export async function ensureDefaultProfiles(): Promise<void> {
  for (const p of DEFAULT_PROFILES) {
    await db.candidateProfile.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        slug: p.slug,
        portalName: p.portalName,
        accentColor: p.accentColor,
        careerObjective: p.careerObjective,
        targetRoles: toJsonList([...p.targetRoles]),
        targetIndustries: toJsonList([...p.targetIndustries]),
        targetFunctions: toJsonList([...p.targetFunctions]),
        targetContactTitles: toJsonList([...p.targetContactTitles]),
      },
    });
  }
}

export async function listProfiles() {
  return db.candidateProfile.findMany({ orderBy: { createdAt: "asc" } });
}

export async function getProfile(profileId: string) {
  const p = await db.candidateProfile.findUnique({ where: { id: profileId } });
  if (!p) throw new NotFoundError("Profile");
  return p;
}

export function profileLists(p: {
  skills: string;
  targetRoles: string;
  targetIndustries: string;
  targetFunctions: string;
  targetContactTitles: string;
  preferredLocations: string;
}) {
  return {
    skills: parseList(p.skills),
    targetRoles: parseList(p.targetRoles),
    targetIndustries: parseList(p.targetIndustries),
    targetFunctions: parseList(p.targetFunctions),
    targetContactTitles: parseList(p.targetContactTitles),
    preferredLocations: parseList(p.preferredLocations),
  };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length ? v : null))
    .nullable()
    .optional();

export const profileUpdateSchema = z.object({
  portalName: z.string().trim().min(1).max(60),
  candidateName: optionalText(120),
  currentStatus: optionalText(300),
  education: optionalText(2000),
  careerObjective: optionalText(2000),
  signature: optionalText(500),
  skills: z.string().max(4000).optional(),
  targetRoles: z.string().max(4000).optional(),
  targetIndustries: z.string().max(4000).optional(),
  targetFunctions: z.string().max(4000).optional(),
  targetContactTitles: z.string().max(4000).optional(),
  preferredLocations: z.string().max(4000).optional(),
  dailySendLimit: z.coerce.number().int().min(1).max(100),
  followUpAfterDays: z.coerce.number().int().min(2).max(60),
  maxFollowUps: z.coerce.number().int().min(0).max(3),
  failedSendCooldownMinutes: z.coerce.number().int().min(1).max(1440),
});

export async function updateProfile(profileId: string, input: z.input<typeof profileUpdateSchema>) {
  const data = profileUpdateSchema.parse(input);
  await getProfile(profileId);
  return db.candidateProfile.update({
    where: { id: profileId },
    data: {
      portalName: data.portalName,
      candidateName: data.candidateName ?? null,
      currentStatus: data.currentStatus ?? null,
      education: data.education ?? null,
      careerObjective: data.careerObjective ?? null,
      signature: data.signature ?? null,
      skills: toJsonList(splitList(data.skills)),
      targetRoles: toJsonList(splitList(data.targetRoles)),
      targetIndustries: toJsonList(splitList(data.targetIndustries)),
      targetFunctions: toJsonList(splitList(data.targetFunctions)),
      targetContactTitles: toJsonList(splitList(data.targetContactTitles)),
      preferredLocations: toJsonList(splitList(data.preferredLocations)),
      dailySendLimit: data.dailySendLimit,
      followUpAfterDays: data.followUpAfterDays,
      maxFollowUps: data.maxFollowUps,
      failedSendCooldownMinutes: data.failedSendCooldownMinutes,
    },
  });
}

export const createProfileSchema = z.object({
  portalName: z.string().trim().min(1).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, "Use 2–40 lowercase letters, numbers or dashes"),
});

export async function createProfile(input: z.input<typeof createProfileSchema>) {
  const data = createProfileSchema.parse(input);
  return db.candidateProfile.create({ data: { slug: data.slug, portalName: data.portalName } });
}

// --- Highlights (verified candidate facts) ---------------------------------

export const highlightSchema = z.object({
  kind: z.enum(["EDUCATION", "EXPERIENCE", "PROJECT", "ACHIEVEMENT", "CERTIFICATION", "SKILL", "OTHER"]),
  title: z.string().trim().min(2).max(200),
  organization: optionalText(200),
  summary: optionalText(1000),
  capabilities: z.string().max(1000).optional(),
  tags: z.string().max(1000).optional(),
  confirmed: z.coerce.boolean().optional(),
});

export async function listHighlights(profileId: string) {
  return db.profileHighlight.findMany({ where: { profileId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

export async function saveHighlight(profileId: string, input: z.input<typeof highlightSchema>, id?: string, source = "manual") {
  const data = highlightSchema.parse(input);
  const values = {
    kind: data.kind,
    title: data.title,
    organization: data.organization ?? null,
    summary: data.summary ?? null,
    capabilities: toJsonList(splitList(data.capabilities)),
    tags: toJsonList(splitList(data.tags)),
    confirmed: data.confirmed ?? false,
  };
  if (id) {
    const existing = await db.profileHighlight.findFirst({ where: { id, profileId } });
    if (!existing) throw new NotFoundError("Highlight");
    return db.profileHighlight.update({ where: { id }, data: values });
  }
  return db.profileHighlight.create({ data: { ...values, profileId, source } });
}

export async function setHighlightConfirmed(profileId: string, id: string, confirmed: boolean) {
  const r = await db.profileHighlight.updateMany({ where: { id, profileId }, data: { confirmed } });
  if (!r.count) throw new NotFoundError("Highlight");
}

export async function deleteHighlight(profileId: string, id: string) {
  const r = await db.profileHighlight.deleteMany({ where: { id, profileId } });
  if (!r.count) throw new NotFoundError("Highlight");
}
