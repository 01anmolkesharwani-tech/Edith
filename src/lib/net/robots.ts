/** robots.txt parsing and matching (RFC 9309). */
import type { Fetcher } from "./safe-fetch";

export interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
  crawlDelay?: number;
}

export interface Robots {
  groups: RobotsGroup[];
  /** "allow-all" when robots.txt is absent (4xx); "disallow-all" when unreachable (5xx/error). */
  mode: "parsed" | "allow-all" | "disallow-all";
}

export function parseRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (key === "disallow" && value === "") continue; // empty Disallow = allow all
      current.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups, mode: "parsed" };
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith("$");
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}

function groupFor(robots: Robots, userAgentToken: string): RobotsGroup | null {
  const token = userAgentToken.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  if (specific.length) {
    return { agents: [token], rules: specific.flatMap((g) => g.rules), crawlDelay: specific[0].crawlDelay };
  }
  const star = robots.groups.filter((g) => g.agents.includes("*"));
  if (star.length) return { agents: ["*"], rules: star.flatMap((g) => g.rules), crawlDelay: star[0].crawlDelay };
  return null;
}

export function isAllowed(robots: Robots, userAgentToken: string, pathWithQuery: string): boolean {
  if (robots.mode === "allow-all") return true;
  if (robots.mode === "disallow-all") return false;
  if (pathWithQuery === "/robots.txt") return true;
  const group = groupFor(robots, userAgentToken);
  if (!group) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    if (!r.path || !ruleMatches(r.path, pathWithQuery)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

export function crawlDelaySeconds(robots: Robots, userAgentToken: string): number | undefined {
  return groupFor(robots, userAgentToken)?.crawlDelay;
}

/** Fetches and caches robots.txt per origin. */
export class RobotsCache {
  private cache = new Map<string, { robots: Robots; at: number }>();
  constructor(
    private readonly fetcher: Fetcher,
    private readonly userAgent: string,
    private readonly ttlMs = 3_600_000,
  ) {}

  async get(origin: string): Promise<Robots> {
    const hit = this.cache.get(origin);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.robots;
    let robots: Robots;
    try {
      const res = await this.fetcher(`${origin}/robots.txt`, {
        userAgent: this.userAgent,
        accept: "text/plain",
        allowedTypes: ["text/plain", "text/html", "application/octet-stream", ""],
        maxBytes: 500_000,
        timeoutMs: 8_000,
      });
      if (res.status >= 200 && res.status < 300) robots = parseRobots(res.body);
      else if (res.status >= 400 && res.status < 500) robots = { groups: [], mode: "allow-all" };
      else robots = { groups: [], mode: "disallow-all" };
    } catch {
      robots = { groups: [], mode: "disallow-all" };
    }
    this.cache.set(origin, { robots, at: Date.now() });
    return robots;
  }

  async allowed(url: string, token = "careerreachbot"): Promise<boolean> {
    const u = new URL(url);
    const robots = await this.get(u.origin);
    return isAllowed(robots, token, u.pathname + u.search);
  }
}
