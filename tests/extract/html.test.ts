import { describe, expect, it } from "vitest";
import { categorizeLinks, detectAts, extractPage, extractPeople, looksLikePersonName } from "@/lib/extract/html";

const TEAM = `<!doctype html><html><head><title>Our Leadership | Acme Foods</title>
<meta name="description" content="Acme Foods makes packaged snacks and beverages.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Meera Iyer","jobTitle":"Chief Marketing Officer"}</script>
</head><body>
<nav><a href="/careers">Careers</a> <a href="/about-us">About us</a></nav>
<section class="team">
  <div class="card"><h3>Priya Sharma</h3><p>Head of Marketing</p><a href="mailto:priya.sharma@acmefoods.com">Email</a></div>
  <div class="card"><h3>Rahul Mehta</h3><p>Talent Acquisition Manager</p><a href="https://www.linkedin.com/in/rahulmehta">LinkedIn</a></div>
  <div class="card"><span class="name">Anita Rao</span><span class="role">Category Manager – Beverages</span></div>
  <p>Vikram Shah, Brand Manager</p>
  <div class="card"><h3>Learn More</h3><p>Read about our values</p></div>
</section>
<footer>Contact careers@acmefoods.com or +91 22 4000 1234. <a href="https://boards.greenhouse.io/acmefoods">Jobs</a></footer>
</body></html>`;

describe("people extraction", () => {
  const people = extractPeople(TEAM, "https://acmefoods.com/leadership");
  const byName = Object.fromEntries(people.map((p) => [p.name, p]));

  it("extracts name/title pairs from cards", () => {
    expect(byName["Priya Sharma"]?.title).toBe("Head of Marketing");
    expect(byName["Rahul Mehta"]?.title).toBe("Talent Acquisition Manager");
    expect(byName["Anita Rao"]?.title).toBe("Category Manager – Beverages");
  });
  it("extracts inline 'Name, Title'", () => {
    expect(byName["Vikram Shah"]?.title).toBe("Brand Manager");
  });
  it("uses JSON-LD Person data", () => {
    expect(byName["Meera Iyer"]).toMatchObject({ title: "Chief Marketing Officer", method: "json-ld" });
  });
  it("associates only the email in the same card", () => {
    expect(byName["Priya Sharma"].email).toBe("priya.sharma@acmefoods.com");
    expect(byName["Rahul Mehta"].email).toBeNull();
    expect(byName["Rahul Mehta"].profileUrl).toContain("linkedin.com/in/rahulmehta");
  });
  it("does not invent people from navigation text", () => {
    expect(byName["Learn More"]).toBeUndefined();
    expect(people.length).toBe(5);
  });
  it("keeps a snippet for evidence", () => {
    expect(byName["Priya Sharma"].snippet).toContain("Head of Marketing");
  });
});

describe("page extraction", () => {
  const page = extractPage(TEAM, "https://acmefoods.com/leadership");
  it("gets title, description, emails and links", () => {
    expect(page.title).toContain("Acme Foods");
    expect(page.description).toBe("Acme Foods makes packaged snacks and beverages.");
    expect(page.emails.map((e) => e.email)).toEqual(expect.arrayContaining(["priya.sharma@acmefoods.com", "careers@acmefoods.com"]));
  });
  it("categorises relevant same-site links only", () => {
    const cats = categorizeLinks(page.links, "https://acmefoods.com/");
    expect(cats.careers).toContain("https://acmefoods.com/careers");
    expect(cats.about).toContain("https://acmefoods.com/about-us");
    expect(Object.values(cats).flat().some((u) => u.includes("greenhouse"))).toBe(false);
  });
  it("detects ATS job boards", () => {
    expect(detectAts(page.links)).toEqual([expect.objectContaining({ provider: "GREENHOUSE", slug: "acmefoods" })]);
  });
});

describe("person-name heuristic", () => {
  it.each([
    ["Priya Sharma", true],
    ["Jean-Luc van der Berg", true],
    ["Our Team", false],
    ["Board Of Directors", false],
    ["ACME FOODS", false],
    ["Read More", false],
    ["Priya", false],
  ])("%s → %s", (t, ok) => {
    expect(looksLikePersonName(t)).toBe(ok);
  });
});
