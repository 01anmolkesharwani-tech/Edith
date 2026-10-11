import { describe, expect, it } from "vitest";
import { isBlockedHostname, isPublicIp } from "@/lib/net/ip";
import { isAllowed, parseRobots, crawlDelaySeconds } from "@/lib/net/robots";
import { UnsafeUrlError, validatePublicUrl, safeLookup } from "@/lib/net/safe-fetch";
import { isNeverFetchHost } from "@/lib/providers/search-links";

describe("IP classification", () => {
  it.each([
    ["8.8.8.8", true],
    ["93.184.216.34", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["172.32.0.1", true],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fd00:ec2::254", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["64:ff9b::a9fe:a9fe", false],
    ["2606:4700:4700::1111", true],
  ])("%s public=%s", (ip, pub) => {
    expect(isPublicIp(ip)).toBe(pub);
  });
});

describe("URL validation", () => {
  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
    "http://[::1]/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "https://intranet/",
    "file:///etc/passwd",
    "ftp://example.com/",
    "https://user:pass@example.com/",
    "https://example.com:8080/",
    "http://printer.local/",
  ])("rejects %s", (u) => {
    expect(() => validatePublicUrl(u)).toThrow(UnsafeUrlError);
  });

  it("accepts ordinary public URLs", () => {
    expect(validatePublicUrl("https://www.example.com/about").hostname).toBe("www.example.com");
  });

  it("blocks hostnames that resolve to private addresses at connection time", async () => {
    // "localhost" resolves to loopback via /etc/hosts – the lookup hook must refuse it.
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => safeLookup("localhost", {}, (e) => resolve(e)));
    expect(err?.code).toBe("EBLOCKEDADDRESS");
  });

  it("never fetches sites whose terms prohibit automated collection", () => {
    expect(isNeverFetchHost("www.linkedin.com")).toBe(true);
    expect(isNeverFetchHost("in.linkedin.com")).toBe(true);
    expect(isNeverFetchHost("acme.com")).toBe(false);
    expect(isBlockedHostname("acme.com")).toBe(false);
  });
});

describe("robots.txt", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /private/
Allow: /private/public-page
Crawl-delay: 5

User-agent: BadBot
Disallow: /
`);
  it("applies longest-match rules", () => {
    expect(isAllowed(robots, "careerreachbot", "/about")).toBe(true);
    expect(isAllowed(robots, "careerreachbot", "/private/x")).toBe(false);
    expect(isAllowed(robots, "careerreachbot", "/private/public-page")).toBe(true);
    expect(isAllowed(robots, "badbot", "/about")).toBe(false);
  });
  it("supports wildcards and end anchors", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /search*");
    expect(isAllowed(r, "x", "/file.pdf")).toBe(false);
    expect(isAllowed(r, "x", "/file.pdf?x=1")).toBe(true);
    expect(isAllowed(r, "x", "/searching")).toBe(false);
  });
  it("reads crawl-delay", () => {
    expect(crawlDelaySeconds(robots, "careerreachbot")).toBe(5);
  });
  it("disallows everything when robots.txt is unreachable", () => {
    expect(isAllowed({ groups: [], mode: "disallow-all" }, "x", "/")).toBe(false);
  });
});
