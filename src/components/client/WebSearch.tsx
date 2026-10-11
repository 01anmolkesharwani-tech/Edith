"use client";

import { useActionState } from "react";
import { ActionForm, ActionMessage, SubmitButton, type ClientActionState } from "./ActionForm";

type Result = ClientActionState & { data?: { title: string; url: string; description: string | null }[] };

export function WebSearch({
  search,
  researchPage,
  companyId,
  defaultQuery,
}: {
  search: (s: Result, fd: FormData) => Promise<Result>;
  researchPage: (s: ClientActionState, fd: FormData) => Promise<ClientActionState>;
  companyId: string;
  defaultQuery: string;
}) {
  const [state, action] = useActionState(search, { ok: false });
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap gap-2">
        <label htmlFor="ws-q" className="sr-only">Query</label>
        <input id="ws-q" name="q" defaultValue={defaultQuery} className="min-w-[16rem] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <SubmitButton pendingLabel="Searching…">Search</SubmitButton>
      </form>
      <ActionMessage state={state} />
      {state.data?.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {state.data.map((r) => (
            <li key={r.url} className="py-2">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 underline">{r.title || r.url}</a>
              <div className="text-xs text-slate-500">{r.url}</div>
              {r.description ? <p className="text-xs text-slate-600">{r.description}</p> : null}
              <ActionForm action={researchPage} submitLabel="Retrieve page & extract people" pendingLabel="Retrieving…" className="mt-1 flex flex-wrap items-center gap-2" submitClassName="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50">
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="url" value={r.url} />
                <label className="text-xs text-slate-600" htmlFor={`st-${r.url}`}>Source type</label>
                <select id={`st-${r.url}`} name="sourceType" defaultValue="PUBLIC_DIRECTORY" className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                  <option value="OFFICIAL_TEAM_PAGE">Official team page</option>
                  <option value="OFFICIAL_BIO">Official biography</option>
                  <option value="OFFICIAL_ANNOUNCEMENT">Official announcement</option>
                  <option value="NEWS_ARTICLE">News article</option>
                  <option value="PUBLIC_DIRECTORY">Public directory</option>
                </select>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
