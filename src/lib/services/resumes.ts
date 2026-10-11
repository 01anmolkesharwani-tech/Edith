import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { resumeStorageDir } from "@/lib/paths";
import { NotFoundError, UserError } from "./errors";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024; // keeps attachments well under common provider limits (Gmail: 25 MB)

export function safeFilename(name: string): string {
  const base = path.basename(name).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 100);
  const withExt = cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "resume"}.pdf`;
  return withExt;
}

/** Validate PDF by magic bytes, not just by the extension or browser-supplied MIME type. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

export async function saveResume(
  profileId: string,
  file: { name: string; bytes: Uint8Array },
  label: string,
  makeDefault = false,
) {
  const profile = await db.candidateProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new NotFoundError("Profile");
  if (file.bytes.length === 0) throw new UserError("The file is empty.");
  if (file.bytes.length > MAX_RESUME_BYTES) throw new UserError("Résumé must be 5 MB or smaller.");
  if (!isPdf(file.bytes)) throw new UserError("Only PDF résumés are supported.");
  const cleanLabel = label.trim().slice(0, 40) || "General";

  const dir = path.join(resumeStorageDir(), profile.id);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const storedFilename = `${randomUUID()}.pdf`;
  await fs.writeFile(path.join(dir, storedFilename), file.bytes, { mode: 0o600 });

  let extractedText: string | null = null;
  try {
    extractedText = await extractPdfText(file.bytes);
  } catch {
    extractedText = null; // extraction is best-effort
  }

  const count = await db.resume.count({ where: { profileId } });
  const resume = await db.resume.create({
    data: {
      profileId,
      label: cleanLabel,
      originalFilename: safeFilename(file.name),
      storedFilename,
      mimeType: "application/pdf",
      sizeBytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      extractedText,
      isDefault: false,
    },
  });
  if (makeDefault || count === 0) await setDefaultResume(profileId, resume.id);
  return db.resume.findUniqueOrThrow({ where: { id: resume.id } });
}

export async function extractPdfText(bytes: Uint8Array): Promise<string | null> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  try {
    const result = await parser.getText();
    const text = result.text.replace(/\u0000/g, "").trim();
    return text ? text.slice(0, 50_000) : null;
  } finally {
    await parser.destroy();
  }
}

export async function listResumes(profileId: string) {
  return db.resume.findMany({ where: { profileId }, orderBy: [{ isDefault: "desc" }, { uploadedAt: "desc" }] });
}

export async function getResume(profileId: string, resumeId: string) {
  const r = await db.resume.findFirst({ where: { id: resumeId, profileId } });
  if (!r) throw new NotFoundError("Résumé");
  return r;
}

export function resumeFilePath(r: { profileId: string; storedFilename: string }): string {
  // storedFilename is a server-generated UUID; still guard against traversal.
  const name = path.basename(r.storedFilename);
  return path.join(resumeStorageDir(), r.profileId, name);
}

/** Read the file and confirm its hash still matches what was uploaded. */
export async function readResumeFile(profileId: string, resumeId: string): Promise<{ bytes: Buffer; resume: Awaited<ReturnType<typeof getResume>> }> {
  const resume = await getResume(profileId, resumeId);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(resumeFilePath(resume));
  } catch {
    throw new UserError("The résumé file is missing from local storage. Upload it again.");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== resume.sha256) {
    throw new UserError("The stored résumé file does not match its recorded checksum. Upload it again.");
  }
  return { bytes, resume };
}

export async function setDefaultResume(profileId: string, resumeId: string) {
  await getResume(profileId, resumeId);
  await db.$transaction([
    db.resume.updateMany({ where: { profileId }, data: { isDefault: false } }),
    db.resume.update({ where: { id: resumeId }, data: { isDefault: true } }),
  ]);
}

export async function renameResume(profileId: string, resumeId: string, label: string) {
  await getResume(profileId, resumeId);
  return db.resume.update({ where: { id: resumeId }, data: { label: label.trim().slice(0, 40) || "General" } });
}

export async function deleteResume(profileId: string, resumeId: string) {
  const r = await getResume(profileId, resumeId);
  const pending = await db.emailDraft.count({ where: { resumeId, sendState: { in: ["DRAFT", "SENDING"] } } });
  if (pending) throw new UserError(`This résumé is attached to ${pending} unsent draft(s). Change their attachment first.`);
  await db.resume.delete({ where: { id: resumeId } });
  await fs.rm(resumeFilePath(r), { force: true });
  if (r.isDefault) {
    const next = await db.resume.findFirst({ where: { profileId }, orderBy: { uploadedAt: "desc" } });
    if (next) await db.resume.update({ where: { id: next.id }, data: { isDefault: true } });
  }
}

export async function defaultResume(profileId: string) {
  return db.resume.findFirst({ where: { profileId, isDefault: true } });
}

/**
 * Suggest highlight candidates from extracted résumé text. Suggestions are NEVER
 * auto-confirmed: the candidate must review and confirm each one.
 */
export function suggestHighlightsFromText(text: string): { kind: "EXPERIENCE" | "PROJECT" | "EDUCATION" | "CERTIFICATION" | "ACHIEVEMENT"; title: string; summary: string }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•●▪\-–*]+/, "").trim())
    .filter((l) => l.length >= 8 && l.length <= 220);
  const out: { kind: "EXPERIENCE" | "PROJECT" | "EDUCATION" | "CERTIFICATION" | "ACHIEVEMENT"; title: string; summary: string }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let kind: (typeof out)[number]["kind"] | null = null;
    if (/\b(intern|internship|analyst|associate|trainee|manager|executive|consultant)\b/i.test(line) && /\b(at|@|,|–|-|\|)\b/.test(line)) kind = "EXPERIENCE";
    else if (/\b(project|case study|capstone|live project)\b/i.test(line)) kind = "PROJECT";
    else if (/\b(mba|pgdm|b\.?com|bba|b\.?tech|bachelor|master|university|institute|college|cfa|ca inter|frm)\b/i.test(line)) kind = "EDUCATION";
    else if (/\b(certif|course|nism|modelling course)\b/i.test(line)) kind = "CERTIFICATION";
    else if (/\b(winner|rank|award|top \d|increased|grew|improved|reduced|\d+%)\b/i.test(line)) kind = "ACHIEVEMENT";
    if (!kind) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, title: line.slice(0, 120), summary: line });
    if (out.length >= 25) break;
  }
  return out;
}
