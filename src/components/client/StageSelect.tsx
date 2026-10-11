"use client";

import { useRef } from "react";
import { STAGE_LABELS, STAGES } from "@/lib/domain/stages";

export function StageSelect({ contactId, stage, action }: { contactId: string; stage: string; action: (fd: FormData) => Promise<void> }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action}>
      <input type="hidden" name="id" value={contactId} />
      <label className="sr-only" htmlFor={`stage-${contactId}`}>Stage</label>
      <select id={`stage-${contactId}`} name="stage" defaultValue={stage} onChange={() => ref.current?.requestSubmit()} className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs">
        {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
      </select>
    </form>
  );
}
