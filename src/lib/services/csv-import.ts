import { db } from "@/lib/db";
import { guessMapping, IMPORT_FIELDS, mapAndValidate, parseCsv, toCsv, type ColumnMapping, type ValidatedRow } from "@/lib/csv/csv";
import { findDuplicates } from "@/lib/domain/dedupe";
import { normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePersonName, normalizeUrl } from "@/lib/normalize";
import { linkCompany, upsertCompany } from "./companies";
import { createContact, recomputeContact } from "./contacts";
import { logActivity } from "./activity";
import { UserError } from "./errors";

export const MAX_IMPORT_BYTES = 2_000_000;

export interface PreviewRow extends ValidatedRow {
  duplicateOf: { id: string; name: string; reason: string } | null;
  duplicateInFile: number | null;
  otherProfile: boolean;
}

export async function previewImport(profileId: string, text: string, mapping?: ColumnMapping) {
  if (text.length > MAX_IMPORT_BYTES) throw new UserError("CSV file is too large (max 2 MB).");
  const profile = await db.candidateProfile.findUniqueOrThrow({ where: { id: profileId } });
  const parsed = parseCsv(text);
  if (!parsed.headers.length) throw new UserError("The CSV has no header row.");
  const map = mapping ?? guessMapping(parsed.headers);
  const validated = mapAndValidate(parsed.rows, map);
  const pool = await db.contact.findMany({
    where: { profileId, mergedIntoId: null },
    select: { id: true, fullName: true, companyId: true, email: true, profileUrl: true, company: { select: { name: true } } },
  });
  const companies = await db.company.findMany({ select: { id: true, normalizedName: true, domain: true } });
  const seenKeys = new Map<string, number>();
  const rows: PreviewRow[] = validated.map((r) => {
    let duplicateOf: PreviewRow["duplicateOf"] = null;
    let duplicateInFile: number | null = null;
    const otherProfile = !!r.data?.profile && r.data.profile.toLowerCase() !== profile.slug;
    if (r.data) {
      const domain = normalizeDomain(r.data.website);
      const companyId =
        (domain && companies.find((c) => c.domain === domain)?.id) ||
        (r.data.company && companies.find((c) => c.normalizedName === normalizeCompanyName(r.data!.company!))?.id) ||
        null;
      const match = findDuplicates({ fullName: r.data.fullName, companyId, email: r.data.email, profileUrl: r.data.profileUrl }, pool)[0];
      if (match) {
        const c = pool.find((p) => p.id === match.id)!;
        duplicateOf = { id: c.id, name: `${c.fullName}${c.company ? ` (${c.company.name})` : ""}`, reason: match.reason };
      }
      const key = normalizeEmail(r.data.email) ?? `${normalizePersonName(r.data.fullName)}|${(r.data.company ?? "").toLowerCase()}`;
      if (seenKeys.has(key)) duplicateInFile = seenKeys.get(key)!;
      else seenKeys.set(key, r.index);
    }
    return { ...r, duplicateOf, duplicateInFile, otherProfile };
  });
  return { headers: parsed.headers, mapping: map, parseErrors: parsed.errors, rows, fields: IMPORT_FIELDS };
}

export type MergeMode = "skip" | "fill" | "create";

