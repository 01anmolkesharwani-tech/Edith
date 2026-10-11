"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export interface ClientActionState {
  ok: boolean;
  message?: string;
  error?: string;
  at?: number;
}

type Action = (state: ClientActionState, fd: FormData) => Promise<ClientActionState>;

export function SubmitButton({ children, pendingLabel, className, disabled, pending: pendingProp }: { children: ReactNode; pendingLabel?: string; className?: string; disabled?: boolean; pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending} className={className ?? "inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

export function ActionMessage({ state }: { state: ClientActionState }) {
  if (state.error) return <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>;
  if (state.ok && state.message) return <p role="status" className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

/** A form bound to a server action with inline success/error feedback. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  className = "space-y-3",
  submitClassName,
  resetOnSuccess = false,
  footer,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  submitClassName?: string;
  resetOnSuccess?: boolean;
  footer?: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, { ok: false });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      // Submit via a transition so React does not auto-reset the form: on a validation
      // error the user keeps what they typed. (`action` remains for no-JS submission.)
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className={className}
    >
      {children}
      {submitLabel ? (
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel={pendingLabel} className={submitClassName} pending={isPending}>
            {submitLabel}
          </SubmitButton>
          {footer}
        </div>
      ) : null}
      <ActionMessage state={state} />
    </form>
  );
}
