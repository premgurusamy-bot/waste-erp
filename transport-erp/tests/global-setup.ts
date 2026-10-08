import { execSync } from "node:child_process";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

/** Fresh, empty TEST database (grl_erp_test) for every run. Never point TEST_DATABASE_URL at real data. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/grl_erp_test";
  if (!/test/i.test(new URL(url).pathname)) throw new Error("Refusing to run tests: the test database name must contain 'test'.");
  const db = new PrismaClient({ datasourceUrl: url });
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");
  await db.$disconnect();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
  fs.rmSync(`${process.cwd()}/storage-test`, { recursive: true, force: true });
}
