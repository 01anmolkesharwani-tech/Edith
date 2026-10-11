/**
 * Email checks. None of these checks proves that a specific person reads a mailbox:
 * - Syntax: the address is well-formed.
 * - Domain / MX: the domain is configured to receive mail. Says nothing about the mailbox.
 * - Public match: the exact address was observed on a public source (may be outdated).
 * - Provider: an optional third-party verification result (provider's own opinion).
 * - SMTP diagnostic: optional, off by default; a server accepting RCPT TO is not proof.
 */
import { promises as dnsPromises } from "node:dns";
import { effectiveEvidenceDate, FRESHNESS_THRESHOLDS } from "@/lib/domain/freshness";

export type Stage = "SYNTAX" | "DOMAIN" | "MX" | "PUBLIC_MATCH" | "PROVIDER" | "SMTP_DIAGNOSTIC";
export type Result = "PASS" | "FAIL" | "INCONCLUSIVE" | "CATCH_ALL" | "ERROR" | "SKIPPED";
export type EmailStatusValue =
  | "NOT_CHECKED"
  | "PUBLICLY_LISTED"
  | "SYNTAX_VALID"
  | "DOMAIN_CONFIGURED"
  | "PROVIDER_VERIFIED"
  | "UNCERTAIN"
  | "UNDELIVERABLE"
  | "CATCH_ALL_RISKY"
  | "STALE";

export const EMAIL_STATUS_INFO: Record<EmailStatusValue, { label: string; meaning: string; tone: string }> = {
  NOT_CHECKED: { label: "Not checked", meaning: "No checks have been run.", tone: "gray" },
  SYNTAX_VALID: {
    label: "Syntax valid",
    meaning: "Well-formed address. The domain and mailbox have not been confirmed.",
    tone: "gray",
  },
  DOMAIN_CONFIGURED: {
    label: "Domain configured",
    meaning: "The domain has mail (MX) records. This does NOT prove the individual mailbox exists.",
    tone: "blue",
  },
  PUBLICLY_LISTED: {
    label: "Publicly listed",
    meaning: "This exact address was observed on a public source. It may still be outdated.",
    tone: "green",
  },
  PROVIDER_VERIFIED: {
    label: "Provider verified",
    meaning: "A configured verification provider reported the address as valid at the time shown.",
    tone: "green",
  },
  UNCERTAIN: {
    label: "Uncertain",
    meaning: "Guessed or inconclusive. Review the uncertainty before sending.",
    tone: "amber",
  },
  CATCH_ALL_RISKY: {
    label: "Catch-all / risky",
    meaning: "The domain accepts any address, so individual mailboxes cannot be confirmed.",
    tone: "amber",
  },
  STALE: {
    label: "Stale",
    meaning: "The supporting evidence or verification is older than 180 days.",
    tone: "amber",
  },
  UNDELIVERABLE: {
    label: "Undeliverable",
    meaning: "Invalid syntax, a domain that cannot receive mail, or a provider/bounce rejection.",
    tone: "red",
  },
};

const ROLE_LOCALS = new Set([
  "info", "contact", "hello", "careers", "career", "jobs", "hr", "recruitment", "recruiting", "talent",
  "admin", "office", "support", "sales", "marketing", "press", "media", "enquiries", "inquiries",
  "team", "hiring", "noreply", "no-reply", "investor", "investors", "ir", "mail", "webmaster",
]);

export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return ROLE_LOCALS.has(local.replace(/[._-]?\d+$/, ""));
}

export interface SyntaxResult {
  ok: boolean;
  reason?: string;
}

const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function checkSyntax(raw: string): SyntaxResult {
  const email = raw.trim();
  if (!email) return { ok: false, reason: "Empty address" };
  if (email.length > 254) return { ok: false, reason: "Address longer than 254 characters" };
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return { ok: false, reason: "Must contain exactly one @" };
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64) return { ok: false, reason: "Local part longer than 64 characters" };
  if (!LOCAL_RE.test(local)) return { ok: false, reason: "Local part contains invalid characters or dots" };
  if (domain.length > 253 || !domain.includes(".")) return { ok: false, reason: "Domain is not fully qualified" };
  const labels = domain.split(".");
  if (!labels.every((l) => LABEL_RE.test(l))) return { ok: false, reason: "Domain contains an invalid label" };
  const tld = labels[labels.length - 1];
  if (!/^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$/.test(tld)) return { ok: false, reason: "Invalid top-level domain" };
  return { ok: true };
}

export interface DnsResolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

export const systemResolver: DnsResolver = {
  resolveMx: (d) => dnsPromises.resolveMx(d),
  resolve4: (d) => dnsPromises.resolve4(d),
  resolve6: (d) => dnsPromises.resolve6(d),
};

export interface CheckRecord {
  stage: Stage;
  result: Result;
  details: string;
  provider?: string;
}

