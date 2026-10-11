import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Each test file gets its own copy of the migrated template database and data directory.
const root = process.env.CAREERREACH_TEST_ROOT!;
const id = randomUUID();
const dataDir = path.join(root, id);
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "test.db");
fs.copyFileSync(process.env.CAREERREACH_TEST_TEMPLATE_DB!, dbFile);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.CAREERREACH_DATA_DIR = dataDir;
