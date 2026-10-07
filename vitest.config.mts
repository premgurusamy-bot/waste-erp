import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests always run against the separate test database defined in .env.test
const env = config({ path: ".env.test", override: true }).parsed ?? {};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    env,
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    alias: { "server-only": new URL("./tests/server-only-stub.ts", import.meta.url).pathname },
  },
});
