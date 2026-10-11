/**
 * Extraction of professional information from public HTML pages.
 * Every extracted item carries the exact snippet it came from so it can be stored as evidence.
 * Extraction is heuristic: automated results are always stored as "needs review".
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { looksLikeJobTitle } from "@/lib/domain/classify";

export interface PageLink {
  href: string;
  text: string;
}

export interface ExtractedPage {
  title: string | null;
  description: string | null;
  publishedAt: Date | null;
  text: string;
  links: PageLink[];
  emails: { email: string; snippet: string }[];
  phones: { phone: string; snippet: string }[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1995 ? null : d;
}

function jsonLdObjects($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data: unknown = JSON.parse($(el).text());
      const stack: unknown[] = [data];
      while (stack.length) {
        const item = stack.pop();
        if (Array.isArray(item)) stack.push(...item);
        else if (item && typeof item === "object") {
          out.push(item as Record<string, unknown>);
          const graph = (item as Record<string, unknown>)["@graph"];
          if (graph) stack.push(graph);
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return out;
}

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const ld = jsonLdObjects($);
  const title = clean($("title").first().text()) || null;
  const description =
    clean($('meta[name="description"]').attr("content") ?? "") ||
    clean($('meta[property="og:description"]').attr("content") ?? "") ||
    null;
  const publishedAt =
    parseDate($('meta[property="article:published_time"]').attr("content")) ??
    parseDate(ld.map((o) => o.datePublished as string).find(Boolean)) ??
    parseDate($("time[datetime]").first().attr("datetime")) ??
    null;

  const links: PageLink[] = [];
  const emails = new Map<string, string>();
  const phones = new Map<string, string>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const text = clean($(a).text());
    if (href.toLowerCase().startsWith("mailto:")) {
      const email = decodeURIComponent(href.slice(7).split("?")[0]).trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) emails.set(email, clean($(a).parent().text()).slice(0, 300));
      return;
    }
    if (href.toLowerCase().startsWith("tel:")) {
      const phone = href.slice(4).trim();
      if (phone.replace(/\D/g, "").length >= 7) phones.set(phone, clean($(a).parent().text()).slice(0, 300));
      return;
    }
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") {
        abs.hash = "";
        links.push({ href: abs.toString(), text });
      }
    } catch {
      /* ignore */
    }
  });

  $("script, style, noscript, svg, template").remove();
  const text = clean($("body").text() || $.root().text());
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/\.$/, "");
    if (!emails.has(email) && !/\.(png|jpe?g|gif|svg|webp)$/i.test(email)) {
      emails.set(email, text.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120));
    }
  }
  return {
    title,
    description,
    publishedAt,
    text,
    links,
    emails: [...emails].map(([email, snippet]) => ({ email, snippet })),
    phones: [...phones].map(([phone, snippet]) => ({ phone, snippet })),
  };
}

export type LinkCategory = "careers" | "leadership" | "about" | "news" | "contact";

const CATEGORY_PATTERNS: [LinkCategory, RegExp][] = [
  ["careers", /\b(careers?|jobs?|join[- ]us|work[- ]with[- ]us|vacanc|opportunit|hiring|life[- ]at)\b/i],
  [
    "leadership",
    /\b(leadership|management|our[- ]team|the[- ]team|team|our[- ]people|people|board|executives?|partners|directors|who[- ]we[- ]are)\b/i,
  ],
  ["about", /\b(about|company|overview|our[- ]story)\b/i],
  ["news", /\b(news|press|media|announcements?|insights)\b/i],
  ["contact", /\b(contact|offices?|locations?)\b/i],
];

function sameSite(href: string, baseHost: string): boolean {
  try {
    const h = new URL(href).hostname.replace(/^www\./, "");
    const b = baseHost.replace(/^www\./, "");
    return h === b || h.endsWith(`.${b}`) || b.endsWith(`.${h}`);
  } catch {
    return false;
  }
}

/** Pick the most relevant same-site pages for research (not an indiscriminate crawl). */
export function categorizeLinks(links: PageLink[], baseUrl: string): Record<LinkCategory, string[]> {
  const host = new URL(baseUrl).hostname;
  const out: Record<LinkCategory, string[]> = { careers: [], leadership: [], about: [], news: [], contact: [] };
  for (const l of links) {
    if (!sameSite(l.href, host)) continue;
    const path = decodeURIComponent(new URL(l.href).pathname).replace(/[-_/]+/g, " ");
    const hay = `${l.text} ${path}`;
    for (const [cat, re] of CATEGORY_PATTERNS) {
      if (re.test(hay)) {
        if (!out[cat].includes(l.href)) out[cat].push(l.href);
        break;
      }
    }
  }
  return out;
}

