/** CSV import parsing/validation and safe export. */
import Papa from "papaparse";
import { z } from "zod";
import { checkSyntax } from "@/lib/email/validation";
import { normalizeUrl } from "@/lib/normalize";

export const IMPORT_FIELDS = [
  { key: "fullName", label: "Contact name", required: true },
  { key: "title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "website", label: "Company website" },
  { key: "profileUrl", label: "Professional profile URL" },
  { key: "email", label: "Professional email" },
  { key: "phone", label: "Business phone" },
  { key: "location", label: "Location" },
  { key: "sourceUrl", label: "Source URL" },
  { key: "notes", label: "Notes" },
  { key: "profile", label: "Candidate profile (slug)" },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<ImportFieldKey, string>>;

const ALIASES: Record<ImportFieldKey, string[]> = {
  fullName: ["name", "full name", "contact name", "contact"],
  title: ["title", "job title", "position", "role", "designation"],
  company: ["company", "organisation", "organization", "employer", "firm"],
  website: ["website", "company website", "domain", "url"],
  profileUrl: ["profile url", "linkedin", "linkedin url", "professional profile url", "profile"],
  email: ["email", "e-mail", "professional email", "work email", "email address"],
  phone: ["phone", "business phone", "telephone", "phone number"],
  location: ["location", "city", "country"],
  sourceUrl: ["source", "source url", "evidence url"],
  notes: ["notes", "note", "comments"],
  profile: ["candidate profile", "profile slug", "candidate", "portal"],
};

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[]; errors: string[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: res.meta.fields ?? [],
    rows: res.data.slice(0, 5000),
    errors: res.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`),
  };
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const f of IMPORT_FIELDS) {
    const hit = headers.find((h) => ALIASES[f.key].includes(h.toLowerCase()) || h.toLowerCase() === f.label.toLowerCase());
    if (hit) mapping[f.key] = hit;
  }
  if (mapping.website && mapping.website === mapping.profileUrl) delete mapping.website;
  return mapping;
}

const rowSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required").max(120),
  title: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  website: z.string().trim().max(500).optional(),
  profileUrl: z.string().trim().max(500).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(200).optional(),
  sourceUrl: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(5000).optional(),
  profile: z.string().trim().max(60).optional(),
});

export type ImportRow = z.infer<typeof rowSchema>;

export interface ValidatedRow {
  index: number;
  data: ImportRow | null;
  errors: string[];
  warnings: string[];
}

export function mapAndValidate(rows: Record<string, string>[], mapping: ColumnMapping): ValidatedRow[] {
  return rows.map((raw, index) => {
    const obj: Record<string, string | undefined> = {};
    for (const f of IMPORT_FIELDS) {
      const col = mapping[f.key];
      const v = col ? raw[col]?.trim() : undefined;
      obj[f.key] = v ? v : undefined;
    }
    const parsed = rowSchema.safeParse(obj);
    if (!parsed.success) {
      return { index, data: null, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), warnings: [] };
    }
    const data = parsed.data;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (data.email) {
      const s = checkSyntax(data.email);
      if (!s.ok) errors.push(`email: ${s.reason}`);
    }
    for (const k of ["website", "profileUrl", "sourceUrl"] as const) {
      if (data[k] && !normalizeUrl(data[k])) errors.push(`${k}: not a valid http(s) URL`);
    }
    if (!data.sourceUrl) warnings.push("No source URL – the contact will be recorded as imported without source evidence.");
    if (!data.company) warnings.push("No company.");
    return { index, data, errors, warnings };
  });
}

/** Neutralise spreadsheet formula injection (=, +, -, @, tab, CR) in exported cells. */
export function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return Papa.unparse(
    { fields: headers, data: rows.map((r) => r.map(escapeCsvCell)) },
    { quotes: true, newline: "\r\n" },
  );
}
