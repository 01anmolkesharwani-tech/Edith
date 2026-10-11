"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">The error has been logged on the server{error.digest ? ` (reference ${error.digest})` : ""}. No email was sent as a result of this error.</p>
      <button onClick={reset} className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Try again</button>
    </div>
  );
}
