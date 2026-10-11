"use client";

import { useRef } from "react";

export function ProfileSwitcher({
  profiles,
  activeId,
  action,
}: {
  profiles: { id: string; portalName: string; candidateName: string | null }[];
  activeId: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} className="flex items-center gap-2">
      <label htmlFor="profile-switch" className="text-xs font-medium text-slate-500">
        Candidate portal
      </label>
      <select
        id="profile-switch"
        name="profileId"
        defaultValue={activeId}
        onChange={() => ref.current?.requestSubmit()}
        className="rounded-md border border-slate-300 bg-white py-1.5 pl-2 pr-8 text-sm font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.portalName}
            {p.candidateName ? ` — ${p.candidateName}` : " — (name not set)"}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="rounded border px-2 py-1 text-xs">Switch</button>
      </noscript>
    </form>
  );
}
