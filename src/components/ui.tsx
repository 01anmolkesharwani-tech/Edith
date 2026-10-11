import Link from "next/link";
import type { ReactNode } from "react";

export const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:bg-slate-50";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
  primary: `${buttonBase} bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500`,
  secondary: `${buttonBase} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-indigo-500`,
  danger: `${buttonBase} bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500`,
  ghost: `${buttonBase} shadow-none text-slate-600 hover:bg-slate-100 focus-visible:ring-indigo-500`,
  small: "inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
};

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, description, children, actions, id, className = "" }: { title?: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div>
            {title ? <h2 className="text-base font-semibold text-slate-900">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

const tones: Record<string, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  indigo: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  purple: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ tone = "gray", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone] ?? tones.gray}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: string; href?: string; tone?: "warn" }) {
  const body = (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${tone === "warn" ? "border-amber-300" : "border-slate-200"} ${href ? "hover:border-indigo-300" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "blue" | "green"; children: ReactNode }) {
  const map = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    red: "border-red-300 bg-red-50 text-red-900",
    blue: "border-sky-300 bg-sky-50 text-sky-900",
    green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  };
  return <div role="note" className={`rounded-md border px-4 py-3 text-sm ${map[tone]}`}>{children}</div>;
}

export function Field({ label, htmlFor, hint, children, className = "" }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ExternalLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  let safe: string | null = null;
  try {
    const u = new URL(href);
    if (u.protocol === "http:" || u.protocol === "https:") safe = u.toString();
  } catch {
    safe = null;
  }
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={`text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900 ${className}`}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={`bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top text-slate-700 ${className}`}>{children}</td>;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
