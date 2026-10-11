import { z } from "zod";
import { db } from "@/lib/db";
import { checkSyntax } from "@/lib/email/validation";
import { NotFoundError, UserError } from "@/lib/services/errors";
import { readSecret, smtpTransport, TransportConfigError } from "./transport";

/** Provider presets: documented settings and limits (informational; check your own account). */
export const PROVIDER_PRESETS = {
  gmail: {
    label: "Gmail / Google Workspace (app password)",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    providerDailyLimit: 500,
    notes:
      "Requires 2-Step Verification and an app password. Consumer Gmail is commonly documented at ~500 recipients per rolling 24h (Workspace: 2,000); attachments up to 25 MB.",
  },
  zoho: {
    label: "Zoho Mail (app-specific password)",
    smtpHost: "smtp.zoho.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.zoho.com",
    imapPort: 993,
    providerDailyLimit: null,
    notes: "Use an application-specific password. Check your plan's sending limits in Zoho's documentation.",
  },
  custom: {
    label: "Other SMTP provider",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "",
    imapPort: 993,
    providerDailyLimit: null,
    notes:
      "Outlook.com / Microsoft 365 personal accounts no longer accept basic-auth app passwords for SMTP (OAuth is required) and are not supported by this version.",
  },
} as const;

export const accountSchema = z.object({
  label: z.string().trim().min(1).max(80),
  fromName: z.string().trim().min(1).max(120),
  fromAddress: z.string().trim().max(254),
  smtpHost: z.string().trim().min(3).max(200),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.coerce.boolean().optional(),
  smtpUser: z.string().trim().min(1).max(254),
  secretEnvVar: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{2,63}$/, "Use an UPPER_CASE environment variable name, e.g. CAREERREACH_SMTP_PASS_MARKETING"),
  imapEnabled: z.coerce.boolean().optional(),
  imapHost: z.string().trim().max(200).optional().nullable(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  providerDailyLimit: z.coerce.number().int().min(1).max(100000).optional().nullable(),
});

export async function saveAccount(profileId: string, input: z.input<typeof accountSchema>, id?: string) {
  const d = accountSchema.parse(input);
  if (!checkSyntax(d.fromAddress).ok) throw new UserError("Sender address is not valid.");
  const data = {
    label: d.label,
    provider: "SMTP",
    fromName: d.fromName,
    fromAddress: d.fromAddress.toLowerCase(),
    smtpHost: d.smtpHost,
    smtpPort: d.smtpPort,
    smtpSecure: !!d.smtpSecure,
    smtpUser: d.smtpUser,
    secretEnvVar: d.secretEnvVar,
    imapEnabled: !!d.imapEnabled,
    imapHost: d.imapHost || null,
    imapPort: d.imapPort ?? null,
    providerDailyLimit: d.providerDailyLimit ?? null,
  };
  // A profile may only send from its own accounts; the same address cannot be shared across profiles.
  const clash = await db.emailAccount.findFirst({ where: { fromAddress: data.fromAddress, NOT: { profileId } } });
  if (clash) throw new UserError("This sender address is already configured for the other profile.");
  if (id) {
    const existing = await db.emailAccount.findFirst({ where: { id, profileId } });
    if (!existing) throw new NotFoundError("Email account");
    return db.emailAccount.update({ where: { id }, data });
  }
  await db.emailAccount.updateMany({ where: { profileId }, data: { isActive: false } });
  return db.emailAccount.create({ data: { ...data, profileId, isActive: true } });
}

export async function activeAccount(profileId: string) {
  return db.emailAccount.findFirst({ where: { profileId, isActive: true } });
}

export async function listAccounts(profileId: string) {
  return db.emailAccount.findMany({ where: { profileId }, orderBy: { createdAt: "asc" } });
}

export async function setActiveAccount(profileId: string, id: string) {
  const a = await db.emailAccount.findFirst({ where: { id, profileId } });
  if (!a) throw new NotFoundError("Email account");
  await db.emailAccount.updateMany({ where: { profileId }, data: { isActive: false } });
  await db.emailAccount.update({ where: { id }, data: { isActive: true } });
}

/** Disconnect: removes the account configuration. (Revoke the app password at the provider too.) */
export async function deleteAccount(profileId: string, id: string) {
  const r = await db.emailAccount.deleteMany({ where: { id, profileId } });
  if (!r.count) throw new NotFoundError("Email account");
}

export function accountReadiness(a: { provider: string; secretEnvVar: string | null; smtpHost: string | null; smtpUser: string | null } | null) {
  if (!a) return { ready: false, reason: "No sender account configured – the app is in draft-only mode." };
  if (a.provider !== "SMTP") return { ready: false, reason: "Unsupported provider." };
  if (!a.smtpHost || !a.smtpUser) return { ready: false, reason: "SMTP host or username missing." };
  if (!readSecret(a.secretEnvVar)) return { ready: false, reason: `Environment variable ${a.secretEnvVar} is not set on the server – draft-only mode.` };
  return { ready: true, reason: null as string | null };
}

/** Connect and authenticate without sending anything. */
export async function testAccount(profileId: string, id: string) {
  const a = await db.emailAccount.findFirst({ where: { id, profileId } });
  if (!a) throw new NotFoundError("Email account");
  let result: string;
  try {
    const t = smtpTransport(a);
    await t.verify?.();
    result = "OK: connected and authenticated (no email sent).";
  } catch (e) {
    result = e instanceof TransportConfigError ? `Not configured: ${e.message}` : `Failed: ${(e as Error).message.slice(0, 200)}`;
  }
  await db.emailAccount.update({ where: { id }, data: { lastTestAt: new Date(), lastTestResult: result } });
  return result;
}
