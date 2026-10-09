/**
 * LEVEL 2 - database backup.
 *  1. A JSON snapshot of every table (always works, no external tools) - GRL_DB_SNAPSHOT_<time>.json.gz
 *  2. A native PostgreSQL dump (pg_dump -Fc) when pg_dump is installed - GRL_DB_<time>.dump
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config, BACKUP_DIRS } from "../config.js";
import { APP_VERSION, SCHEMA_VERSION } from "../../shared/calc.js";

const exec = promisify(execFile);

/** Every Prisma model, parents first (order of the schema file, which lists parents before children). */
const MODEL_ORDER = [
  "Company", "Setting", "Customer", "Transporter", "Vehicle", "Driver", "LoadingPoint", "DeliveryPoint", "FreightRate", "Document",
  "Trip", "TripItem", "Expense", "CustomerInvoice", "InvoiceItem", "CustomerReceipt", "TransporterSettlement", "TransporterPayment",
  "VehicleDocument", "DriverDocument", "Target", "Notification", "AuditLog", "User", "RolePermission", "Sequence", "BackupRecord", "RestoreRecord", "License",
];
const delegateName = (m: string) => m[0].toLowerCase() + m.slice(1);

export async function writeSnapshot(filePath: string) {
  const tables: Record<string, unknown[]> = {};
  for (const m of MODEL_ORDER) tables[m] = await (prisma as any)[delegateName(m)].findMany();
  const json = JSON.stringify({ format: "GRL_DB_SNAPSHOT", appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), tables });
  await fs.promises.writeFile(filePath, zlib.gzipSync(json));
  return Object.values(tables).reduce((a, t) => a + t.length, 0);
}

/** Restore a JSON snapshot (used from the command line: npm run db:restore-snapshot -- <file>). Replaces ALL tables. */
export async function restoreSnapshot(filePath: string) {
  const data = JSON.parse(zlib.gunzipSync(await fs.promises.readFile(filePath)).toString("utf8"));
  if (data.format !== "GRL_DB_SNAPSHOT") throw new Error("Not a G Road Lines database snapshot");
  const models = Prisma.dmmf.datamodel.models;
  await prisma.$transaction(async (tx) => {
    for (const m of [...MODEL_ORDER].reverse()) await (tx as any)[delegateName(m)].deleteMany({});
    for (const m of MODEL_ORDER) {
      const rows = (data.tables[m] ?? []) as any[];
      const jsonFields = models.find((x) => x.name === m)!.fields.filter((f) => f.type === "Json").map((f) => f.name);
      const fixed = rows.map((r) => {
        const o = { ...r };
        for (const f of jsonFields) if (o[f] === null) o[f] = Prisma.DbNull;
        return o;
      });
      for (let i = 0; i < fixed.length; i += 1000) await (tx as any)[delegateName(m)].createMany({ data: fixed.slice(i, i + 1000) });
    }
  }, { timeout: 30 * 60_000 });
}

function findPgDump(): string | null {
  if (config.pgDumpPath && fs.existsSync(config.pgDumpPath)) return config.pgDumpPath;
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (fs.existsSync(base)) {
      const versions = fs.readdirSync(base).sort((a, b) => Number(b) - Number(a));
      for (const v of versions) {
        const p = path.join(base, v, "bin", "pg_dump.exe");
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }
  for (const p of ["/usr/bin/pg_dump", "/usr/local/bin/pg_dump", "/opt/homebrew/bin/pg_dump"]) if (fs.existsSync(p)) return p;
  return null;
}

export async function pgDump(filePath: string): Promise<boolean> {
  const bin = findPgDump();
  if (!bin || !config.databaseUrl) return false;
  try {
    const url = new URL(config.databaseUrl);
    url.searchParams.delete("schema");
    await exec(bin, ["-Fc", "--no-owner", "-f", filePath, url.toString()], { timeout: 10 * 60_000 });
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch (e) {
    console.warn("[backup] pg_dump failed:", (e as Error).message);
    return false;
  }
}

export async function databaseBackup(stamp: string, prefix = "GRL_DB") {
  fs.mkdirSync(BACKUP_DIRS.database, { recursive: true });
  const snapshotPath = path.join(BACKUP_DIRS.database, `${prefix}_SNAPSHOT_${stamp}.json.gz`);
  let snapshot: string | null = null, rows = 0;
  try {
    rows = await writeSnapshot(snapshotPath);
    snapshot = snapshotPath;
  } catch (e) {
    // e.g. right after an update, when the tables still have the previous layout; pg_dump below still works
    console.warn("[backup] JSON snapshot failed:", (e as Error).message);
  }
  const dump = path.join(BACKUP_DIRS.database, `${prefix}_${stamp}.dump`);
  const dumped = await pgDump(dump);
  if (!snapshot && !dumped) throw new Error("Database backup failed (no snapshot and no pg_dump).");
  return { snapshot, dump: dumped ? dump : null, rows };
}
