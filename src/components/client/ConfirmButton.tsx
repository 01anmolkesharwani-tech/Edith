"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState, type ReactNode } from "react";

/**
 * Accessible confirmation dialog (Radix). Submits the surrounding form only after the user confirms.
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  className,
  tone = "danger",
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  className?: string;
  tone?: "danger" | "primary";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button ref={triggerRef} type="button" className={className ?? "inline-flex items-center rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"}>
          {children}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-xl focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-slate-900">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2 text-sm text-slate-600">{description}</div>
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</Dialog.Close>
            <button
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-medium text-white ${tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.closest("form")?.requestSubmit();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
