import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { DuplicateContactError } from "./services/contacts";
import { UserError } from "./services/errors";

export interface ActionState<T = unknown> {
  ok: boolean;
  message?: string;
  error?: string;
  data?: T;
  at?: number; // lets clients detect a new result
}

export const initialState: ActionState = { ok: false };

/** Convert errors into user-safe messages. Unexpected errors are logged server-side without details. */
export function toErrorMessage(e: unknown): string {
  if (e instanceof DuplicateContactError) return `${e.message} (${e.matches.map((m) => m.reason.toLowerCase().replace(/_/g, " ")).join(", ")})`;
  if (e instanceof UserError) return e.message;
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  if (e instanceof Error && e.message === "Unauthorized") return "Unauthorized";
  console.error("[careerreach] unexpected error:", e instanceof Error ? e.message : e);
  return "Something went wrong. Check the server log for details.";
}

export async function run<T>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<ActionState<T>> {
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data, message: typeof success === "function" ? success(data) : success, at: Date.now() };
  } catch (e) {
    // Let Next.js redirects/not-found propagate.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    return { ok: false, error: toErrorMessage(e), at: Date.now() };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}
