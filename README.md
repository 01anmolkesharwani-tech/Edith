# CareerReach

A free, local, two-portal recruitment research and outreach tool. It helps two candidates
(by default a **Marketing** portal and a **Finance** portal) to:

- find relevant companies and openings,
- find relevant people from legitimate public sources, with **field-level evidence**,
- check emails in clearly labelled stages (never claiming more than the evidence shows),
- draft personalised emails **only from verified facts**,
- attach the right candidate's résumé, review the exact email, and send **one email with one click**,
- track sends, replies, bounces and follow-ups in a CRM.

No paid AI, contact database, verification service or hosting is required. Everything runs on
one computer with SQLite.

> **What is automated and what is manual.** Automated: official-website research (a few relevant
> pages, robots.txt respected), public job-board lookups (Greenhouse, Lever, Ashby), Wikidata company
> discovery, DNS/MX email checks, scoring, freshness, conflict detection, draft generation, follow-up
> scheduling, and (optionally) read-only inbox reply matching. Manual: anything behind a login or on
> sites whose terms prohibit automated collection (LinkedIn, Glassdoor, search engines…). For those,
> the app gives you search queries and links to open in your own browser and a form to record what
> you verify, with its source.

---

## 1. Requirements

- Node.js **20.9+** (22 LTS recommended) and npm
- About 500 MB of disk for dependencies
- Optional: a Gmail / Google Workspace or Zoho account with an **app password** to send email

## 2. Install and initialise

```bash
git clone <this repo> careerreach && cd careerreach
cp .env.example .env          # adjust if needed; never commit .env
npm install                   # also generates the Prisma client
npm run setup                 # = prisma migrate deploy + prisma generate + seed (two empty portals)
```

`npm run setup` creates `data/careerreach.db`. The two portals are created **without any candidate
personal data** – names, education and experience come from each candidate's own résumé.

Optional, clearly labelled demo data in a *separate* "demo" portal (never mixed with real data):

```bash
npm run db:seed:demo
```

## 3. Start

```bash
npm run build && npm start     # production mode on http://127.0.0.1:3000
# or, while developing:
npm run dev                    # http://127.0.0.1:3000
```

