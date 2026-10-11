/** IP and hostname classification used to block requests to non-public destinations. */
import net from "node:net";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function inV4Block(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isPublicIPv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  return !V4_BLOCKS.some(([b, bits]) => inV4Block(ip, b, bits));
}

/** Expand an IPv6 address to 8 groups of 16-bit numbers. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  // Embedded IPv4 tail
  let tail: number[] = [];
  const lastColon = addr.lastIndexOf(":");
  const maybeV4 = addr.slice(lastColon + 1);
  if (net.isIPv4(maybeV4)) {
    const n = ipv4ToInt(maybeV4);
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    addr = addr.slice(0, lastColon + 1) + "0:0";
  }
  const parts = addr.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (parts.length === 1 && missing !== 0) return null;
  const groups = [...head, ...Array(parts.length === 2 ? missing : 0).fill("0"), ...rest].map((g) => parseInt(g || "0", 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  if (tail.length) {
    groups[6] = tail[0];
    groups[7] = tail[1];
  }
  return groups;
}

export function isPublicIPv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return false;
  const g = expandIPv6(ip);
  if (!g) return false;
  const allZeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroPrefix(8)) return false; // ::
  if (allZeroPrefix(7) && g[7] === 1) return false; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible
  if (allZeroPrefix(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPublicIPv4(v4);
  }
  // NAT64 64:ff9b::/96 – check embedded IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIPv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local fc00::/7 (incl. fd00:ec2::254 metadata)
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) {
    // 6to4: check embedded IPv4
    return isPublicIPv4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`);
  }
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  return true;
}

export function isPublicIp(ip: string): boolean {
  return net.isIPv4(ip) ? isPublicIPv4(ip) : net.isIPv6(ip) ? isPublicIPv6(ip) : false;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data", "kubernetes.default"]);

/** Reject hostnames that obviously target internal infrastructure (before DNS). */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (net.isIP(h)) return !isPublicIp(h);
  // Bare numeric / hex hostnames that some resolvers interpret as IPs (e.g. "2130706433", "0x7f.1").
  if (/^[0-9.]+$/.test(h) || /^0x[0-9a-f.]+$/i.test(h)) return true;
  if (!h.includes(".")) return true; // single-label names resolve via local search domains
  return false;
}
