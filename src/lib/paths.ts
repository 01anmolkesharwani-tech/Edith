import path from "node:path";

/** Root directory for all local runtime data (database, résumés, backups). */
export function dataRoot(): string {
  // Runtime data location, not a build input (excluded from output tracing).
  return path.resolve(/*turbopackIgnore: true*/ process.env.CAREERREACH_DATA_DIR ?? path.join(process.cwd(), "data"));
}

/** Résumé storage lives outside `public/` so files are never served statically. */
export function resumeStorageDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.CAREERREACH_RESUME_DIR ?? path.join(dataRoot(), "resumes"));
}

export function backupDir(): string {
  return path.join(dataRoot(), "backups");
}

/** Resolve a Prisma-style `file:` URL to an absolute path (relative to the project root). */
export function databaseFilePath(url = process.env.DATABASE_URL ?? "file:./data/careerreach.db"): string {
  const raw = url.replace(/^file:/, "");
  return path.isAbsolute(raw) ? raw : path.resolve(/*turbopackIgnore: true*/ process.cwd(), raw);
}
