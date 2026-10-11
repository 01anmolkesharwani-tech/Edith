import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-xl font-semibold text-slate-900">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">This record does not exist in the active candidate portal. Records are never shared between portals – switch portal if you expected to see it.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-indigo-700 underline">Back to dashboard</Link>
    </div>
  );
}
