import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 180_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/grl_erp_test",
      AUTH_SECRET: "test-secret-0123456789-0123456789-0123456789",
      GRL_HOME: `${process.cwd()}/storage-test`,
    },
  },
});
