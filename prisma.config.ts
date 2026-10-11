import "dotenv/config";
import { defineConfig } from "prisma/config";

// Default keeps all data inside the project's ./data directory (git-ignored).
const url = process.env.DATABASE_URL ?? "file:./data/careerreach.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
