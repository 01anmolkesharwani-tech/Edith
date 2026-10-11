import { describe, expect, it } from "vitest";
import {
  applyPattern,
  checkDomainAndMx,
  checkSyntax,
  deriveEmailStatus,
  inferPattern,
  isRoleAddress,
  type DnsResolver,
} from "@/lib/email/validation";
import { mapHunterStatus } from "@/lib/providers/hunter";
import { smtpDiagnostic, type SmtpConnector } from "@/lib/email/smtp-diagnostic";

const now = new Date("2026-10-11T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

function resolver(map: { mx?: Record<string, { exchange: string; priority: number }[] | Error>; a?: Record<string, string[]> }): DnsResolver {
  const err = (code: string) => Object.assign(new Error(code), { code });
  return {
    async resolveMx(d) {
      const v = map.mx?.[d];
      if (v instanceof Error) throw v;
      if (!v) throw err("ENOTFOUND");
      return v;
    },
    async resolve4(d) {
      const v = map.a?.[d];
      if (!v) throw err("ENOTFOUND");
      return v;
    },
    async resolve6() {
      throw err("ENODATA");
    },
  };
}

describe("A. syntax", () => {
  it.each([
    ["priya.sharma@acme.co.in", true],
    ["first+tag@sub.example.com", true],
    ["no-at-sign.example.com", false],
    ["two@@example.com", false],
    ["dot..dot@example.com", false],
    [".lead@example.com", false],
    ["user@localhost", false],
    ["user@-bad.com", false],
    [`${"a".repeat(65)}@example.com`, false],
  ])("%s → %s", (email, ok) => {
    expect(checkSyntax(email).ok).toBe(ok);
  });
});

describe("B/C. domain and MX", () => {
  it("passes when MX records exist", async () => {
    const r = await checkDomainAndMx("acme.com", resolver({ mx: { "acme.com": [{ exchange: "mx1.acme.com", priority: 10 }] } }));
    expect(r.map((x) => [x.stage, x.result])).toEqual([["DOMAIN", "PASS"], ["MX", "PASS"]]);
  });
  it("fails on a null MX (domain accepts no mail)", async () => {
    const r = await checkDomainAndMx("nomail.com", resolver({ mx: { "nomail.com": [{ exchange: ".", priority: 0 }] } }));
    expect(r.find((x) => x.stage === "MX")!.result).toBe("FAIL");
  });
  it("is inconclusive when only an A record exists", async () => {
    const r = await checkDomainAndMx("aonly.com", resolver({ a: { "aonly.com": ["93.184.216.34"] } }));
    expect(r.find((x) => x.stage === "MX")!.result).toBe("INCONCLUSIVE");
  });
  it("fails when the domain does not exist", async () => {
    const r = await checkDomainAndMx("missing.invalid", resolver({}));
    expect(r.every((x) => x.result === "FAIL")).toBe(true);
  });
  it("reports ERROR (not FAIL) on resolver errors", async () => {
    const r = await checkDomainAndMx("x.com", resolver({ mx: { "x.com": Object.assign(new Error("t"), { code: "ETIMEOUT" }) } }));
    expect(r.every((x) => x.result === "ERROR")).toBe(true);
  });
});

describe("status derivation", () => {
  const v = (stage: string, result: string, at = now) => ({ stage, result, checkedAt: at });

  it("never calls a domain check 'verified'", () => {
    const s = deriveEmailStatus({ email: "a@b.com", verifications: [v("SYNTAX", "PASS"), v("DOMAIN", "PASS"), v("MX", "PASS")], evidence: [], now });
    expect(s.status).toBe("DOMAIN_CONFIGURED");
    expect(s.reasons.join(" ")).toMatch(/unconfirmed/);
  });
  it("marks exact public listings as publicly listed", () => {
    const s = deriveEmailStatus({
      email: "a@b.com",
      verifications: [v("MX", "PASS")],
      evidence: [{ sourceType: "OFFICIAL_TEAM_PAGE", observedAt: daysAgo(3), verificationMethod: "EXACT_MATCH_ON_PAGE" }],
      now,
    });
    expect(s.status).toBe("PUBLICLY_LISTED");
  });
  it("marks old public listings as stale", () => {
    const s = deriveEmailStatus({
      email: "a@b.com",
      verifications: [],
      evidence: [{ sourceType: "NEWS_ARTICLE", observedAt: daysAgo(1), publishedAt: daysAgo(400), verificationMethod: "EXACT_MATCH_ON_PAGE" }],
      now,
    });
    expect(s.status).toBe("STALE");
  });
  it("does not count a manually entered address as publicly listed, even with an official source", () => {
    const s = deriveEmailStatus({
      email: "a@b.com",
      verifications: [v("SYNTAX", "PASS")],
      evidence: [{ sourceType: "OFFICIAL_BIO", observedAt: now, verificationMethod: "MANUAL_ENTRY" }],
      now,
    });
    expect(s.status).toBe("SYNTAX_VALID");
  });
  it("does not count user-provided or imported evidence as public", () => {
    const s = deriveEmailStatus({
      email: "a@b.com",
      verifications: [v("SYNTAX", "PASS")],
      evidence: [{ sourceType: "CSV_IMPORT", observedAt: now, verificationMethod: "IMPORT" }],
      now,
    });
    expect(s.status).toBe("SYNTAX_VALID");
  });
  it("labels pattern guesses uncertain even if the domain is configured", () => {
    const s = deriveEmailStatus({ email: "a@b.com", emailOrigin: "PATTERN_GUESS", verifications: [v("MX", "PASS")], evidence: [], now });
    expect(s.status).toBe("UNCERTAIN");
    expect(s.isGuess).toBe(true);
  });
  it("respects provider results and their age", () => {
    expect(deriveEmailStatus({ email: "a@b.com", verifications: [v("PROVIDER", "PASS")], evidence: [], now }).status).toBe("PROVIDER_VERIFIED");
    expect(deriveEmailStatus({ email: "a@b.com", verifications: [v("PROVIDER", "PASS", daysAgo(200))], evidence: [], now }).status).toBe("STALE");
    expect(deriveEmailStatus({ email: "a@b.com", verifications: [v("PROVIDER", "CATCH_ALL")], evidence: [], now }).status).toBe("CATCH_ALL_RISKY");
    expect(deriveEmailStatus({ email: "a@b.com", verifications: [v("PROVIDER", "FAIL")], evidence: [], now }).status).toBe("UNDELIVERABLE");
  });
  it("is NOT_CHECKED when nothing ran", () => {
    expect(deriveEmailStatus({ email: "a@b.com", verifications: [], evidence: [], now }).status).toBe("NOT_CHECKED");
  });
  it("detects shared role inboxes", () => {
    expect(isRoleAddress("careers@acme.com")).toBe(true);
    expect(isRoleAddress("priya@acme.com")).toBe(false);
  });
});

describe("pattern inference (guesses are never verified)", () => {
  it("infers first.last from public examples", () => {
    const p = inferPattern([
      { email: "anita.rao@acme.com", firstName: "Anita", lastName: "Rao" },
      { email: "vikram.shah@acme.com", firstName: "Vikram", lastName: "Shah" },
    ]);
    expect(p).toEqual({ pattern: "first.last", support: 2 });
    expect(applyPattern(p!.pattern, "Priya", "Sharma", "acme.com")).toBe("priya.sharma@acme.com");
  });
});

describe("E. provider mapping", () => {
  it("maps Hunter statuses conservatively", () => {
    expect(mapHunterStatus("valid").result).toBe("PASS");
    expect(mapHunterStatus("accept_all").result).toBe("CATCH_ALL");
    expect(mapHunterStatus("unknown").result).toBe("INCONCLUSIVE");
    expect(mapHunterStatus("webmail").result).toBe("INCONCLUSIVE");
  });
});

describe("F. SMTP diagnostic (never sends DATA)", () => {
  function scripted(replies: number[]): { connector: SmtpConnector; written: string[] } {
    const written: string[] = [];
    let i = 0;
    return {
      written,
      connector: async () => ({
        read: async () => ({ code: replies[i++] ?? 221, text: "" }),
        write: async (l) => {
          written.push(l);
        },
        close: () => undefined,
      }),
    };
  }
  it("reports acceptance as inconclusive, not verified", async () => {
    const s = scripted([220, 250, 250, 250, 550]);
    const r = await smtpDiagnostic("a@one.com", "mx.one.com", { connector: s.connector, minIntervalMs: 0 });
    expect(r.result).toBe("INCONCLUSIVE");
    expect(s.written.some((w) => w.startsWith("DATA"))).toBe(false);
  });
  it("detects catch-all", async () => {
    const s = scripted([220, 250, 250, 250, 250]);
    expect((await smtpDiagnostic("a@two.com", "mx.two.com", { connector: s.connector, minIntervalMs: 0 })).result).toBe("CATCH_ALL");
  });
  it("rate limits probes per domain", async () => {
    const s = scripted([220, 250, 250, 550]);
    await smtpDiagnostic("a@three.com", "mx", { connector: s.connector });
    expect((await smtpDiagnostic("b@three.com", "mx", { connector: s.connector })).result).toBe("SKIPPED");
  });
});
