import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { escapeCsvCell, guessMapping, mapAndValidate, parseCsv, toCsv } from "@/lib/csv/csv";

describe("CSV import parsing", () => {
  const text = "﻿Name,Job Title,Company,Email,Source URL\nPriya Sharma,Brand Manager,Acme,priya@acme.com,https://acme.com/team\nX,,,not-an-email,\n";
  it("parses and guesses the column mapping", () => {
    const p = parseCsv(text);
    expect(p.headers).toEqual(["Name", "Job Title", "Company", "Email", "Source URL"]);
    expect(guessMapping(p.headers)).toMatchObject({ fullName: "Name", title: "Job Title", company: "Company", email: "Email", sourceUrl: "Source URL" });
  });
  it("validates rows and reports errors per row", () => {
    const p = parseCsv(text);
    const rows = mapAndValidate(p.rows, guessMapping(p.headers));
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors.join(" ")).toMatch(/Name is required|email/);
  });
});

describe("CSV export", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+1+2", "-2+3", "@SUM(A1)", "\tcmd"])("neutralises formula %s", (v) => {
    expect(escapeCsvCell(v).startsWith("'")).toBe(true);
  });
  it("leaves ordinary values alone and quotes all cells", () => {
    const csv = toCsv(["Name", "Note"], [["Priya", 'said "hi", then left']]);
    const back = Papa.parse<string[]>(csv).data;
    expect(back[1]).toEqual(["Priya", 'said "hi", then left']);
  });
});
