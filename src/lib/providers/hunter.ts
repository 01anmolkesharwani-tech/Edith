/**
 * OPTIONAL Hunter.io Email Verifier adapter. Runs only when HUNTER_API_KEY is set.
 * Hunter's free plan provides a small monthly credit allowance (50 credits/month per its
 * help centre when reviewed); check your plan before relying on API access.
 * Docs: https://hunter.io/api-documentation/v2#email-verifier
 */
import { ProviderError } from "./types";
import type { Result } from "@/lib/email/validation";

export function hunterConfigured(): boolean {
  return !!process.env.HUNTER_API_KEY;
}

export interface ProviderVerification {
  result: Result;
  details: string;
}

export function mapHunterStatus(status: string | undefined, score?: number): ProviderVerification {
  switch (status) {
    case "valid":
      return { result: "PASS", details: `Hunter status: valid${score != null ? ` (score ${score})` : ""}` };
    case "invalid":
      return { result: "FAIL", details: "Hunter status: invalid" };
    case "accept_all":
      return { result: "CATCH_ALL", details: "Hunter status: accept_all (catch-all domain)" };
    case "disposable":
      return { result: "FAIL", details: "Hunter status: disposable address" };
    case "webmail":
      return { result: "INCONCLUSIVE", details: "Hunter status: webmail (personal email provider)" };
    default:
      return { result: "INCONCLUSIVE", details: `Hunter status: ${status ?? "unknown"}` };
  }
}

export async function hunterVerify(
  email: string,
  doFetch: (url: string) => Promise<{ status: number; json: () => Promise<unknown> }> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(30_000) }),
): Promise<ProviderVerification> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) throw new ProviderError("hunter", "UNAVAILABLE", "HUNTER_API_KEY is not set.");
  const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await doFetch(url);
  } catch (e) {
    throw new ProviderError("hunter", "NETWORK", (e as Error).message);
  }
  if (res.status === 429) throw new ProviderError("hunter", "RATE_LIMITED", "Hunter quota or rate limit reached.");
  if (res.status === 401 || res.status === 403) throw new ProviderError("hunter", "UNAVAILABLE", "Hunter rejected the API key or plan.");
  if (res.status === 202) return { result: "INCONCLUSIVE", details: "Hunter is still processing this address; try again later." };
  if (res.status !== 200) throw new ProviderError("hunter", "NETWORK", `HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { status?: string; score?: number } };
  return mapHunterStatus(body.data?.status, body.data?.score);
}
