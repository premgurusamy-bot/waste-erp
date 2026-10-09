import { execSync } from "node:child_process";
import { prisma } from "../src/server/db.js";
import { systemCtx } from "../src/server/context.js";
import { ALL_PERMISSIONS } from "../src/shared/permissions.js";

export const adminCtx = () => systemCtx(ALL_PERMISSIONS, "Test Admin");

/** Empty every table (business + system). */
export async function wipeAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

/** Really delete the database: drop the whole schema and rebuild it from the migrations, as on a new computer. */
export async function dropAndRecreateDatabase() {
  await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA public`);
  await prisma.$disconnect();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  await prisma.$connect();
}
