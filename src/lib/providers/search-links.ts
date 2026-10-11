/**
 * Manual research helpers. These produce editable queries and browser links that the
 * user opens themselves. A search link is NOT a retrieved or verified contact record.
 */

export interface SearchLink {
  label: string;
  url: string;
  engine: string;
}

export function buildContactQueries(input: {
  company: string;
  domain?: string | null;
  titles: string[];
  location?: string | null;
}): string[] {
  const loc = input.location ? ` ${input.location}` : "";
  const titles = input.titles.length ? input.titles : ["recruiter", "talent acquisition", "hiring manager"];
  const queries = titles.slice(0, 8).map((t) => `"${input.company}" "${t}"${loc}`);
  if (input.domain) {
    queries.push(`site:${input.domain} (team OR leadership OR "our people")`);
    queries.push(`"@${input.domain}" ${titles[0] ?? "recruiter"}`);
  }
  return queries;
}

export function buildCompanyQueries(input: { industry?: string; location?: string; role?: string }): string[] {
  const parts = [input.industry, input.location].filter(Boolean).join(" ");
  const out = [`${parts} companies`.trim()];
  if (input.role) out.push(`${input.role} jobs ${input.location ?? ""}`.trim());
  if (input.industry) out.push(`top ${input.industry} companies ${input.location ?? ""} careers`.trim());
  return out;
}

export function searchLinks(query: string): SearchLink[] {
  const q = encodeURIComponent(query);
  return [
    { engine: "google", label: "Google", url: `https://www.google.com/search?q=${q}` },
    { engine: "bing", label: "Bing", url: `https://www.bing.com/search?q=${q}` },
    { engine: "duckduckgo", label: "DuckDuckGo", url: `https://duckduckgo.com/?q=${q}` },
  ];
}

/** LinkedIn people search opened by the user in their own browser session (never fetched by the app). */
export function linkedInPeopleSearch(company: string, title: string): SearchLink {
  const q = encodeURIComponent(`${title} ${company}`);
  return { engine: "linkedin", label: "LinkedIn (opens in your browser)", url: `https://www.linkedin.com/search/results/people/?keywords=${q}` };
}

/** Hosts whose terms prohibit automated collection — the app never fetches these. */
export const NEVER_FETCH_HOSTS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "glassdoor.com",
  "indeed.com",
  "naukri.com",
  "zoominfo.com",
  "apollo.io",
  "rocketreach.co",
  "crunchbase.com",
  "google.com",
  "bing.com",
  "duckduckgo.com",
];

export function isNeverFetchHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return NEVER_FETCH_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}
