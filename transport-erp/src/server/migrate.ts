/**
 * Applies pending database migrations at start-up, without needing the Prisma CLI
 * (the Windows desktop app ships only the runtime). It writes the same bookkeeping rows as
 * `prisma migrate deploy`, so both tools can be used on the same database.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./db.js";

export function findMigrationsDir(): string | null {
  const candidates = [process.env.GRL_MIGRATIONS_DIR, path.resolve(process.cwd(), "prisma/migrations"), path.resolve(__dirnameSafe(), "../../../prisma/migrations"), path.resolve(__dirnameSafe(), "../../prisma/migrations")];
  return candidates.find((d) => d && fs.existsSync(d)) ?? null;
}
function __dirnameSafe() {
  try { return path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); } catch { return process.cwd(); }
}

/** Split a generated migration into statements (Prisma output has no procedural $$ blocks). */
function statements(sql: string) {
  return sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
}

export async function applyMigrations(dir = findMigrationsDir()): Promise<string[]> {
  if (!dir) throw new Error("Migrations folder not found.");
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
  const done = new Set((await prisma.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).map((r) => r.migration_name));
  const applied: string[] = [];
  for (const name of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "migration.sql"))).sort()) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await prisma.$transaction(async (tx) => {
      for (const st of statements(sql)) await tx.$executeRawUnsafe(st);
      await tx.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`, randomUUID(), checksum, name);
    }, { timeout: 10 * 60_000 });
    applied.push(name);
  }
  return applied;
}