export async function runImport(profileId: string, text: string, mapping: ColumnMapping, mergeMode: MergeMode) {
  const preview = await previewImport(profileId, text, mapping);
  const report = { created: 0, merged: 0, skipped: 0, errors: [] as string[] };
  for (const row of preview.rows) {
    const line = row.index + 2;
    if (!row.data || row.errors.length) {
      report.skipped++;
      report.errors.push(`Row ${line}: ${row.errors.join("; ")}`);
      continue;
    }
    if (row.otherProfile) {
      report.skipped++;
      report.errors.push(`Row ${line}: belongs to profile "${row.data.profile}" – switch to that profile to import it.`);
      continue;
    }
    if (row.duplicateInFile != null) {
      report.skipped++;
      report.errors.push(`Row ${line}: duplicate of row ${row.duplicateInFile + 2} in this file.`);
      continue;
    }
    const d = row.data;
    try {
      let companyId: string | null = null;
      if (d.company || d.website) {
        const company = await upsertCompany({ name: d.company ?? normalizeDomain(d.website) ?? "Unknown", website: d.website }, "IMPORTED");
        await linkCompany(profileId, company.id, "TARGET").catch(() => undefined);
        companyId = company.id;
      }
      if (row.duplicateOf && mergeMode !== "create") {
        if (mergeMode === "skip") {
          report.skipped++;
          continue;
        }
        // fill: add only missing fields, record evidence for imported values (never "verified").
        const existing = await db.contact.findUniqueOrThrow({ where: { id: row.duplicateOf.id } });
        const patch: Record<string, unknown> = {};
        if (!existing.title && d.title) patch.title = d.title;
        if (!existing.location && d.location) patch.location = d.location;
        if (!existing.profileUrl && d.profileUrl) patch.profileUrl = normalizeUrl(d.profileUrl);
        if (!existing.email && d.email) Object.assign(patch, { email: d.email, emailNormalized: normalizeEmail(d.email), emailOrigin: "IMPORTED" });
        if (!existing.phone && d.phone) Object.assign(patch, { phone: d.phone, phoneType: "UNKNOWN" });
        if (!existing.companyId && companyId) patch.companyId = companyId;
        if (Object.keys(patch).length) await db.contact.update({ where: { id: existing.id }, data: patch });
        const ev = (
          [
            ["TITLE", d.title],
            ["EMAIL", d.email?.toLowerCase()],
            ["PHONE", d.phone],
            ["LOCATION", d.location],
          ] as const
        ).filter(([, v]) => !!v);
        if (ev.length) {
          await db.contactFieldEvidence.createMany({
            data: ev.map(([field, value]) => ({
              contactId: existing.id,
              field,
              value: value!,
              sourceUrl: normalizeUrl(d.sourceUrl),
              sourceType: "CSV_IMPORT",
              verificationMethod: "IMPORT",
              confidence: "LOW",
              origin: "IMPORTED",
              notes: "Merged from CSV import",
            })),
          });
        }
        await logActivity(db, { profileId, contactId: existing.id, type: "IMPORT", summary: "Merged data from CSV import" });
        await recomputeContact(existing.id);
        report.merged++;
        continue;
      }
      await createContact(
        profileId,
        {
          fullName: d.fullName,
          title: d.title,
          companyId,
          email: d.email,
          emailOrigin: d.email ? "IMPORTED" : null,
          phone: d.phone,
          location: d.location,
          profileUrl: d.profileUrl,
          notes: d.notes,
          sourceUrl: d.sourceUrl,
          sourceType: "CSV_IMPORT",
        },
        { origin: "IMPORTED", allowDuplicate: mergeMode === "create" },
      );
      report.created++;
    } catch (e) {
      report.skipped++;
      report.errors.push(`Row ${line}: ${(e as Error).message}`);
    }
  }
  return report;
}

export const EXPORT_FIELDS = {
  fullName: "Name",
  title: "Title",
  company: "Company",
  companyWebsite: "Company website",
  department: "Department",
  location: "Location",
  email: "Email",
  emailStatus: "Email status",
  emailOrigin: "Email origin",
  phone: "Phone",
  phoneType: "Phone type",
  profileUrl: "Profile URL",
  stage: "Outreach stage",
  relevanceScore: "Relevance score",
  origin: "Record origin",
  reviewState: "Review state",
  discoveredAt: "Discovered",
  roleConfirmedAt: "Role evidence date",
  sources: "Source URLs",
  notes: "Notes",
} as const;

export type ExportField = keyof typeof EXPORT_FIELDS;

export async function exportContactsCsv(profileId: string, fields: ExportField[], ids?: string[]) {
  const chosen = fields.length ? fields : (Object.keys(EXPORT_FIELDS) as ExportField[]);
  const contacts = await db.contact.findMany({
    where: { profileId, mergedIntoId: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    include: { company: true, evidence: { select: { sourceUrl: true } } },
    orderBy: { fullName: "asc" },
  });
  const rows = contacts.map((c) =>
    chosen.map((f) => {
      switch (f) {
        case "company":
          return c.company?.name ?? "";
        case "companyWebsite":
          return c.company?.website ?? "";
        case "sources":
          return [...new Set(c.evidence.map((e) => e.sourceUrl).filter(Boolean))].join(" ");
        default:
          return (c as Record<string, unknown>)[f] ?? "";
      }
    }),
  );
  return toCsv(chosen.map((f) => EXPORT_FIELDS[f]), rows);
}