Both commands bind to **127.0.0.1**, so the app is reachable only from this computer. See
[Security](#11-security-and-privacy) before exposing it to a network.

## 4. First-time set-up (per portal)

Use the **Candidate portal** switcher at the top. Each portal has its own résumés, contacts,
templates, sender account, outreach history, follow-ups, dashboard and preferences.

1. **Settings → Candidate profile**: enter the candidate's name and current status *exactly as on
   the résumé*, target roles/industries/functions/contact titles and preferred locations. These drive
   relevance scoring.
2. **Résumés**: upload a PDF (≤ 5 MB). Label versions (General, Marketing, Finance, Valuation…).
   The first upload becomes the default attachment; change it any time. Files are stored in
   `data/resumes/<portal-id>/` – outside the web root – and are served only to the owning portal.
3. **Résumés → Verified candidate facts**: add highlights (internships, projects, certifications,
   achievements). Click *Suggest highlights* to pull candidate lines out of the résumé text; every
   suggestion starts **unconfirmed**. Only **confirmed** highlights are ever used in emails.
4. **Settings → Sender account** (optional; see §8). Without one the app works in **draft-only
   mode**: you can prepare, review and copy every email.

## 5. Discovering companies

**Discover Companies**
- *Search Wikidata* by industry (+ country) or by company name. Results show their Wikidata source.
  Nothing is saved until you click **Add as target**.
- *Add a company manually* (name, website, industry, careers page, target/watching/excluded).
- *Browser searches*: suggested queries with Google/Bing/DuckDuckGo links you open yourself.

**Company Research → a company**
- **Research website now**: fetches the homepage plus up to 8 relevant pages (team/leadership,
  careers, about, contact, news), obeying robots.txt and a per-site delay. It records each page as
  evidence, extracts the description, careers/leadership links, a public job board (if linked),
  people with titles, and company-level inboxes/switchboards (never attributed to a person).
- **Job openings**: refreshed from Greenhouse/Lever/Ashby when the company's board is known
  (auto-detected from the careers page, or set it under *Edit facts*). You can add openings you
  found. **A company without an observed opening is labelled a speculative networking target.**
- **Company research**: short factual statements with a source URL and publication date. Only
  **confirmed** items are used in emails. *Possible research statements* lists sentences from
  retrieved official pages that mention launches, expansion, acquisitions, etc. – read the source
  before confirming one.
- Mark a company **Excluded** to keep it out of outreach for that portal.

## 6. Discovering contacts

**Discover Contacts** (pick a company):
1. **Official website (automated)** – as above.
2. **A specific public page** – paste a press release, official bio or public directory page.
   The app checks robots.txt and refuses private addresses and prohibited sites.
3. **Web search API (optional)** – only if `BRAVE_SEARCH_API_KEY` is set. Results are leads; you
   choose which page to retrieve.
4. **Manual research** – editable queries, browser search links and LinkedIn people-search links
   that open in *your* browser session (the app never fetches LinkedIn).
5. **Add a contact manually**, recording where the information came from.

Contacts found automatically are labelled **Automated** and **Unreviewed**; manual ones **Manual**;
CSV imports **Imported**. Missing data stays missing – the app never fills gaps with invented values.

### Contact page

- **Field-level evidence**: every name, title, company, email and phone observation with its
  source URL, source type, method, confidence, observed date, publication date and the exact
  snippet. Title and email are assessed **independently**.
- **Email verification** (see §7), **pattern-based guesses** (always labelled *Guessed/Uncertain*).
- **Relevance score** (0–100) with the reasons for each component (§9).
- **Freshness** for role, email, phone and validation separately.
- **Review warnings**: conflicting titles/companies/emails across sources, stale evidence, etc.
- **Merge** possible duplicates (evidence and history are preserved).
- Outreach history, manual reply/bounce logging, and the full activity timeline.

## 7. Email checks – what each status means

| Status | Meaning |
|---|---|
| **Not checked** | No checks run yet. |
| **Syntax valid** | The address is well-formed. Nothing else is known. |
| **Domain configured** | The domain publishes MX records. **This does not prove the mailbox exists.** |
| **Publicly listed** | The app itself observed this *exact* address on a public page (date shown). It may be outdated. A user-entered address does not get this status just because you supplied a source URL – use *Check page for this exact address*. |
| **Provider verified** | An optional verification provider (Hunter) reported the address valid at the time shown. |
| **Uncertain** | Pattern guess, inconclusive provider result, or no MX record. |
| **Catch-all / risky** | The domain accepts any address, so mailboxes cannot be confirmed. |
| **Stale** | The listing or verification is older than 180 days. |
| **Undeliverable** | Invalid syntax, a domain that cannot receive mail (incl. null MX), a provider "invalid" result, or a recorded bounce. |

Stages: A syntax → B domain → C MX → D exact public-source match → E optional provider →
F optional SMTP diagnostic (off by default; stops before `DATA`, so nothing is sent; a server
accepting a recipient is never treated as verification). **No test emails are ever sent.**

Phone numbers are only stored when supplied by a source or by you, typed as direct line / office
line / switchboard / public professional mobile / unknown. Company numbers are stored at company
level and never attributed to an individual. No number is ever generated.

## 8. Sender account configuration

Passwords are **never** stored in the database or sent to the browser. You store the *name* of a
server environment variable; put the secret in `.env` and restart the app.

**Gmail / Google Workspace**
1. Turn on 2-Step Verification for the Google account.
2. Create an app password (Google Account → Security → App passwords).
3. Add it to `.env`, e.g. `CAREERREACH_SMTP_PASS_MARKETING="abcd efgh ijkl mnop"`.
4. Settings → Sender account: SMTP `smtp.gmail.com`, port `465`, *Implicit TLS* on, username = your
   Gmail address, env variable = `CAREERREACH_SMTP_PASS_MARKETING`. Click **Test connection
   (sends nothing)**.
5. Optional: enable **read-only reply tracking** (IMAP `imap.gmail.com:993`, same app password).
   The inbox is opened read-only and only message headers are used to match replies.

Documented limits (check your own account): consumer Gmail ≈ **500 recipients per rolling 24 h**,
Workspace ≈ 2,000/day; attachments up to **25 MB**. CareerReach's own default limit is far lower
(15/day per portal, configurable).

**Zoho Mail**: `smtp.zoho.com:465` with an application-specific password.
**Outlook.com / Microsoft 365 personal**: Microsoft has disabled basic-auth/app-password SMTP for
Outlook.com; it requires OAuth, which this version does not implement. Use draft-only mode
(*Copy text*) or another provider.

**Disconnect**: Settings → Sender account → *Disconnect*, remove the variable from `.env`, and
revoke the app password in your provider's security settings.

Each portal can send only from its own account; one address cannot be configured for both portals.

## 9. Relevance score

| Component | Max | Based on |
|---|---|---|
| Role relevance | 30 | title vs. the portal's target contact titles and functions; recruiter roles |
| Hiring authority / networking value | 20 | leader in the target function, recruiter, senior, or junior peer (networking) |
| Company & industry fit | 20 | industry vs. targets; relevant openings; excluded companies score 0 |
| Candidate & location fit | 15 | preferred locations; alignment with target roles |
| Evidence quality & freshness | 15 | official/user-confirmed role evidence; email status; evidence age |

Unknown values receive neutral partial credit – missing data is not treated as irrelevance.
Every point is explained on the contact page. Scores are recalculated whenever evidence or the
profile changes (or via *Recalculate scores*).

## 10. Reviewing and sending an email – exact steps

1. **Contacts** (or a contact page) → **Prepare email**. Optionally choose a related opening.
   A draft is created – **nothing is sent**.
2. On the review page, check the recipient panel (role, email status, evidence), *Personalisation
   used* and *Missing information*. Edit the subject (pick from the alternatives) and message,
   change the attachment (only this portal's résumés are offered) or regenerate the draft with
   another template. **Save draft** at any time.
3. Click **Review & send…**. The **final preview** shows From, To, Subject, the exact attachment
   filename/size and the full body, plus any warnings.
4. If needed, tick the explicit confirmations (guessed/uncertain address; repeat contact;
   content changed after a previous review).
5. Click **Send email** once. The click records your review of exactly this content and sends it.
6. The result says *Sent – accepted by the mail server* only when the SMTP server accepted the
   message (acceptance is not proof of inbox delivery). Failures are shown; ambiguous outcomes are
   marked **unknown**, never retried automatically, and you resolve them after checking your
   Sent folder.

Before sending, the server re-checks: sender configured and its secret present; valid recipient;
non-empty subject/body and no leftover placeholders; candidate name set; résumé present, owned by
this portal and unchanged on disk (SHA-256); not on the Do Not Contact list; not undeliverable;
guessed/uncertain addresses acknowledged; repeat contact acknowledged; reviewed content matches;
daily limit; cooldown after a failed send. Double clicks, retries and concurrent requests cannot send
twice: the draft is claimed atomically and each attempt has a unique idempotency key.

There is **no bulk send**. Each email has one recipient and its own explicit approval.

## 11. Follow-ups, replies and the pipeline

- After a send, one follow-up (configurable 0–3) is scheduled after N days (default 7). It is
  **never sent automatically**: *Draft follow-up* creates a threaded draft (`Re:` subject,
  `In-Reply-To` header) that you review and send like any other email.
- Follow-ups are suppressed automatically when the recipient replied, declined, bounced, is on the
  Do Not Contact list, the opening closed, or you skipped it.
- Replies: record them manually, or click **Check inbox for replies (read-only)** on the pipeline
  page if IMAP is enabled. Sources are always labelled: *provider* (send accepted), *inbox*
  (observed), *manual* (recorded by you). **Opens are not tracked** (no tracking pixels).
- **Outreach Pipeline**: all 14 stages (New → … → Do Not Contact). Moving a contact to *Do Not
  Contact* adds a suppression record.

## 12. Import and export

- **CSV import**: column mapping (auto-guessed), preview, validation per row, duplicate detection
  (within the file and against existing contacts), and a merge mode: *skip*, *merge safely* (fill
  empty fields only, add evidence, keep history) or *create anyway*. Rows tagged with another
  portal's id are skipped. Imported contacts are labelled *Imported* and **never marked verified**.
- **CSV export**: choose fields; cells beginning with `= + - @` are prefixed with `'` to prevent
  spreadsheet formula injection.
- **JSON export** of all of a portal's data (Settings → Data management).

## 13. Security and privacy

- **Single-computer by default**: the server listens on 127.0.0.1 only.
- **If you expose it to a network** (e.g. `next start -H 0.0.0.0`): set `CAREERREACH_ACCESS_PASSWORD`
  in `.env` (the `proxy.ts` gate then protects every page, API route and server action), and put it
  behind HTTPS (e.g. a reverse proxy). Do not deploy it publicly without both.
- **Portal isolation**: the active portal is resolved on the server from an http-only cookie; every
  query and mutation is scoped to it. Résumés, contacts, drafts and sends of one portal cannot be
  read or used by the other (covered by tests). Shared company facts can only be edited by a portal
  that tracks the company.
- **SSRF protection** for every outbound page fetch: http(s) on ports 80/443 only, no credentials in
  URLs, deny-list of internal hostnames, DNS answers checked **at connection time** (blocks private,
  loopback, link-local, CGNAT, multicast and cloud-metadata addresses, including after DNS rebinding
  and on every redirect hop), timeouts and size limits.
- **robots.txt** is obeyed; if it cannot be read (5xx/network error) the site is not crawled.
- **Secrets** only in environment variables; never logged, exported or sent to the browser.
- Résumé uploads are validated by content (`%PDF` signature) and size, stored under random names
  with `0600` permissions; served with `Content-Security-Policy: sandbox`.
- Security headers: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`. External links use `noopener noreferrer`.
- Server actions validate all input with Zod; Next.js server actions also verify the request origin.
- **Data retention**: Settings lets you set retention for search history and unreferenced retrieved
  pages and apply it; you can export or delete all of a portal's data.
- **Backups**: `npm run db:backup` (or Settings → *Create database backup*) writes a consistent copy
  to `data/backups/`. Restore with the app stopped: `npm run db:restore -- data/backups/<file>.db`
  (the current database is kept alongside). Also copy `data/resumes/` for a complete backup.
- You remain responsible for complying with privacy law (e.g. GDPR / India's DPDP Act), each data
  source's terms and your email provider's policies. Contact people individually and relevantly,
  honour opt-outs immediately (Do Not Contact), and keep volumes low.

## 14. Optional integrations and their real costs

See **Settings → Integrations** in the app and [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
Summary (terms reviewed 2026-10-11 – providers change plans; check before relying on them):

| Integration | Needed for | Account / key / card | Free usage |
|---|---|---|---|
| Official websites | company & contact research | none | self-limited (robots.txt, delays) |
| Greenhouse / Lever / Ashby public job APIs | openings | none | no published read quota |
| Wikidata | company discovery | none (send a descriptive User-Agent) | query-time limits per client |
| Brave Search API | optional web search | account + API key + **payment method** | limited monthly credit; overage billed |
| Hunter.io Email Verifier | optional verification | account + API key | free plan ≈ 50 credits/month |
| SMTP (Gmail/Zoho…) | sending | your own mailbox + app password | provider limits (§8) |
| IMAP | optional reply tracking | same mailbox | — |

Missing optional keys never break core features; the UI states why a source is unavailable.
Software cost is zero; email-provider limits and data-source restrictions still apply.

## 15. Development and tests

```bash
npm test            # Vitest: 200+ unit/integration tests, isolated SQLite DB per test file,
                    # mocked network and mail transports (no real email, no real HTTP)
npm run test:e2e    # Browser end-to-end test (needs `npm run build`): temporary database,
                    # local SMTP sink on 127.0.0.1, Chromium via Playwright
npm run lint && npm run typecheck
```

Project layout:

```
prisma/               schema.prisma, migrations, seed.ts
scripts/              backup.ts, restore.ts, e2e-smoke.ts
src/proxy.ts          optional password gate
src/app/              pages (App Router), server actions (app/actions), API routes (app/api)
src/components/       UI primitives, badges, client components (composer, CSV wizard…)
src/lib/domain/       classification, scoring, freshness, conflicts, dedupe, stages (pure)
src/lib/email/        staged email checks, SMTP diagnostic
src/lib/net/          SSRF-safe fetch, IP classification, robots.txt
src/lib/extract/      HTML page / people / link / ATS extraction
src/lib/providers/    website, job boards, Wikidata, Brave, Hunter, search links, catalogue
src/lib/drafting/     template renderer, built-in templates, generator
src/lib/sending/      transports, sender accounts, idempotent send service
src/lib/services/     profile-scoped business logic used by actions and tests
tests/                Vitest suites and helpers
```

## 16. Known limitations

- People extraction from web pages is heuristic; unusual page layouts may yield nothing or need
  review. Sites rendered entirely by JavaScript expose little to a non-browser fetch.
- No automated web search without an optional paid-tier API; search engines and LinkedIn are
  manual by design.
- Job openings are only discovered for companies using Greenhouse, Lever or Ashby public boards,
  or added manually.
- Wikidata coverage of smaller and private companies (and of industries) is uneven.
- Outlook.com / Microsoft 365 sending (OAuth) and Gmail OAuth are not implemented; Gmail and Zoho
  work with app passwords.
- Reply tracking needs IMAP with an app password; bounces are recognised from `mailer-daemon` /
  `postmaster` notices that quote the original Message-ID.
- The live third-party APIs were exercised against recorded response formats in tests; the build
  environment could not reach them, so the first real run on your machine is their first live use.
- Single-user-per-portal local app; there are no per-user accounts beyond the optional shared password.
