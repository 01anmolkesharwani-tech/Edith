/**
 * Provider interface. Every adapter reports availability, its documented free-tier terms,
 * and errors — so the UI can explain exactly why automated discovery did or did not run.
 */
export type ProviderKind = "company" | "contact" | "jobs" | "verification" | "search" | "manual";

export interface ProviderInfo {
  id: string;
  name: string;
  kinds: ProviderKind[];
  /** Is it usable right now (configured / enabled)? */
  available: boolean;
  unavailableReason?: string;
  requiresAccount: boolean;
  requiresPaymentMethod: boolean | "unknown";
  requiresApiKey: boolean;
  automatedAccess: string; // what automated access is permitted, per its documentation
  quota: string; // documented quota / rate limit (as of the docs date)
  storage: string; // whether results may be stored
  attribution?: string;
  docsUrl: string;
  docsCheckedOn: string; // ISO date the terms were last reviewed for this build
}

export type ProviderErrorKind = "UNAVAILABLE" | "RATE_LIMITED" | "BLOCKED" | "NOT_FOUND" | "NETWORK" | "INVALID";

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface JobPosting {
  source: "GREENHOUSE" | "LEVER" | "ASHBY";
  externalId: string;
  title: string;
  department: string | null;
  location: string | null;
  url: string | null;
  postedAt: Date | null;
  descriptionExcerpt: string | null;
}
