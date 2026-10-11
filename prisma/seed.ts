/**
 * Seed script.
 *   npm run db:seed        – creates the two default portals (Marketing, Finance) with NO
 *                            candidate personal data; names/education come from résumés.
 *   npm run db:seed:demo   – additionally creates clearly labelled DEMO records
 *                            (example.com domains, "[DEMO]" names) in a separate "demo" profile,
 *                            so fictional data is never mixed with real discovery results.
 */
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { databaseFilePath } from "../src/lib/paths";
import { DEFAULT_PROFILES } from "../src/lib/services/profile-defaults";

const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databaseFilePath()}` }) });

async function main() {
  for (const p of DEFAULT_PROFILES) {
    await db.candidateProfile.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        slug: p.slug,
        portalName: p.portalName,
        accentColor: p.accentColor,
        careerObjective: p.careerObjective,
        targetRoles: JSON.stringify(p.targetRoles),
        targetIndustries: JSON.stringify(p.targetIndustries),
        targetFunctions: JSON.stringify(p.targetFunctions),
        targetContactTitles: JSON.stringify(p.targetContactTitles),
      },
    });
  }
  await db.applicationSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  console.log("Seeded default portals: marketing, finance (no candidate personal data).");

  if (process.argv.includes("--demo")) {
    const demo = await db.candidateProfile.upsert({
      where: { slug: "demo" },
      update: {},
      create: {
        slug: "demo",
        portalName: "[DEMO] Sample portal",
        candidateName: "[DEMO] Sample Candidate",
        currentStatus: "a fictional candidate used to demonstrate the app",
        accentColor: "amber",
        targetRoles: JSON.stringify(["brand management"]),
        targetFunctions: JSON.stringify(["marketing", "brand"]),
        targetIndustries: JSON.stringify(["consumer goods"]),
        targetContactTitles: JSON.stringify(["brand manager", "talent acquisition"]),
      },
    });
    const company = await db.company.upsert({
      where: { domain: "demo-company.example.com" },
      update: {},
      create: {
        name: "[DEMO] Example Consumer Co.",
        normalizedName: "demo example consumer",
        domain: "demo-company.example.com",
        website: "https://demo-company.example.com/",
        industry: "consumer goods (fictional)",
        description: "Fictional company for demonstration only.",
        origin: "MANUAL",
      },
    });
    await db.profileCompany.upsert({
      where: { profileId_companyId: { profileId: demo.id, companyId: company.id } },
      update: {},
      create: { profileId: demo.id, companyId: company.id, status: "TARGET" },
    });
    const exists = await db.contact.findFirst({ where: { profileId: demo.id } });
    if (!exists) {
      await db.contact.create({
        data: {
          profileId: demo.id,
          companyId: company.id,
          fullName: "[DEMO] Alex Example",
          normalizedName: "demo alex example",
          title: "Brand Manager (fictional)",
          email: "alex@demo-company.example.com",
          emailNormalized: "alex@demo-company.example.com",
          emailOrigin: "USER_PROVIDED",
          origin: "MANUAL",
          notes: "Demonstration record. example.com addresses cannot receive email.",
          evidence: {
            create: [
              { field: "NAME", value: "[DEMO] Alex Example", sourceType: "USER_PROVIDED", verificationMethod: "MANUAL_ENTRY", confidence: "LOW", origin: "MANUAL", notes: "Demo data" },
              { field: "TITLE", value: "Brand Manager (fictional)", sourceType: "USER_PROVIDED", verificationMethod: "MANUAL_ENTRY", confidence: "LOW", origin: "MANUAL", notes: "Demo data" },
            ],
          },
        },
      });
    }
    console.log('Seeded clearly labelled demo data in the separate "demo" profile.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
