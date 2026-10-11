import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

/** Build a template database from the committed migrations once per test run. */
export default function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "careerreach-test-"));
  const template = path.join(dir, "template.db");
  const db = new Database(template);
  const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
    .sort();
  for (const m of migrations) db.exec(fs.readFileSync(path.join(migrationsDir, m, "migration.sql"), "utf8"));
  db.close();
  process.env.CAREERREACH_TEST_TEMPLATE_DB = template;
  process.env.CAREERREACH_TEST_ROOT = dir;
  return () => fs.rmSync(dir, { recursive: true, force: true });
}
