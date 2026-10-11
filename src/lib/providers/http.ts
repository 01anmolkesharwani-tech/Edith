import { FetchError, type Fetcher, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { ProviderError } from "./types";

/** GET a documented JSON API through the SSRF-safe fetcher and map failures to ProviderError. */
export async function getJson<T>(fetcher: Fetcher, provider: string, url: string, userAgent?: string): Promise<T> {
  let res;
  try {
    res = await fetcher(url, {
      accept: "application/json",
      allowedTypes: ["application/json", "application/sparql-results+json", "text/json"],
      userAgent,
      maxBytes: 5_000_000,
      timeoutMs: 20_000,
    });
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new ProviderError(provider, "BLOCKED", e.message);
    if (e instanceof FetchError) throw new ProviderError(provider, "NETWORK", e.message);
    throw new ProviderError(provider, "NETWORK", (e as Error).message);
  }
  if (res.status === 404) throw new ProviderError(provider, "NOT_FOUND", "Not found (check the board/company identifier).");
  if (res.status === 429) {
    const ra = Number(res.headers["retry-after"]);
    throw new ProviderError(provider, "RATE_LIMITED", "Rate limited by the provider.", Number.isFinite(ra) ? ra : undefined);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError(provider, "UNAVAILABLE", `Access denied (${res.status}).`);
  if (res.status < 200 || res.status >= 300) throw new ProviderError(provider, "NETWORK", `HTTP ${res.status}`);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new ProviderError(provider, "INVALID", "Response was not valid JSON.");
  }
}

export function stripHtml(s: string | null | undefined, max = 600): string | null {
  if (!s) return null;
  const text = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}
