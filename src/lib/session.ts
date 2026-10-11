import "server-only";
import { cookies } from "next/headers";
import { db } from "./db";
import { ensureDefaultProfiles } from "./services/profiles";
import { AUTH_COOKIE, authToken, tokenMatches } from "./session-token";

export const PROFILE_COOKIE = "cr_profile";
export { AUTH_COOKIE, authToken, tokenMatches };

/** Optional app password (set CAREERREACH_ACCESS_PASSWORD). */
export function accessPasswordConfigured(): boolean {
  return !!process.env.CAREERREACH_ACCESS_PASSWORD;
}

/** Defence in depth: every server action re-checks access (the proxy also does). */
export async function requireAccess(): Promise<void> {
  if (!accessPasswordConfigured()) return;
  const jar = await cookies();
  if (!tokenMatches(jar.get(AUTH_COOKIE)?.value)) throw new Error("Unauthorized");
}

/** The active candidate profile, resolved on the server from a cookie (never trusted from forms). */
export async function getActiveProfile() {
  await requireAccess();
  await ensureDefaultProfiles();
  const jar = await cookies();
  const id = jar.get(PROFILE_COOKIE)?.value;
  const profile =
    (id ? await db.candidateProfile.findUnique({ where: { id } }) : null) ??
    (await db.candidateProfile.findFirst({ orderBy: { createdAt: "asc" } }));
  if (!profile) throw new Error("No profile");
  return profile;
}

export async function activeProfileId(): Promise<string> {
  return (await getActiveProfile()).id;
}
