/**
 * Wikidata (CC0). Used for company discovery and basic company facts.
 * - Entity search: https://www.wikidata.org/w/api.php?action=wbsearchentities
 * - SPARQL:        https://query.wikidata.org/sparql
 * Wikimedia asks automated clients to send a descriptive User-Agent with contact info
 * and to stay within the query service's per-client processing-time limits.
 */
import type { Fetcher } from "@/lib/net/safe-fetch";
import { getJson } from "./http";

export interface WikidataEntity {
  id: string;
  label: string;
  description: string | null;
}

export interface WikidataCompany {
  wikidataId: string;
  name: string;
  description: string | null;
  website: string | null;
  industry: string | null;
  headquarters: string | null;
  country: string | null;
  employees: number | null;
  sourceUrl: string;
}

export async function searchEntities(
  fetcher: Fetcher,
  term: string,
  userAgent: string,
  limit = 7,
): Promise<WikidataEntity[]> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbsearchentities",
    search: term.slice(0, 120),
    language: "en",
    uselang: "en",
    type: "item",
    limit: String(limit),
    format: "json",
  }).toString();
  const data = await getJson<{ search?: { id: string; label?: string; description?: string }[] }>(
    fetcher,
    "wikidata",
    url.toString(),
    userAgent,
  );
  return (data.search ?? []).map((s) => ({ id: s.id, label: s.label ?? s.id, description: s.description ?? null }));
}

const QID = /^Q\d{1,12}$/;

type Binding = Record<string, { value: string } | undefined>;

function toCompany(b: Binding): WikidataCompany | null {
  const uri = b.company?.value;
  const id = uri?.split("/").pop();
  if (!id || !QID.test(id)) return null;
  const emp = Number(b.employees?.value);
  return {
    wikidataId: id,
    name: b.companyLabel?.value ?? id,
    description: b.companyDescription?.value ?? null,
    website: b.website?.value ?? null,
    industry: b.industryLabel?.value ?? null,
    headquarters: b.hqLabel?.value ?? null,
    country: b.countryLabel?.value ?? null,
    employees: Number.isFinite(emp) ? emp : null,
    sourceUrl: `https://www.wikidata.org/wiki/${id}`,
  };
}

async function sparql(fetcher: Fetcher, query: string, userAgent: string): Promise<Binding[]> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const data = await getJson<{ results?: { bindings?: Binding[] } }>(fetcher, "wikidata", url, userAgent);
  return data.results?.bindings ?? [];
}

const SELECT = `SELECT ?company ?companyLabel ?companyDescription
  (SAMPLE(?site) AS ?website) (SAMPLE(?industryL) AS ?industryLabel) (SAMPLE(?hqL) AS ?hqLabel)
  (SAMPLE(?countryL) AS ?countryLabel) (MAX(?emp) AS ?employees)`;

const OPTIONALS = `
  OPTIONAL { ?company wdt:P856 ?site }
  OPTIONAL { ?company wdt:P452 ?ind . ?ind rdfs:label ?industryL FILTER(LANG(?industryL) = "en") }
  OPTIONAL { ?company wdt:P159 ?hq . ?hq rdfs:label ?hqL FILTER(LANG(?hqL) = "en") }
  OPTIONAL { ?company wdt:P17 ?ctry . ?ctry rdfs:label ?countryL FILTER(LANG(?countryL) = "en") }
  OPTIONAL { ?company wdt:P1128 ?emp }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }`;

/** Companies with a given industry (and optionally country). QIDs come from searchEntities. */
export async function companiesByIndustry(
  fetcher: Fetcher,
  userAgent: string,
  industryQid: string,
  countryQid?: string | null,
  limit = 40,
): Promise<WikidataCompany[]> {
  if (!QID.test(industryQid) || (countryQid && !QID.test(countryQid))) throw new Error("Invalid Wikidata identifier");
  const query = `${SELECT} WHERE {
  ?company wdt:P452 wd:${industryQid} .
  ${countryQid ? `?company wdt:P17 wd:${countryQid} .` : ""}
  FILTER NOT EXISTS { ?company wdt:P576 ?dissolved }
  ${OPTIONALS}
} GROUP BY ?company ?companyLabel ?companyDescription
ORDER BY DESC(?employees) LIMIT ${Math.min(Math.max(limit, 1), 100)}`;
  return (await sparql(fetcher, query, userAgent)).map(toCompany).filter((c): c is WikidataCompany => !!c);
}

/** Look up facts for specific entities (e.g. after a name search). */
export async function companiesById(fetcher: Fetcher, userAgent: string, ids: string[]): Promise<WikidataCompany[]> {
  const valid = ids.filter((i) => QID.test(i)).slice(0, 20);
  if (!valid.length) return [];
  const query = `${SELECT} WHERE {
  VALUES ?company { ${valid.map((i) => `wd:${i}`).join(" ")} }
  ${OPTIONALS}
} GROUP BY ?company ?companyLabel ?companyDescription`;
  return (await sparql(fetcher, query, userAgent)).map(toCompany).filter((c): c is WikidataCompany => !!c);
}
