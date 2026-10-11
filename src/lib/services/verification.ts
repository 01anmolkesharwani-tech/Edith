import { db } from "@/lib/db";
import { smtpDiagnostic, type SmtpConnector } from "@/lib/email/smtp-diagnostic";
import {
  applyPattern,
  checkDomainAndMx,
  checkSyntax,
  guessEmailCandidates,
  inferPattern,
  systemResolver,
  type CheckRecord,
  type DnsResolver,
} from "@/lib/email/validation";
import { extractPage } from "@/lib/extract/html";
import { emailDomain, normalizeDomain, splitName } from "@/lib/normalize";
import { RobotsCache } from "@/lib/net/robots";
import { safeFetch, validatePublicUrl, type Fetcher } from "@/lib/net/safe-fetch";
import { hunterConfigured, hunterVerify } from "@/lib/providers/hunter";
import { isNeverFetchHost } from "@/lib/providers/search-links";
import { ProviderError } from "@/lib/providers/types";
import { logActivity } from "./activity";
import { recomputeContact } from "./contacts";
import { NotFoundError, UserError } from "./errors";
import { getSettings, userAgentFor } from "./settings";

export interface VerificationDeps {
  resolver?: DnsResolver;
  hunter?: typeof hunterVerify;
  smtpConnector?: SmtpConnector;
  fetcher?: Fetcher;
}

const PUBLIC_TYPES = ["OFFICIAL_TEAM_PAGE", "OFFICIAL_BIO", "OFFICIAL_ANNOUNCEMENT", "CAREERS_PAGE", "JOB_POSTING", "PUBLIC_DIRECTORY", "PROFESSIONAL_PROFILE", "NEWS_ARTICLE", "SEARCH_API_RESULT"] as const;

/**
 * Run email checks for a contact. Stages A–D always run; E (provider) only when requested
 * and configured; F (SMTP diagnostic) only when enabled in Settings AND requested.
 */
