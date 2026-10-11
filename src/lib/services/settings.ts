import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_USER_AGENT } from "@/lib/net/safe-fetch";

export async function getSettings() {
  return db.applicationSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export const settingsSchema = z.object({
  userAgentContact: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  requestDelayMs: z.coerce.number().int().min(500).max(30_000),
  maxPagesPerSite: z.coerce.number().int().min(1).max(20),
  fetchTimeoutMs: z.coerce.number().int().min(3_000).max(60_000),
  maxResponseBytes: z.coerce.number().int().min(100_000).max(10_000_000),
  searchHistoryRetentionDays: z.coerce.number().int().min(1).max(3650),
  sourceDocumentRetentionDays: z.coerce.number().int().min(7).max(3650),
  smtpDiagnosticsEnabled: z.coerce.boolean().optional(),
  wikidataEnabled: z.coerce.boolean().optional(),
  jobBoardsEnabled: z.coerce.boolean().optional(),
  websiteResearchEnabled: z.coerce.boolean().optional(),
});

export async function updateSettings(input: z.input<typeof settingsSchema>) {
  const d = settingsSchema.parse(input);
  await getSettings();
  return db.applicationSettings.update({
    where: { id: 1 },
    data: {
      userAgentContact: d.userAgentContact ?? null,
      requestDelayMs: d.requestDelayMs,
      maxPagesPerSite: d.maxPagesPerSite,
      fetchTimeoutMs: d.fetchTimeoutMs,
      maxResponseBytes: d.maxResponseBytes,
      searchHistoryRetentionDays: d.searchHistoryRetentionDays,
      sourceDocumentRetentionDays: d.sourceDocumentRetentionDays,
      smtpDiagnosticsEnabled: !!d.smtpDiagnosticsEnabled,
      wikidataEnabled: !!d.wikidataEnabled,
      jobBoardsEnabled: !!d.jobBoardsEnabled,
      websiteResearchEnabled: !!d.websiteResearchEnabled,
    },
  });
}

export function userAgentFor(settings: { userAgentContact: string | null }): string {
  return settings.userAgentContact
    ? DEFAULT_USER_AGENT.replace(")", `; contact: ${settings.userAgentContact})`)
    : DEFAULT_USER_AGENT;
}
