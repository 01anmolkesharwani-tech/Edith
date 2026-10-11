"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bool, formObject, run, str, type ActionState } from "@/lib/action-utils";
import { db } from "@/lib/db";
import { activeProfileId, AUTH_COOKIE, authToken, PROFILE_COOKIE, requireAccess } from "@/lib/session";
import {
  createProfile,
  deleteHighlight,
  saveHighlight,
  setHighlightConfirmed,
  updateProfile,
} from "@/lib/services/profiles";
import { recomputeAllForProfile } from "@/lib/services/contacts";

const cookieOpts = { httpOnly: true, sameSite: "strict" as const, path: "/", secure: process.env.NODE_ENV === "production" && process.env.CAREERREACH_INSECURE_COOKIES !== "1" };

export async function switchProfileAction(formData: FormData) {
  await requireAccess();
  const id = str(formData, "profileId");
  const p = await db.candidateProfile.findUnique({ where: { id } });
  if (p) (await cookies()).set(PROFILE_COOKIE, p.id, { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}

export async function updateProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = await activeProfileId();
    await updateProfile(id, formObject(fd) as never);
    await recomputeAllForProfile(id);
  }, "Profile saved. Relevance scores were recalculated.");
}

export async function createProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requireAccess();
    const p = await createProfile({ portalName: str(fd, "portalName"), slug: str(fd, "slug") });
    (await cookies()).set(PROFILE_COOKIE, p.id, { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
  }, "Profile created and selected.");
}

export async function saveHighlightAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = await activeProfileId();
    await saveHighlight(
      id,
      {
        kind: str(fd, "kind") as never,
        title: str(fd, "title"),
        organization: str(fd, "organization"),
        summary: str(fd, "summary"),
        capabilities: str(fd, "capabilities"),
        tags: str(fd, "tags"),
        confirmed: bool(fd, "confirmed"),
      },
      str(fd, "id") || undefined,
      str(fd, "source") || "manual",
    );
  }, "Saved.");
}

export async function toggleHighlightAction(fd: FormData) {
  await setHighlightConfirmed(await activeProfileId(), str(fd, "id"), bool(fd, "confirmed"));
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/resumes");
}

export async function deleteHighlightAction(fd: FormData) {
  await deleteHighlight(await activeProfileId(), str(fd, "id"));
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/resumes");
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const pw = process.env.CAREERREACH_ACCESS_PASSWORD;
  if (!pw) redirect("/");
  // Constant-time comparison via HMAC tokens.
  const { tokenMatches } = await import("@/lib/session-token");
  const token = authToken(str(fd, "password"));
  if (!tokenMatches(token)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return { ok: false, error: "Incorrect password." };
  }
  (await cookies()).set(AUTH_COOKIE, token, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });
  redirect("/");
}

export async function logoutAction() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}