export async function runEmailChecks(
  profileId: string,
  contactId: string,
  opts: { provider?: boolean; smtp?: boolean } = {},
  deps: VerificationDeps = {},
) {
  const c = await db.contact.findFirst({ where: { id: contactId, profileId }, include: { evidence: true } });
  if (!c) throw new NotFoundError("Contact");
  if (!c.email) throw new UserError("This contact has no email address to check.");
  const email = c.email.trim().toLowerCase();
  const records: CheckRecord[] = [];

  const syntax = checkSyntax(email);
  records.push({ stage: "SYNTAX", result: syntax.ok ? "PASS" : "FAIL", details: syntax.ok ? "Well-formed address" : (syntax.reason ?? "Invalid") });

  let mxHost: string | null = null;
  if (syntax.ok) {
    const dns = await checkDomainAndMx(emailDomain(email)!, deps.resolver ?? systemResolver);
    records.push(...dns);
    const mx = dns.find((r) => r.stage === "MX" && r.result === "PASS");
    mxHost = mx?.details.replace(/^MX:\s*/, "").split(",")[0]?.trim() || null;

    // D. Exact-address public-source match: evidence or stored source documents containing the exact string.
    const evidenceHit = c.evidence.find(
      (e) =>
        e.field === "EMAIL" &&
        e.value.toLowerCase() === email &&
        (PUBLIC_TYPES as readonly string[]).includes(e.sourceType) &&
        (e.verificationMethod === "EXACT_MATCH_ON_PAGE" || e.verificationMethod === "AUTOMATED_EXTRACTION") &&
        e.sourceUrl,
    );
    const docHit = evidenceHit
      ? null
      : await db.sourceDocument.findFirst({ where: { textExcerpt: { contains: email } }, orderBy: { retrievedAt: "desc" } });
    if (evidenceHit) {
      records.push({ stage: "PUBLIC_MATCH", result: "PASS", details: `Exact address observed at ${evidenceHit.sourceUrl} on ${evidenceHit.observedAt.toISOString().slice(0, 10)}` });
    } else if (docHit) {
      records.push({ stage: "PUBLIC_MATCH", result: "PASS", details: `Exact address found in stored page ${docHit.finalUrl} (retrieved ${docHit.retrievedAt.toISOString().slice(0, 10)})` });
      await db.contactFieldEvidence.create({
        data: {
          contactId,
          field: "EMAIL",
          value: email,
          sourceUrl: docHit.finalUrl,
          sourceType: docHit.companyId && c.companyId === docHit.companyId ? "OFFICIAL_TEAM_PAGE" : "PUBLIC_DIRECTORY",
          sourceDocumentId: docHit.id,
          observedAt: docHit.retrievedAt,
          publishedAt: docHit.publishedAt,
          verificationMethod: "EXACT_MATCH_ON_PAGE",
          confidence: "MEDIUM",
          origin: "AUTOMATED",
          notes: "Exact address found in a previously retrieved page",
        },
      });
    } else {
      records.push({ stage: "PUBLIC_MATCH", result: "INCONCLUSIVE", details: "Exact address not found in recorded public sources." });
    }

    if (opts.provider) {
      if (!hunterConfigured() && !deps.hunter) {
        records.push({ stage: "PROVIDER", result: "SKIPPED", details: "No verification provider configured (optional).", provider: "hunter" });
      } else {
        try {
          const r = await (deps.hunter ?? hunterVerify)(email);
          records.push({ stage: "PROVIDER", result: r.result, details: r.details, provider: "hunter" });
        } catch (e) {
          const msg = e instanceof ProviderError ? `${e.kind}: ${e.message}` : (e as Error).message;
          records.push({ stage: "PROVIDER", result: "ERROR", details: msg, provider: "hunter" });
        }
      }
    }

    if (opts.smtp) {
      const settings = await getSettings();
      if (!settings.smtpDiagnosticsEnabled) {
        records.push({ stage: "SMTP_DIAGNOSTIC", result: "SKIPPED", details: "SMTP diagnostics are disabled in Settings." });
      } else if (!mxHost) {
        records.push({ stage: "SMTP_DIAGNOSTIC", result: "SKIPPED", details: "No MX host to test." });
      } else {
        records.push(await smtpDiagnostic(email, mxHost, { connector: deps.smtpConnector }));
      }
    }
  }

  await db.emailVerification.createMany({
    data: records.map((r) => ({ contactId, email, stage: r.stage, result: r.result, details: r.details, provider: r.provider ?? null })),
  });
  await logActivity(db, {
    profileId,
    contactId,
    type: "VERIFY",
    summary: `Email checks: ${records.map((r) => `${r.stage.toLowerCase()}=${r.result.toLowerCase()}`).join(", ")}`,
  });
  await recomputeContact(contactId);
  return records;
}

