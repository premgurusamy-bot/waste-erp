import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/server/db.js";
import { seedBase, seedDemo } from "../src/server/seed/seed.js";
import { writeSnapshot, restoreSnapshot } from "../src/server/backup/database-backup.js";
import { loadAll } from "../src/server/backup/excel-export.js";
import { computeFinancials } from "../src/server/backup/financials.js";
import { adminCtx, wipeAll } from "./helpers.js";

describe("database snapshot (backup level 2)", () => {
  it("restores every table, including users, from the JSON snapshot", async () => {
    await wipeAll();
    await seedBase({ adminPassword: "Admin@12345" });
    await seedDemo(adminCtx());
    const before = computeFinancials(await loadAll());
    const users = await prisma.user.count();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "grl-snap-")), "snap.json.gz");
    const rows = await writeSnapshot(file);
    expect(rows).toBeGreaterThan(1000);
    await wipeAll();
    expect(await prisma.trip.count()).toBe(0);
    await restoreSnapshot(file);
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.trip.count()).toBe(100);
    expect(computeFinancials(await loadAll())).toEqual(before);
  });
});