function dnsCode(err: unknown): string {
  return (err as { code?: string })?.code ?? "UNKNOWN";
}

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/** Stages B and C: domain existence and MX configuration. */
export async function checkDomainAndMx(domain: string, resolver: DnsResolver = systemResolver): Promise<CheckRecord[]> {
  let mx: { exchange: string; priority: number }[] = [];
  let mxErr: string | null = null;
  try {
    mx = await resolver.resolveMx(domain);
  } catch (e) {
    mxErr = dnsCode(e);
  }

  if (mx.length) {
    // RFC 7505 "null MX": a single MX with exchange "." means the domain accepts no mail.
    if (mx.length === 1 && (mx[0].exchange === "" || mx[0].exchange === ".")) {
      return [
        { stage: "DOMAIN", result: "PASS", details: "Domain exists." },
        { stage: "MX", result: "FAIL", details: "Domain publishes a null MX record (RFC 7505): it does not accept email." },
      ];
    }
    const hosts = [...mx].sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
    return [
      { stage: "DOMAIN", result: "PASS", details: "Domain exists." },
      { stage: "MX", result: "PASS", details: `MX: ${hosts.slice(0, 4).join(", ")}` },
    ];
  }

  if (mxErr && !NOT_FOUND_CODES.has(mxErr)) {
    return [
      { stage: "DOMAIN", result: "ERROR", details: `DNS lookup failed (${mxErr}). Try again later.` },
      { stage: "MX", result: "ERROR", details: `DNS lookup failed (${mxErr}).` },
    ];
  }

  // No MX: fall back to address records (implicit MX, RFC 5321 §5.1).
  const addrs: string[] = [];
  for (const fn of [resolver.resolve4, resolver.resolve6]) {
    try {
      addrs.push(...(await fn(domain)));
    } catch {
      /* ignore */
    }
  }
  if (addrs.length) {
    return [
      { stage: "DOMAIN", result: "PASS", details: "Domain resolves." },
      {
        stage: "MX",
        result: "INCONCLUSIVE",
        details: "No MX record; mail may be delivered to the domain's address record (implicit MX).",
      },
    ];
  }
  return [
    { stage: "DOMAIN", result: "FAIL", details: "Domain does not resolve." },
    { stage: "MX", result: "FAIL", details: "No mail servers found." },
  ];
}

export interface VerificationLike {
  stage: string;
  result: string;
  checkedAt: Date | string;
  details?: string | null;
}

export interface PublicEmailEvidence {
  sourceType: string;
  observedAt: Date | string;
  publishedAt?: Date | string | null;
  verificationMethod: string;
}

export interface DeriveInput {
  email: string | null | undefined;
  emailOrigin?: string | null;
  verifications: VerificationLike[];
  evidence: PublicEmailEvidence[]; // EMAIL-field evidence matching this exact address
  now?: Date;
}

export interface DerivedStatus {
  status: EmailStatusValue;
  reasons: string[];
  isGuess: boolean;
  isRoleAddress: boolean;
}

const PUBLIC_SOURCE_TYPES = new Set([
  "OFFICIAL_TEAM_PAGE",
  "OFFICIAL_BIO",
  "OFFICIAL_ANNOUNCEMENT",
  "CAREERS_PAGE",
  "JOB_POSTING",
  "PUBLIC_DIRECTORY",
  "PROFESSIONAL_PROFILE",
  "NEWS_ARTICLE",
  "SEARCH_API_RESULT",
]);

const OBSERVED_METHODS = new Set(["EXACT_MATCH_ON_PAGE", "AUTOMATED_EXTRACTION"]);

function latest(vs: VerificationLike[], stage: Stage): VerificationLike | undefined {
  return vs
    .filter((v) => v.stage === stage)
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())[0];
}

const DAY = 86_400_000;

