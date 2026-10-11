/**
 * SSRF-hardened HTTP client for retrieving *public* web pages and documented public APIs.
 *
 * Protections:
 * - Only http(s) on ports 80/443; no embedded credentials.
 * - Hostname deny-list (localhost, *.internal, metadata hosts, single-label names, numeric hosts).
 * - Every DNS answer is checked at connection time (custom `lookup`), so private, loopback,
 *   link-local and cloud-metadata addresses are refused even after DNS rebinding.
 * - Redirects are followed manually (max 5) and each hop is re-validated.
 * - Timeouts, response-size limits and content-type allow-lists.
 *
 * Note: requests are made directly (not via HTTP(S)_PROXY) so the address checks apply.
 */
import dns, { type LookupAddress } from "node:dns";
import { Agent, request } from "undici";
import { isBlockedHostname, isPublicIp } from "./ip";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  accept?: string;
  /** Lower-case content-type prefixes that are accepted. */
  allowedTypes?: string[];
  maxRedirects?: number;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
  headers: Record<string, string>;
  retrievedAt: Date;
}

/** Injectable fetcher – providers depend on this type so tests can supply fixtures. */
export type Fetcher = (url: string, opts?: FetchOptions) => Promise<FetchResult>;

export const DEFAULT_USER_AGENT = "CareerReachBot/0.1 (personal job-search research tool; respects robots.txt)";

export function validatePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("Not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) throw new UnsafeUrlError("Only standard web ports (80/443) are allowed.");
  if (isBlockedHostname(url.hostname)) throw new UnsafeUrlError("This destination is not a public website.");
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;

/** DNS lookup that refuses non-public answers. Used for every outbound connection. */
export function safeLookup(hostname: string, options: { all?: boolean } | number, callback: LookupCb): void {
  const wantAll = typeof options === "object" && !!options?.all;
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    if (!list.length) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }));
    const blocked = list.find((a) => !isPublicIp(a.address));
    if (blocked) {
      return callback(
        Object.assign(new Error(`Blocked non-public address for ${hostname}`), { code: "EBLOCKEDADDRESS" }),
      );
    }
    if (wantAll) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

let agent: Agent | null = null;
function getAgent(): Agent {
  agent ??= new Agent({
    connect: { lookup: safeLookup as never, timeout: 10_000 },
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
  });
  return agent;
}

function decode(buf: Buffer, contentType: string): string {
  const m = /charset=([^;]+)/i.exec(contentType);
  const charset = (m?.[1] ?? "utf-8").trim().replace(/["']/g, "").toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export const safeFetch: Fetcher = async (input, opts = {}) => {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const allowed = opts.allowedTypes ?? ["text/html", "application/xhtml+xml", "text/plain"];
  let current = validatePublicUrl(input);
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res;
    try {
      res = await request(current, {
        method: "GET",
        dispatcher: getAgent(),
        signal,
        headers: {
          "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
          accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
          "accept-language": "en",
        },
      });
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === "EBLOCKEDADDRESS") throw new UnsafeUrlError("The site resolved to a non-public address.");
      if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") {
        throw new FetchError(`Timed out after ${timeoutMs} ms`);
      }
      throw new FetchError(`Request failed: ${(e as Error).message}`);
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");

    if (res.statusCode >= 300 && res.statusCode < 400 && headers.location) {
      await res.body.dump();
      if (hop === maxRedirects) throw new FetchError("Too many redirects");
      current = validatePublicUrl(new URL(headers.location, current).toString());
      continue;
    }

    const contentType = (headers["content-type"] ?? "").toLowerCase();
    if (res.statusCode >= 200 && res.statusCode < 300 && !allowed.some((t) => contentType.startsWith(t))) {
      await res.body.dump();
      throw new FetchError(`Unsupported content type: ${contentType || "unknown"}`, res.statusCode);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    for await (const chunk of res.body) {
      const b = chunk as Buffer;
      if (size + b.length > maxBytes) {
        chunks.push(b.subarray(0, maxBytes - size));
        truncated = true;
        res.body.destroy();
        break;
      }
      chunks.push(b);
      size += b.length;
    }

    return {
      url: input,
      finalUrl: current.toString(),
      status: res.statusCode,
      contentType,
      body: decode(Buffer.concat(chunks), contentType),
      truncated,
      headers,
      retrievedAt: new Date(),
    };
  }
  throw new FetchError("Too many redirects");
};

/** Simple per-host politeness delay. */
export class HostThrottle {
  private next = new Map<string, number>();
  constructor(private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  async wait(host: string, delayMs: number): Promise<void> {
    const now = Date.now();
    const at = this.next.get(host) ?? 0;
    this.next.set(host, Math.max(now, at) + delayMs);
    if (at > now) await this.sleep(at - now);
  }
}
