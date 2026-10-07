import { execSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Bring the dedicated test database up to date (non-destructive) and make sure base
 * configuration exists. Tests create their own uniquely-named data, so they can be
 * re-run against the same database without resetting it.
 */
export default async function setup() {
  const env = { ...process.env, ...(config({ path: ".env.test", override: true }).parsed ?? {}) };
  if (!env.DATABASE_URL?.includes("test")) throw new Error("Refusing to run tests against a database whose name does not contain 'test'.");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx tests/seed-test.ts", { stdio: "inherit", env });
}
