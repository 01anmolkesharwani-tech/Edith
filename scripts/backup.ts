/** npm run db:backup – consistent online copy of the SQLite database into data/backups/. */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { backupDir, databaseFilePath } from "../src/lib/paths";

async function main() {
  fs.mkdirSync(backupDir(), { recursive: true, mode: 0o700 });
  const target = path.join(backupDir(), `careerreach-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  const db = new Database(databaseFilePath(), { readonly: true, fileMustExist: true });
  await db.backup(target);
  db.close();
  console.log(`Backup written to ${target}`);
  console.log("Résumé files live in data/resumes/ – copy that folder too for a complete backup.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
