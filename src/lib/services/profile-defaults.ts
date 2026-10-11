/**
 * Default portals. Candidate names, education and experience are intentionally left
 * empty: they must come from each candidate's own résumé, never invented.
 */
export const DEFAULT_PROFILES = [
  {
    slug: "marketing",
    portalName: "Marketing",
    accentColor: "indigo",
    careerObjective:
      "Identify suitable marketing and commercial roles and start credible professional conversations.",
    targetRoles: ["marketing", "brand management", "product marketing", "consumer insights", "category management", "business development", "commercial strategy", "consulting"],
    targetIndustries: ["FMCG", "consumer goods", "consumer products", "food", "beverages", "retail", "consumer technology", "startup", "consulting"],
    targetFunctions: ["marketing", "brand", "product marketing", "consumer insights", "category", "business development", "commercial", "growth", "strategy"],
    targetContactTitles: ["talent acquisition", "marketing recruiter", "head of marketing", "marketing director", "brand manager", "category manager", "category head", "chief marketing officer", "business unit head"],
  },
  {
    slug: "finance",
    portalName: "Finance",
    accentColor: "emerald",
    careerObjective:
      "Identify suitable investment banking, corporate finance and valuation roles and start credible professional conversations.",
    targetRoles: ["investment banking", "corporate finance", "valuation", "financial modelling", "transaction advisory", "mergers and acquisitions", "M&A", "equity research"],
    targetIndustries: ["investment banking", "financial services", "banking", "capital markets", "professional services", "advisory", "private equity", "asset management"],
    targetFunctions: ["investment banking", "corporate finance", "valuation", "transaction advisory", "M&A", "mergers", "deal", "equity research", "finance", "financial advisory"],
    targetContactTitles: ["finance recruiter", "talent acquisition", "investment banking analyst", "investment banking associate", "managing director", "head of corporate finance", "corporate finance manager", "valuation director", "valuation partner", "transaction advisory"],
  },
] as const;