export interface AtsReference {
  provider: "GREENHOUSE" | "LEVER" | "ASHBY";
  slug: string;
  region?: "eu";
  url: string;
}

/** Detect applicant-tracking-system job boards linked from a page. */
export function detectAts(links: PageLink[], html = ""): AtsReference[] {
  const found = new Map<string, AtsReference>();
  const candidates = [...links.map((l) => l.href), ...(html.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
  for (const href of candidates) {
    let m = /https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/i.exec(href);
    if (m && m[1] !== "embed") found.set(`GREENHOUSE:${m[1]}`, { provider: "GREENHOUSE", slug: m[1].toLowerCase(), url: href });
    m = /https?:\/\/jobs\.(eu\.)?lever\.co\/([A-Za-z0-9_.-]+)/i.exec(href);
    if (m)
      found.set(`LEVER:${m[2]}`, {
        provider: "LEVER",
        slug: m[2].toLowerCase(),
        region: m[1] ? "eu" : undefined,
        url: href,
      });
    m = /https?:\/\/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i.exec(href);
    if (m) found.set(`ASHBY:${m[1]}`, { provider: "ASHBY", slug: m[1], url: href });
  }
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// People extraction
// ---------------------------------------------------------------------------

export interface ExtractedPerson {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  profileUrl: string | null;
  snippet: string;
  method: "json-ld" | "adjacent-blocks" | "inline";
}

const NAME_PARTICLES = new Set(["de", "da", "del", "der", "van", "von", "bin", "al", "el", "la", "le", "di", "du", "dos"]);
const NOT_NAME_WORDS = new Set(
  [
    "about", "contact", "our", "team", "read", "more", "learn", "view", "board", "directors", "leadership",
    "management", "home", "news", "careers", "privacy", "policy", "terms", "cookie", "services", "company",
    "group", "the", "and", "of", "for", "investor", "relations", "click", "here", "menu", "search", "login",
    "sign", "up", "email", "phone", "follow", "us", "profile", "linkedin", "twitter", "download", "copyright",
    "all", "rights", "reserved", "limited", "ltd", "inc", "llp", "private", "pvt", "global", "india", "europe",
    "marketing", "finance", "banking", "investment", "head", "director", "manager", "partner", "officer",
    "chief", "executive", "president", "senior", "associate", "analyst", "advisory", "office", "offices",
    "brand", "brands", "products", "solutions", "consumer", "food", "beverages", "corporate", "capital",
  ].map((w) => w.toLowerCase()),
);

export function looksLikePersonName(text: string): boolean {
  const t = text.trim().replace(/^(mr|mrs|ms|dr|prof)\.?\s+/i, "");
  if (t.length < 4 || t.length > 45) return false;
  if (/[0-9@|:/\\()[\]{}<>!?]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  let capitalised = 0;
  for (const w of words) {
    const bare = w.replace(/[.,]$/, "");
    if (NAME_PARTICLES.has(bare.toLowerCase())) continue;
    if (NOT_NAME_WORDS.has(bare.toLowerCase())) return false;
    if (!/^[A-ZÀ-ɏ][A-Za-zÀ-ɏ'’.-]*$/.test(bare)) return false;
    if (bare.length === 1) return false;
    capitalised++;
  }
  return capitalised >= 2 && t !== t.toUpperCase();
}

const STRUCTURAL_TAGS = new Set([
  "p", "div", "li", "td", "th", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article",
  "header", "footer", "figcaption", "blockquote", "address", "ul", "ol", "dl", "table", "tbody", "tr",
  "figure", "main", "aside", "br",
]);

interface Block {
  text: string;
  el: Element;
  emails: string[];
  phones: string[];
  hrefs: string[];
}

function ownBlocks($: cheerio.CheerioAPI): Block[] {
  const blocks: Block[] = [];
  const emit = (el: Element) => {
    const text = clean($(el).text());
    if (!text) return;
    const emails: string[] = [];
    const phones: string[] = [];
    const hrefs: string[] = [];
    $(el)
      .find("a[href]")
      .addBack("a[href]")
      .each((_, a) => {
        const href = $(a).attr("href") ?? "";
        if (/^mailto:/i.test(href)) emails.push(decodeURIComponent(href.slice(7).split("?")[0]).toLowerCase());
        else if (/^tel:/i.test(href)) phones.push(href.slice(4));
        else hrefs.push(href);
      });
    for (const m of text.matchAll(EMAIL_RE)) emails.push(m[0].toLowerCase());
    blocks.push({ text, el, emails, phones, hrefs });
  };
  const visit = (node: AnyNode) => {
    if (node.type !== "tag") return;
    const el = node as Element;
    if (["script", "style", "noscript", "svg", "nav", "template", "select", "button"].includes(el.name)) return;
    const children = el.children ?? [];
    const elementChildren = children.filter((c) => c.type === "tag") as Element[];
    const hasStructural = elementChildren.some((c) => STRUCTURAL_TAGS.has(c.name) && clean($(c).text()).length > 0);
    if (hasStructural) {
      for (const c of children) visit(c);
      return;
    }
    // Inline-only content. If every piece of text sits in separate inline children
    // (e.g. <span class="name">…</span><span class="role">…</span>), split them.
    const directText = children.some((c) => c.type === "text" && clean((c as unknown as { data: string }).data).length > 0);
    const textChildren = elementChildren.filter((c) => clean($(c).text()).length > 0);
    if (!directText && textChildren.length >= 2) {
      for (const c of textChildren) visit(c);
      return;
    }
    emit(el);
  };
  const body = $("body").get(0) ?? $.root().get(0);
  if (body) for (const c of (body as Element).children ?? []) visit(c);
  return blocks;
}

const INLINE_SPLIT = /^(.{4,45}?)\s*(?:,|–|—|-|\||:)\s+(.{2,120})$/;

function profileLink(hrefs: string[], baseUrl: string): string | null {
  for (const h of hrefs) {
    try {
      const u = new URL(h, baseUrl);
      if (/linkedin\.com\/in\//i.test(u.href)) return u.href;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Extract name/title pairs (with nearby emails) from a team / leadership page. */
export function extractPeople(html: string, baseUrl: string): ExtractedPerson[] {
  const $ = cheerio.load(html);
  const people = new Map<string, ExtractedPerson>();
  const add = (p: ExtractedPerson) => {
    const key = p.name.toLowerCase();
    const existing = people.get(key);
    if (!existing) people.set(key, p);
    else {
      existing.title ??= p.title;
      existing.email ??= p.email;
      existing.phone ??= p.phone;
      existing.profileUrl ??= p.profileUrl;
    }
  };

  // 1. Structured data
  for (const o of jsonLdObjects($)) {
    const type = o["@type"];
    const isPerson = type === "Person" || (Array.isArray(type) && type.includes("Person"));
    if (!isPerson || typeof o.name !== "string") continue;
    const name = clean(o.name);
    if (!looksLikePersonName(name)) continue;
    add({
      name,
      title: typeof o.jobTitle === "string" ? clean(o.jobTitle) : null,
      email: typeof o.email === "string" ? o.email.replace(/^mailto:/i, "").toLowerCase() : null,
      phone: typeof o.telephone === "string" ? o.telephone : null,
      profileUrl: null,
      snippet: JSON.stringify({ name: o.name, jobTitle: o.jobTitle ?? null }).slice(0, 300),
      method: "json-ld",
    });
  }

  // 2. Visual card patterns
  const blocks = ownBlocks($);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const inline = INLINE_SPLIT.exec(b.text);
    if (inline && looksLikePersonName(inline[1]) && looksLikeJobTitle(inline[2])) {
      add({
        name: clean(inline[1]),
        title: clean(inline[2]),
        email: b.emails[0] ?? null,
        phone: b.phones[0] ?? null,
        profileUrl: profileLink(b.hrefs, baseUrl),
        snippet: b.text.slice(0, 300),
        method: "inline",
      });
      continue;
    }
    if (!looksLikePersonName(b.text)) continue;
    const next = blocks[i + 1];
    const prev = blocks[i - 1];
    let title: string | null = null;
    let used = [b];
    if (next && !looksLikePersonName(next.text) && looksLikeJobTitle(next.text) && next.text.length <= 120) {
      title = next.text;
      used = [b, next];
    } else if (prev && !looksLikePersonName(prev.text) && looksLikeJobTitle(prev.text) && prev.text.length <= 80) {
      title = prev.text;
      used = [prev, b];
    }
    if (!title) continue;
    // Look ahead for contact details until the next person.
    const emails = [...b.emails, ...(next?.emails ?? [])];
    const phones = [...b.phones, ...(next?.phones ?? [])];
    const hrefs = [...b.hrefs, ...(next?.hrefs ?? [])];
    for (let j = i + 2; j < Math.min(blocks.length, i + 5); j++) {
      if (looksLikePersonName(blocks[j].text)) break;
      emails.push(...blocks[j].emails);
      phones.push(...blocks[j].phones);
      hrefs.push(...blocks[j].hrefs);
      used.push(blocks[j]);
    }
    add({
      name: b.text,
      title,
      email: emails[0] ?? null,
      phone: phones[0] ?? null,
      profileUrl: profileLink(hrefs, baseUrl),
      snippet: used.map((u) => u.text).join(" · ").slice(0, 300),
      method: "adjacent-blocks",
    });
  }
  return [...people.values()];
}
