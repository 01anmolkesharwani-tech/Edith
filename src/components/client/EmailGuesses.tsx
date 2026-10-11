"use client";

import { useActionState } from "react";
import { ActionForm, ActionMessage, SubmitButton, type ClientActionState } from "./ActionForm";

type Guesses = ClientActionState & { data?: { domain: string | null; inferred: string | null; candidates: string[]; basis: string } };

export function EmailGuesses({
  contactId,
  load,
  apply,
}: {
  contactId: string;
  load: (s: Guesses, fd: FormData) => Promise<Guesses>;
  apply: (s: ClientActionState, fd: FormData) => Promise<ClientActionState>;
}) {
  const [state, action] = useActionState(load, { ok: false });
  const d = state.data;
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="id" value={contactId} />
        <SubmitButton className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50">Show pattern-based guesses</SubmitButton>
      </form>
      <ActionMessage state={{ ...state, message: undefined }} />
      {d ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">These are guesses, not verified addresses.</p>
          <p className="mt-1">{d.basis}</p>
          <ul className="mt-2 space-y-1">
            {(d.inferred ? [d.inferred, ...d.candidates.filter((c) => c !== d.inferred)] : d.candidates).map((email) => (
              <li key={email} className="flex items-center justify-between gap-2">
                <span className="font-mono">{email}{email === d.inferred ? " (matches observed pattern)" : ""}</span>
                <ActionForm action={apply} className="inline" submitLabel="Use (unverified)" submitClassName="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs">
                  <input type="hidden" name="id" value={contactId} />
                  <input type="hidden" name="email" value={email} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