/** Combine all checks into one display status, with explicit reasons. */
export function deriveEmailStatus(input: DeriveInput): DerivedStatus {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  const email = input.email?.trim();
  const isGuess = input.emailOrigin === "PATTERN_GUESS";
  if (!email) return { status: "NOT_CHECKED", reasons: ["No email address."], isGuess, isRoleAddress: false };
  const role = isRoleAddress(email);
  if (role) reasons.push("Role/shared address (e.g. careers@) – not an individual's mailbox.");

  const done = (status: EmailStatusValue): DerivedStatus => ({ status, reasons, isGuess, isRoleAddress: role });
  const vs = input.verifications;

  const syntax = latest(vs, "SYNTAX");
  if (syntax?.result === "FAIL") {
    reasons.push(`Invalid syntax: ${syntax.details ?? ""}`.trim());
    return done("UNDELIVERABLE");
  }
  const domain = latest(vs, "DOMAIN");
  const mx = latest(vs, "MX");
  if (domain?.result === "FAIL" || mx?.result === "FAIL") {
    reasons.push(mx?.details ?? domain?.details ?? "Domain cannot receive email.");
    return done("UNDELIVERABLE");
  }

  const provider = latest(vs, "PROVIDER");
  if (provider?.result === "FAIL") {
    reasons.push(`Verification provider reported invalid: ${provider.details ?? ""}`.trim());
    return done("UNDELIVERABLE");
  }
  if (provider?.result === "CATCH_ALL") {
    reasons.push("Verification provider reported an accept-all (catch-all) domain.");
    return done("CATCH_ALL_RISKY");
  }
  const smtp = latest(vs, "SMTP_DIAGNOSTIC");
  if (smtp?.result === "CATCH_ALL") {
    reasons.push("SMTP diagnostic suggests the domain accepts any recipient (catch-all).");
    return done("CATCH_ALL_RISKY");
  }
  if (provider?.result === "PASS") {
    const age = (now.getTime() - new Date(provider.checkedAt).getTime()) / DAY;
    if (age > FRESHNESS_THRESHOLDS.AGING) {
      reasons.push("Provider verification is older than 180 days.");
      return done("STALE");
    }
    reasons.push(`Provider reported valid on ${new Date(provider.checkedAt).toISOString().slice(0, 10)}.`);
    return done("PROVIDER_VERIFIED");
  }

  // Only addresses the app itself observed verbatim on a public page count as "publicly listed".
  // A user-entered address with a source URL (e.g. an official bio that supports the title)
  // does not verify the email; the user can ask the app to re-check that page for the exact address.
  const publicEv = input.evidence.filter(
    (e) => PUBLIC_SOURCE_TYPES.has(e.sourceType) && OBSERVED_METHODS.has(e.verificationMethod),
  );
  const publicMatch = latest(vs, "PUBLIC_MATCH");
  if (publicEv.length || publicMatch?.result === "PASS") {
    const dates = publicEv.map((e) => effectiveEvidenceDate(e)).filter((d): d is Date => !!d);
    if (publicMatch?.result === "PASS") dates.push(new Date(publicMatch.checkedAt));
    const newest = dates.sort((a, b) => b.getTime() - a.getTime())[0];
    if (newest && (now.getTime() - newest.getTime()) / DAY > FRESHNESS_THRESHOLDS.AGING) {
      reasons.push("Address was publicly listed, but the listing is older than 180 days.");
      return done("STALE");
    }
    reasons.push("Exact address observed on a public source.");
    if (!newest) reasons.push("Source date unknown.");
    return done("PUBLICLY_LISTED");
  }

  if (isGuess) {
    reasons.push("Address was inferred from a naming pattern; it has not been observed or verified.");
    return done("UNCERTAIN");
  }
  if (smtp?.result === "FAIL") {
    reasons.push("Mail server rejected this recipient during a diagnostic check (not definitive).");
    return done("UNCERTAIN");
  }
  if (provider?.result === "INCONCLUSIVE") reasons.push("Verification provider was inconclusive.");
  if (mx?.result === "PASS") {
    reasons.push("Domain has MX records; the individual mailbox is unconfirmed.");
    return done("DOMAIN_CONFIGURED");
  }
  if (mx?.result === "INCONCLUSIVE") {
    reasons.push(mx.details ?? "No MX record found.");
    return done("UNCERTAIN");
  }
  if (syntax?.result === "PASS") {
    reasons.push("Syntax valid; domain not checked yet.");
    return done("SYNTAX_VALID");
  }
  return done("NOT_CHECKED");
}

/** Generate pattern-based guesses. The UI must label these UNCERTAIN / guessed. */
export function guessEmailCandidates(firstName: string, lastName: string, domain: string): string[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  if (!f || !domain) return [];
  const locals = l ? [`${f}.${l}`, `${f}${l}`, `${f[0]}${l}`, `${f}`, `${f}_${l}`, `${f[0]}.${l}`] : [f];
  return [...new Set(locals)].map((x) => `${x}@${domain}`);
}

/**
 * Infer the dominant local-part pattern from addresses publicly observed at a domain
 * (e.g. "first.last"). Returns null if there is not enough evidence.
 */
export function inferPattern(
  observed: { email: string; firstName: string; lastName: string }[],
): { pattern: string; support: number } | null {
  const counts = new Map<string, number>();
  for (const o of observed) {
    const local = o.email.split("@")[0]?.toLowerCase();
    const f = o.firstName.toLowerCase().replace(/[^a-z]/g, "");
    const l = o.lastName.toLowerCase().replace(/[^a-z]/g, "");
    if (!local || !f) continue;
    const candidates: [string, string][] = [
      ["first.last", `${f}.${l}`],
      ["firstlast", `${f}${l}`],
      ["flast", `${f[0]}${l}`],
      ["first", f],
      ["first_last", `${f}_${l}`],
      ["f.last", `${f[0]}.${l}`],
    ];
    for (const [name, value] of candidates) {
      if (value && local === value) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        break;
      }
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { pattern: best[0], support: best[1] } : null;
}

export function applyPattern(pattern: string, firstName: string, lastName: string, domain: string): string | null {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  if (!f) return null;
  const map: Record<string, string> = {
    "first.last": `${f}.${l}`,
    firstlast: `${f}${l}`,
    flast: `${f[0]}${l}`,
    first: f,
    first_last: `${f}_${l}`,
    "f.last": `${f[0]}.${l}`,
  };
  const local = map[pattern];
  if (!local || (pattern !== "first" && !l)) return null;
  return `${local}@${domain}`;
}
