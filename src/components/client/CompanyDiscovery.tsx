"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import type { CompanyCandidate } from "@/lib/services/discovery";
import { ActionMessage, SubmitButton, type ClientActionState } from "./ActionForm";

type Result = ClientActionState & { data?: { candidates: CompanyCandidate[]; resolved: Record<string, string> } };

export function CompanyDiscovery({
  discover,
  save,
  defaults,
}: {
  discover: (s: Result, fd: FormData) => Promise<Result>;
  save: (c: CompanyCandidate) => Promise<ClientActionState & { data?: { id: string } }>;
  defaults: { industry: string; country: string };
}) {
  const [state, action] = useActionState(discover, { ok: false });
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const input = "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
        <div>
          <label htmlFor="d-industry" className="mb-1 block text-xs font-medium text-slate-700">Industry</label>
          <input id="d-industry" name="industry" defaultValue={defaults.industry} className={input} placeholder="e.g. food industry, investment banking" />
        </div>
        <div>
          <label htmlFor="d-country" className="mb-1 block text-xs font-medium text-slate-700">Country (optional)</label>
          <input id="d-country" name="country" defaultValue={defaults.country} className={input} placeholder="e.g. India" />
        </div>
        <div>
          <label htmlFor="d-name" className="mb-1 block text-xs font-medium text-slate-700">…or company name</label>
          <input id="d-name" name="name" className={input} placeholder="Overrides industry search" />
        </div>
        <SubmitButton pendingLabel="Searching Wikidata…">Search Wikidata</SubmitButton>
      </form>
      <ActionMessage state={state} />
      {state.data?.resolved && Object.keys(state.data.resolved).length ? (
        <p className="text-xs text-slate-500">Interpreted as: {Object.entries(state.data.resolved).map(([k, v]) => `${k} = ${v}`).join(" · ")}</p>
      ) : null}
      {state.data?.candidates.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
              <tr><th className="px-3 py-2">Company</th><th className="px-3 py-2">Industry</th><th className="px-3 py-2">HQ / country</th><th className="px-3 py-2">Website</th><th className="px-3 py-2">Source</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.data.candidates.map((c) => {
                const id = saved[c.wikidataId] ?? c.existingCompanyId;
                return (
                  <tr key={c.wikidataId}>
                    <td className="px-3 py-2"><div className="font-medium text-slate-900">{c.name}</div><div className="text-xs text-slate-500">{c.description}</div></td>
                    <td className="px-3 py-2 text-xs">{c.industry ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{[c.headquarters, c.country].filter(Boolean).join(", ") || "—"}{c.employees ? <div>{c.employees.toLocaleString("en")} employees</div> : null}</td>
                    <td className="px-3 py-2 text-xs">{c.website ? <a className="text-indigo-700 underline" href={c.website} target="_blank" rel="noopener noreferrer">{c.website.replace(/^https?:\/\//, "")}</a> : <span className="text-amber-700">no website on record</span>}</td>
                    <td className="px-3 py-2 text-xs"><a className="text-indigo-700 underline" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">Wikidata {c.wikidataId}</a></td>
                    <td className="px-3 py-2 text-right">
                      {c.excluded ? (
                        <span className="text-xs text-red-700">Excluded</span>
                      ) : id && (saved[c.wikidataId] || c.existingCompanyId) ? (
                        <Link href={`/companies/${id}`} className="text-xs font-medium text-indigo-700 underline">{saved[c.wikidataId] ? "Added – open" : "Already saved – open"}</Link>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const r = await save(c);
                              if (r.ok && r.data) setSaved((s) => ({ ...s, [c.wikidataId]: r.data!.id }));
                              else setErrors((e) => ({ ...e, [c.wikidataId]: r.error ?? "Failed" }));
                            })
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                        >
                          Add as target
                        </button>
                      )}
                      {errors[c.wikidataId] ? <div className="text-xs text-red-700">{errors[c.wikidataId]}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
