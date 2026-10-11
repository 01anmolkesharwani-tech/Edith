import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "cr_auth";

export function authToken(password: string): string {
  return createHmac("sha256", password).update("careerreach-session-v1").digest("hex");
}

export function tokenMatches(token: string | undefined): boolean {
  const pw = process.env.CAREERREACH_ACCESS_PASSWORD;
  if (!pw) return true;
  if (!token) return false;
  const expected = Buffer.from(authToken(pw));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
