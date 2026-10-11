/**
 * OPTIONAL Brave Search API adapter (web search). Not required by any core workflow.
 * As reviewed for this build, Brave's plans require an account and a payment method on file;
 * the monthly free credit covers a limited number of requests and usage beyond it is billed.
 * The app never enables this silently: it runs only when BRAVE_SEARCH_API_KEY is set.
 */
import { ProviderError } from "./types";

export interface WebResult {
  title: string;
  url: string;
  description: string | null;
}

export function braveConfigured(): boolean {
  return !!process.env.BRAVE_SEARCH_API_KEY;
}

/** Brave needs a custom auth header, so it uses its own request through an injected fetch function. */
export async function braveSearch(
  query: string,
  doFetch: (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json: () => Promise<unknown> }> = (
    url,
    init,
  ) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }),
  count = 10,
): Promise<WebResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new ProviderError("brave", "UNAVAILABLE", "BRAVE_SEARCH_API_KEY is not set.");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0, 400))}&count=${count}`;
  let res;
  try {
    res = await doFetch(url, { headers: { accept: "application/json", "x-subscription-token": key } });
  } catch (e) {
    throw new ProviderError("brave", "NETWORK", (e as Error).message);
  }
  if (res.status === 429) throw new ProviderError("brave", "RATE_LIMITED", "Brave Search rate limit or quota reached.");
  if (res.status === 401 || res.status === 403) throw new ProviderError("brave", "UNAVAILABLE", "Brave Search rejected the API key.");
  if (res.status !== 200) throw new ProviderError("brave", "NETWORK", `HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (data.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: (r.title ?? "").replace(/<[^>]+>/g, ""),
      url: r.url as string,
      description: r.description ? r.description.replace(/<[^>]+>/g, "") : null,
    }));
}
