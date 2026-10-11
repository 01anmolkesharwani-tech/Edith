/**
 * npm run db:restore -- <backup-file>
 * Stop the app first. The current database is kept as <db>.before-restore-<timestamp>.
 */
import "dotenv/config";
import fs from "node:fs";
import Database from "better-sqlite3";
import { databaseFilePath } from "../src/lib/paths";

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error("Usage: npm run db:restore -- <path-to-backup.db>");
  process.exit(1);
}
function isValidBackup(file: string): boolean {
  try {
    const check = new Database(file, { readonly: true });
    const ok = check.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    const hasTables = check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'CandidateProfile'").get() as { n: number };
    check.close();
    return ok.integrity_check === "ok" && hasTables.n > 0;
  } catch {
    return false;
  }
}
if (!isValidBackup(src)) {
  console.error("The file is not a valid CareerReach database backup.");
  process.exit(1);
}
const target = databaseFilePath();
if (fs.existsSync(target)) {
  const keep = `${target}.before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(target, keep);
  console.log(`Previous database kept at ${keep}`);
}
for (const ext of ["-wal", "-shm"]) fs.rmSync(target + ext, { force: true });
fs.copyFileSync(src, target);
console.log(`Restored ${src} → ${target}. Run "npm run db:migrate" if the backup predates newer migrations, then start the app.`);