/** Re-fetch a public page and check whether the exact address appears on it. */
export async function recheckEmailOnPage(profileId: string, contactId: string, url: string, deps: VerificationDeps = {}) {
  const c = await db.contact.findFirst({ where: { id: contactId, profileId }, include: { company: true } });
  if (!c) throw new NotFoundError("Contact");
  if (!c.email) throw new UserError("No email to look for.");
  let u: URL;
  try {
    u = validatePublicUrl(url);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  if (isNeverFetchHost(u.hostname)) throw new UserError("This site's terms prohibit automated collection.");
  const settings = await getSettings();
  const fetcher = deps.fetcher ?? safeFetch;
  const ua = userAgentFor(settings);
  if (!(await new RobotsCache(fetcher, ua).allowed(u.toString()))) throw new UserError("robots.txt disallows this page.");
  const res = await fetcher(u.toString(), { userAgent: ua, timeoutMs: settings.fetchTimeoutMs, maxBytes: settings.maxResponseBytes });
  if (res.status < 200 || res.status >= 300) throw new UserError(`Page returned HTTP ${res.status}.`);
  const page = extractPage(res.body, res.finalUrl);
  const email = c.email.toLowerCase();
  const hit = page.emails.find((e) => e.email === email);
  const doc = await db.sourceDocument.create({
    data: {
      url,
      finalUrl: res.finalUrl,
      domain: normalizeDomain(res.finalUrl) ?? "",
      title: page.title,
      httpStatus: res.status,
      contentHash: (await import("node:crypto")).createHash("sha256").update(res.body).digest("hex"),
      textExcerpt: page.text.slice(0, 20_000),
      publishedAt: page.publishedAt,
      retrievedAt: res.retrievedAt,
      companyId: c.companyId,
    },
  });
  const official = !!c.company?.domain && (normalizeDomain(res.finalUrl) ?? "").endsWith(c.company.domain);
  if (hit) {
    await db.contactFieldEvidence.create({
      data: {
        contactId,
        field: "EMAIL",
        value: email,
        sourceUrl: res.finalUrl,
        sourceType: official ? "OFFICIAL_TEAM_PAGE" : "PUBLIC_DIRECTORY",
        sourceDocumentId: doc.id,
        observedAt: res.retrievedAt,
        publishedAt: page.publishedAt,
        verificationMethod: "EXACT_MATCH_ON_PAGE",
        confidence: "MEDIUM",
        origin: "AUTOMATED",
        snippet: hit.snippet.slice(0, 500),
      },
    });
  }
  await db.emailVerification.create({
    data: {
      contactId,
      email,
      stage: "PUBLIC_MATCH",
      result: hit ? "PASS" : "INCONCLUSIVE",
      details: hit ? `Exact address found at ${res.finalUrl}` : `Exact address not present at ${res.finalUrl}`,
    },
  });
  await recomputeContact(contactId);
  return { found: !!hit, url: res.finalUrl };
}

/**
 * Pattern-based suggestions. These are guesses: if the user applies one, the email is stored
 * with origin PATTERN_GUESS and status UNCERTAIN, and sending requires explicit acknowledgement.
 */
export async function emailGuesses(profileId: string, contactId: string) {
  const c = await db.contact.findFirst({ where: { id: contactId, profileId }, include: { company: true } });
  if (!c) throw new NotFoundError("Contact");
  const domain = c.company?.domain;
  if (!domain) return { domain: null, inferred: null, candidates: [] as string[], basis: "No company domain on record." };
  const { firstName, lastName } = splitName(c.fullName);
  const observed = await db.contactFieldEvidence.findMany({
    where: {
      field: "EMAIL",
      value: { endsWith: `@${domain}` },
      sourceType: { in: [...PUBLIC_TYPES] },
      verificationMethod: { in: ["EXACT_MATCH_ON_PAGE", "AUTOMATED_EXTRACTION"] },
    },
    include: { contact: { select: { fullName: true } } },
    take: 200,
  });
  const pattern = inferPattern(
    observed.map((o) => ({ email: o.value, ...splitName(o.contact.fullName) })),
  );
  const inferred = pattern ? applyPattern(pattern.pattern, firstName, lastName, domain) : null;
  return {
    domain,
    inferred,
    candidates: guessEmailCandidates(firstName, lastName, domain),
    basis: pattern
      ? `Pattern "${pattern.pattern}" seen in ${pattern.support} publicly listed address(es) at ${domain}.`
      : `No publicly listed addresses at ${domain} to infer a pattern from; these are generic guesses.`,
  };
}

export async function applyEmailGuess(profileId: string, contactId: string, email: string) {
  const c = await db.contact.findFirst({ where: { id: contactId, profileId } });
  if (!c) throw new NotFoundError("Contact");
  const s = checkSyntax(email);
  if (!s.ok) throw new UserError(`Invalid address: ${s.reason}`);
  await db.contact.update({
    where: { id: contactId },
    data: { email: email.toLowerCase(), emailNormalized: email.toLowerCase(), emailOrigin: "PATTERN_GUESS" },
  });
  await logActivity(db, { profileId, contactId, type: "NOTE", summary: `Guessed email applied (unverified): ${email.toLowerCase()}` });
  await recomputeContact(contactId);
}
