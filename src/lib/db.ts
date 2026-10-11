import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { databaseFilePath } from "./paths";

const globalForPrisma = globalThis as unknown as { __careerreachPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: `file:${databaseFilePath()}` });
  return new PrismaClient({ adapter });
}

/** Single Prisma client per process (re-used across hot reloads in development). */
export const db: PrismaClient = globalForPrisma.__careerreachPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__careerreachPrisma = db;

export type Db = PrismaClient;
