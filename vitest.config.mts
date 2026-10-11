import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup-db.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    // Never allow real network access for SMTP/HTTP in tests: providers receive injected fakes.
    env: { CAREERREACH_TEST: "1" },
  },
});
