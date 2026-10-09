import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { prisma } from "../src/server/db.js";
import { applyMigrations } from "../src/server/migrate.js";

describe("built-in migration runner (used by the Windows app)", () => {
  it("creates the schema on an empty database and is recognised by prisma migrate", async () => {
    await prisma.$executeRawUnsafe("DROP SCHEMA public CASCADE");
    await prisma.$executeRawUnsafe("CREATE SCHEMA public");
    const applied = await applyMigrations();
    expect(applied.length).toBeGreaterThan(0);
    expect(await prisma.trip.count()).toBe(0);
    expect(await applyMigrations()).toEqual([]); // idempotent
    const status = execSync("npx prisma migrate status", { env: process.env, encoding: "utf8" });
    expect(status).toMatch(/up to date/i);
  });
});
