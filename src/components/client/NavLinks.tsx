"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const active = i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`);
        return (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-indigo-50 text-indigo-800" : "text-slate-700 hover:bg-slate-100"}`}
            >
              <span>{i.label}</span>
              {i.badge ? <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{i.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
