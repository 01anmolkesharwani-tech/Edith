import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { backupDir, databaseFilePath, resumeStorageDir } from "@/lib/paths";
import { NotFoundError } from "./errors";
import { getSettings } from "./settings";

/** Full JSON export of one profile's data. Secrets are never stored, so none are exported. */
export async function exportProfileData(profileId: string) {
  const profile = await db.candidateProfile.findUnique({
    where: { id: profileId },
    include: {
      highlights: true,
      resumes: { select: { id: true, label: true, originalFilename: true, sizeBytes: true, sha256: true, isDefault: true, uploadedAt: true } },
      companies: { include: { company: { include: { jobs: true, channels: true, researchItems: true } } } },
      contacts: { include: { evidence: true, verifications: true } },
      templates: true,
      emailAccounts: { select: { id: true, label: true, fromName: true, fromAddress: true, smtpHost: true, smtpPort: true, smtpUser: true, secretEnvVar: true, imapEnabled: true, imapHost: true } },
      drafts: true,
      activities: true,
      sendLogs: true,
      followUps: true,
      suppressions: true,
      savedSearches: true,
      searchHistory: true,
      researchItems: true,
    },
  });
  if (!profile) throw new NotFoundError("Profile");
  return { exportedAt: new Date().toISOString(), app: "CareerReach", note: "Résumé files are not embedded; download them from the Résumés page.", profile };
}

/**
 * Delete all of a profile's data (contacts, drafts, logs, résumés and files…).
 * Shared company records are kept unless no profile references them any more.
 */
export async function deleteProfileData(profileId: string, opts: { deleteProfile: boolean }) {
  const profile = await db.candidateProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new NotFoundError("Profile");
  await db.$transaction([
    db.emailSendLog.deleteMany({ where: { profileId } }),
    db.followUp.deleteMany({ where: { profileId } }),
    db.emailDraft.deleteMany({ where: { profileId } }),
    db.outreachActivity.deleteMany({ where: { profileId } }),
    db.contact.deleteMany({ where: { profileId } }),
    db.researchItem.deleteMany({ where: { profileId } }),
    db.searchHistory.deleteMany({ where: { profileId } }),
    db.savedSearch.deleteMany({ where: { profileId } }),
    db.suppressionRecord.deleteMany({ where: { profileId } }),
    db.profileCompany.deleteMany({ where: { profileId } }),
    db.resume.deleteMany({ where: { profileId } }),
    db.profileHighlight.deleteMany({ where: { profileId } }),
    db.outreachTemplate.deleteMany({ where: { profileId } }),
    db.emailAccount.deleteMany({ where: { profileId } }),
  ]);
  await fs.rm(path.join(resumeStorageDir(), profile.id), { recursive: true, force: true });
  if (opts.deleteProfile) await db.candidateProfile.delete({ where: { id: profileId } });
}

/** Apply retention settings: old search history and unreferenced retrieved pages. */
export async function applyRetention(now = new Date()) {
  const s = await getSettings();
  const history = await db.searchHistory.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - s.searchHistoryRetentionDays * 86_400_000) } } });
  const docs = await db.sourceDocument.deleteMany({
    where: {
      retrievedAt: { lt: new Date(now.getTime() - s.sourceDocumentRetentionDays * 86_400_000) },
      evidence: { none: {} },
      research: { none: {} },
    },
  });
  return { searchHistoryDeleted: history.count, documentsDeleted: docs.count };
}

/** Consistent online backup of the SQLite database using SQLite's backup API. */
export async function backupDatabase(): Promise<string> {
  await fs.mkdir(backupDir(), { recursive: true, mode: 0o700 });
  const target = path.join(backupDir(), `careerreach-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  const src = new Database(databaseFilePath(), { readonly: true, fileMustExist: true });
  try {
    await src.backup(target);
  } finally {
    src.close();
  }
  return target;
}

export async function listBackups() {
  try {
    const files = await fs.readdir(backupDir());
    const out = [];
    for (const f of files.filter((x) => x.endsWith(".db")).sort().reverse()) {
      const st = await fs.stat(path.join(backupDir(), f));
      out.push({ name: f, size: st.size, createdAt: st.mtime });
    }
    return out;
  } catch {
    return [];
  }
}
