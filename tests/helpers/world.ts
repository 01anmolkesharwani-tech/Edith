import { db } from "@/lib/db";
import { ensureDefaultProfiles, saveHighlight, updateProfile } from "@/lib/services/profiles";
import { saveResume } from "@/lib/services/resumes";
import { makePdf } from "./fixtures";

/** Two configured candidate profiles with résumés, as used by most service tests. */
export async function setupWorld() {
  await ensureDefaultProfiles();
  const marketing = await db.candidateProfile.findUniqueOrThrow({ where: { slug: "marketing" } });
  const finance = await db.candidateProfile.findUniqueOrThrow({ where: { slug: "finance" } });
  const common = { dailySendLimit: 5, followUpAfterDays: 7, maxFollowUps: 1, failedSendCooldownMinutes: 30 };
  await updateProfile(marketing.id, { ...common, portalName: "Marketing", candidateName: "Asha Verma", currentStatus: "an MBA candidate", targetFunctions: "marketing, brand", targetRoles: "brand management", targetContactTitles: "brand manager, talent acquisition", targetIndustries: "FMCG" });
  await updateProfile(finance.id, { ...common, portalName: "Finance", candidateName: "Dev Kapoor", currentStatus: "a finance graduate", targetFunctions: "investment banking, valuation", targetRoles: "valuation", targetContactTitles: "valuation director", targetIndustries: "investment banking" });
  await saveHighlight(marketing.id, { kind: "EXPERIENCE", title: "Marketing Intern", organization: "Snackco", capabilities: "consumer research", tags: "marketing", confirmed: true });
  const mResume = await saveResume(marketing.id, { name: "Asha_Verma_Resume.pdf", bytes: makePdf("Asha Verma marketing") }, "Marketing");
  const fResume = await saveResume(finance.id, { name: "Dev Kapoor CV.pdf", bytes: makePdf("Dev Kapoor finance") }, "Finance");
  return { marketing, finance, mResume, fResume };
}

let counter = 0;
export function uniq(prefix: string) {
  counter += 1;
  return `${prefix}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

/** Configure an SMTP sender whose secret is present in the environment (transport is mocked in tests). */
export async function configureSender(profileId: string, address: string) {
  process.env.CAREERREACH_TEST_SMTP_PASS = "test-secret";
  const { saveAccount } = await import("@/lib/sending/accounts");
  return saveAccount(profileId, {
    label: "Test",
    fromName: "Sender",
    fromAddress: address,
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: address,
    secretEnvVar: "CAREERREACH_TEST_SMTP_PASS",
  });
}
