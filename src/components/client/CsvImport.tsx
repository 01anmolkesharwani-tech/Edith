"use client";

import { useState, useTransition } from "react";

interface PreviewRow {
  index: number;
  data: Record<string, string | undefined> | null;
  errors: string[];
  warnings: string[];
  duplicateOf: { id: string; name: string; reason: string } | null;
  duplicateInFile: number | null;
  otherProfile: boolean;
}

interface Preview {
  headers: string[];
  mapping: Record<string, string>;
  parseErrors: string[];
  rows: PreviewRow[];
  fields: readonly { key: string; label: string; required?: boolean }[];
}

interface Res<T> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

export function CsvImport({
  preview,
  runImport,
}: {
  preview: (text: string, mapping?: Record<string, string>) => Promise<Res<Preview>>;
  runImport: (text: string, mapping: Record<string, string>, mode: "skip" | "fill" | "create") => Promise<Res<{ created: number; merged: number; skipped: number; errors: string[] }>>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [data, setData] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"skip" | "fill" | "create">("skip");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ created: number; merged: number; skipped: number; errors: string[] } | null>(null);
  const [pending, start] = useTransition();

  function load(t: string, m?: Record<string, string>) {
    start(async () => {
      setError(null);
      const r = await preview(t, m);
      if (!r.ok || !r.data) return setError(r.error ?? "Could not read the CSV.");
      setData(r.data);
      setMapping(r.data.mapping);
    });
  }

  const valid = data?.rows.filter((r) => r.data && !r.errors.length && !r.otherProfile && r.duplicateInFile == null) ?? [];
  const dups = valid.filter((r) => r.duplicateOf);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="csv" className="mb-1 block text-xs font-medium text-slate-700">CSV file (UTF-8, header row, max 2 MB)</label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setReport(null);
            setFileName(f.name);
            if (f.size > 2_000_000) return setError("File is larger than 2 MB.");
            const t = await f.text();
            setText(t);
            load(t);
          }}
          className="block text-sm"
        />
      </div>
      {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {data && text ? (
        <>
          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">Column mapping for {fileName}</legend>
            <div className="grid gap-2 md:grid-cols-4">
              {data.fields.map((f) => (
                <label key={f.key} className="text-xs text-slate-700">
                  {f.label}{f.required ? " *" : ""}
                  <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })} className="mt-0.5 block w-full rounded border border-slate-300 px-1 py-1 text-xs">
                    <option value="">— not imported —</option>
                    {data.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" disabled={pending} onClick={() => load(text, mapping)} className="mt-3 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Apply mapping & re-validate</button>
          </fieldset>

          {data.parseErrors.length ? <ul className="list-disc pl-5 text-xs text-red-700">{data.parseErrors.map((e) => <li key={e}>{e}</li>)}</ul> : null}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-1.5">Row</th><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Title</th><th className="px-2 py-1.5">Company</th><th className="px-2 py-1.5">Email</th><th className="px-2 py-1.5">Result</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.slice(0, 200).map((r) => (
                  <tr key={r.index} className={r.errors.length || r.otherProfile ? "bg-red-50/50" : r.duplicateOf || r.duplicateInFile != null ? "bg-amber-50/50" : ""}>
                    <td className="px-2 py-1">{r.index + 2}</td>
                    <td className="px-2 py-1">{r.data?.fullName ?? "—"}</td>
                    <td className="px-2 py-1">{r.data?.title ?? ""}</td>
                    <td className="px-2 py-1">{r.data?.company ?? ""}</td>
                    <td className="px-2 py-1 font-mono">{r.data?.email ?? ""}</td>
                    <td className="px-2 py-1">
                      {r.errors.length ? <span className="text-red-700">{r.errors.join("; ")}</span> : r.otherProfile ? <span className="text-red-700">belongs to profile “{r.data?.profile}”</span> : r.duplicateInFile != null ? <span className="text-amber-700">duplicate of row {r.duplicateInFile + 2}</span> : r.duplicateOf ? <span className="text-amber-700">matches existing {r.duplicateOf.name} ({r.duplicateOf.reason.toLowerCase().replace(/_/g, " ")})</span> : <span className="text-emerald-700">new</span>}
                      {r.warnings.length ? <div className="text-slate-500">{r.warnings.join(" ")}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length > 200 ? <p className="px-2 py-1 text-xs text-slate-500">Showing the first 200 of {data.rows.length} rows.</p> : null}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-700">
              Existing matches ({dups.length})
              <select value={mode} onChange={(e) => setMode(e.target.value as never)} className="mt-0.5 block rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="skip">Skip them</option>
                <option value="fill">Merge safely (fill empty fields only, keep history)</option>
                <option value="create">Create separate records anyway</option>
              </select>
            </label>
            <button
              type="button"
              disabled={pending || !valid.length || !mapping.fullName}
              onClick={() =>
                start(async () => {
                  const r = await runImport(text, mapping, mode);
                  if (!r.ok || !r.data) return setError(r.error ?? "Import failed.");
                  setReport(r.data);
                  setData(null);
                })
              }
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {pending ? "Importing…" : `Import ${valid.length} valid row(s)`}
            </button>
            <span className="text-xs text-slate-500">Imported contacts are labelled “Imported” and are never marked verified.</span>
          </div>
        </>
      ) : null}
      {report ? (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Imported {report.created} · merged {report.merged} · skipped {report.skipped}
          {report.errors.length ? <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">{report.errors.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}
