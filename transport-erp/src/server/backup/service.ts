/**
 * Backup orchestration: Excel backups (level 1), database backups (level 2), manual / emergency full backups (level 3),
 * verification, history, retention and the backup health shown on the dashboard.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import archiver from "archiver";
import { prisma } from "../db.js";
import { BACKUP_DIRS, UPLOAD_DIR, ensureDirs } from "../config.js";
import { loadAll, writeBackupWorkbook } from "./excel-export.js";
import { readBackupWorkbook } from "./excel-read.js";
import { verifyParsed } from "./restore.js";
import { databaseBackup } from "./database-backup.js";
import { stamp } from "../lib/util.js";
import { APP_VERSION, SCHEMA_VERSION, backupAgeLevel, todayIst } from "../../shared/calc.js";
import { getSettings } from "../services/settings.js";

export type BackupType = "AUTOMATIC" | "MANUAL" | "PRE-RESTORE" | "PRE-UPDATE" | "EMERGENCY" | "EXPORT";

function log(line: string) {
  try {
    fs.mkdirSync(BACKUP_DIRS.logs, { recursive: true });
    fs.appendFileSync(path.join(BACKUP_DIRS.logs, "backup.log"), `${new Date().toISOString()}  ${line}\n`);
  } catch { /* logging must never break a backup */ }
}

async function dbVersion() {
  try {
    const r = await prisma.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    return `PostgreSQL ${r[0].server_version}`;
  } catch {
    return "PostgreSQL";
  }
}

const PREFIX: Record<BackupType, string> = {
  AUTOMATIC: "GRL_ERP_BACKUP", MANUAL: "GRL_ERP_BACKUP", EMERGENCY: "GRL_ERP_BACKUP", "PRE-RESTORE": "PRE_RESTORE_BACKUP", "PRE-UPDATE": "PRE_UPDATE_BACKUP", EXPORT: "GRL_ERP_DATA",
};

/** Never overwrite: if a file with the same second-precision name exists, add a suffix. */
function uniquePath(dir: string, base: string, ext: string) {
  let p = path.join(dir, `${base}${ext}`);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base}_${i}${ext}`);
  return p;
}

export type ExcelBackupResult = { id: string; backupId: string; filePath: string; fileName: string; checksum: string; totalRecords: number; counts: Record<string, number>; verified: boolean; dbSnapshot?: string | null; dbDump?: string | null };

/**
 * Create a new Excel backup file (never overwrites), immediately read it back and verify the checksum,
 * and record it in the backup history.
 */
export async function createExcelBackup(type: BackupType, createdBy: string, opts: { withDatabase?: boolean; dir?: string } = {}): Promise<ExcelBackupResult> {
  ensureDirs();
  const now = new Date();
  const st = stamp(now);
  const backupId = `BKP-${st.replace(/[-_]/g, "")}-${randomBytes(2).toString("hex").toUpperCase()}`;
  const filePath = uniquePath(opts.dir ?? BACKUP_DIRS.excel, `${PREFIX[type]}_${st}`, ".xlsx");
  const fileName = path.basename(filePath);
  const rec = await prisma.backupRecord.create({ data: { backupId, type, fileName, filePath, status: "RUNNING", createdBy } });
  try {
    const company = await prisma.company.findFirst();
    const data = await loadAll(prisma);
    const written = await writeBackupWorkbook(filePath, data, {
      backupId, type, createdBy, companyName: company?.name ?? "", companyGstin: company?.gstin ?? "", databaseVersion: await dbVersion(), createdAt: now,
    });
    // read back and verify what is actually on disk
    const parsed = await readBackupWorkbook(filePath);
    const v = verifyParsed(parsed);
    const verified = v.checksumOk === true && parsed.info["Checksum"] === written.checksum;
    let db: Awaited<ReturnType<typeof databaseBackup>> | null = null;
    if (opts.withDatabase) db = await databaseBackup(st, type === "PRE-RESTORE" ? "PRE_RESTORE_DB" : "GRL_DB");
    const size = fs.statSync(filePath).size;
    await prisma.backupRecord.update({
      where: { id: rec.id },
      data: {
        status: verified ? "VERIFIED" : "CORRUPTED", verified, verifiedAt: verified ? new Date() : null, checksum: written.checksum,
        records: written.totalRecords, sizeBytes: size, dbFileName: db ? path.basename(db.dump ?? db.snapshot) : null,
        message: verified ? null : v.message,
      },
    });
    await prisma.auditLog.create({ data: { userName: createdBy, action: "BACKUP", entityType: "BACKUP", recordCode: fileName, newValue: { type, records: written.totalRecords, verified } } });
    log(`${type} backup ${fileName} records=${written.totalRecords} verified=${verified}${db ? ` db=${path.basename(db.snapshot)}${db.dump ? `,${path.basename(db.dump)}` : ""}` : ""}`);
    if (!verified) throw new Error(`Backup was written but failed verification: ${v.message}`);
    await archiveMonthly(filePath, type);
    return { id: rec.id, backupId, filePath, fileName, checksum: written.checksum, totalRecords: written.totalRecords, counts: written.counts, verified, dbSnapshot: db?.snapshot, dbDump: db?.dump };
  } catch (e) {
    await prisma.backupRecord.update({ where: { id: rec.id }, data: { status: "FAILED", message: (e as Error).message.slice(0, 1000) } }).catch(() => {});
    log(`${type} backup FAILED: ${(e as Error).message}`);
    throw e;
  }
}

/** Keep the first backup of each month as a monthly copy in Backup/Archive. */
async function archiveMonthly(filePath: string, type: BackupType) {
  if (!["AUTOMATIC", "MANUAL", "EMERGENCY"].includes(type)) return;
  const month = todayIst().slice(0, 7);
  fs.mkdirSync(BACKUP_DIRS.archive, { recursive: true });
  const exists = fs.readdirSync(BACKUP_DIRS.archive).some((f) => f.startsWith(`GRL_ERP_MONTHLY_${month}`));
  if (!exists) fs.copyFileSync(filePath, path.join(BACKUP_DIRS.archive, `GRL_ERP_MONTHLY_${month}.xlsx`));
}

/** Copy uploaded files into Backup/Documents and write a manifest with their SHA-256 hashes. */
export async function backupDocuments(st = stamp()) {
  ensureDirs();
  const docs = await prisma.document.findMany({ orderBy: { code: "asc" } });
  let copied = 0, missing = 0;
  for (const d of docs) {
    const src = path.join(UPLOAD_DIR, d.storedName);
    const dst = path.join(BACKUP_DIRS.documents, d.storedName);
    if (!fs.existsSync(src)) { missing++; continue; }
    if (!fs.existsSync(dst)) { fs.copyFileSync(src, dst); copied++; }
  }
  const manifest = {
    createdAt: new Date().toISOString(), appVersion: APP_VERSION, total: docs.length, copied, missing,
    documents: docs.map((d) => ({ id: d.id, code: d.code, docType: d.docType, entityType: d.entityType, entityId: d.entityId, fileName: d.fileName, storedName: d.storedName, sizeBytes: d.sizeBytes, sha256: d.sha256 })),
  };
  const manifestPath = path.join(BACKUP_DIRS.documents, `DOCUMENT_MANIFEST_${st}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath, total: docs.length, copied, missing };
}

export async function backupSettingsFile(st = stamp()) {
  const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  const company = await prisma.company.findFirst();
  const roles = await prisma.rolePermission.findMany();
  const p = path.join(BACKUP_DIRS.root, "Logs", `SETTINGS_${st}.json`);
  fs.writeFileSync(p, JSON.stringify({ createdAt: new Date().toISOString(), company, settings, rolePermissions: roles }, null, 2));
  return p;
}

/** One click: Excel + database + document manifest + settings + verification. */
export async function emergencyBackup(createdBy: string) {
  const st = stamp();
  const excel = await createExcelBackup("EMERGENCY", createdBy, { withDatabase: true });
  const docs = await backupDocuments(st);
  const settingsFile = await backupSettingsFile(st);
  return { excel, documents: docs, settingsFile, location: BACKUP_DIRS.root };
}

/** EXPORT ALL ERP DATA: one ZIP with /Excel, /Database, /Documents, /Manifest, /Logs. */
export async function exportAll(createdBy: string): Promise<{ zipPath: string; fileName: string }> {
  ensureDirs();
  const st = stamp();
  const work = fs.mkdtempSync(path.join(BACKUP_DIRS.archive, ".export-"));
  try {
    const excel = await createExcelBackup("EXPORT", createdBy, { dir: work });
    const db = await databaseBackup(st, "GRL_DB_EXPORT");
    const docs = await backupDocuments(st);
    const zipName = `GRL_ERP_FULL_EXPORT_${st}.zip`;
    const zipPath = path.join(BACKUP_DIRS.archive, zipName);
    const manifest = {
      export: zipName, createdAt: new Date().toISOString(), createdBy, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION,
      excel: { file: "Excel/GRL_ERP_DATA.xlsx", checksum: excel.checksum, records: excel.totalRecords, counts: excel.counts },
      database: { snapshot: `Database/${path.basename(db.snapshot)}`, pgDump: db.dump ? `Database/${path.basename(db.dump)}` : null },
      documents: { total: docs.total, missing: docs.missing },
    };
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(zipPath);
      const zip = archiver("zip", { zlib: { level: 6 } });
      out.on("close", () => resolve());
      zip.on("error", reject);
      zip.pipe(out);
      zip.file(excel.filePath, { name: "Excel/GRL_ERP_DATA.xlsx" });
      zip.file(db.snapshot, { name: `Database/${path.basename(db.snapshot)}` });
      if (db.dump) zip.file(db.dump, { name: `Database/${path.basename(db.dump)}` });
      for (const f of fs.readdirSync(UPLOAD_DIR)) zip.file(path.join(UPLOAD_DIR, f), { name: `Documents/${f}` });
      zip.file(docs.manifestPath, { name: "Manifest/document_manifest.json" });
      zip.append(JSON.stringify(manifest, null, 2), { name: "Manifest/manifest.json" });
      zip.append(`${new Date().toISOString()} export by ${createdBy}\nrecords=${excel.totalRecords} checksum=${excel.checksum}\n`, { name: "Logs/export.log" });
      zip.finalize();
    });
    await prisma.backupRecord.update({ where: { id: excel.id }, data: { fileName: zipName, filePath: zipPath } });
    return { zipPath, fileName: zipName };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Verify any backup file on demand. */
export async function verifyBackupFile(filePath: string) {
  const parsed = await readBackupWorkbook(filePath);
  const v = verifyParsed(parsed);
  const rec = await prisma.backupRecord.findFirst({ where: { filePath }, orderBy: { createdAt: "desc" } });
  if (rec) await prisma.backupRecord.update({ where: { id: rec.id }, data: { verified: v.checksumOk === true, verifiedAt: new Date(), status: v.checksumOk ? "VERIFIED" : "CORRUPTED", message: v.checksumOk ? null : v.message } });
  return { verification: v, info: parsed.info, counts: Object.fromEntries(Object.values(parsed.sheets).map((s) => [s.def.name, s.rows.length])) };
}

/** Files in the backup folders (also those made before a reinstall, which are not in the history table). */
export function listBackupFiles() {
  ensureDirs();
  const out: { folder: string; fileName: string; path: string; sizeBytes: number; modifiedAt: string }[] = [];
  for (const [folder, dir] of Object.entries({ Excel: BACKUP_DIRS.excel, Archive: BACKUP_DIRS.archive, Database: BACKUP_DIRS.database })) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(".")) continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isFile()) out.push({ folder, fileName: f, path: p, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Resolve a file name inside the backup folders. Refuses anything outside them. */
export function resolveBackupFile(name: string): string | null {
  const base = path.basename(name);
  for (const dir of [BACKUP_DIRS.excel, BACKUP_DIRS.archive, BACKUP_DIRS.database]) {
    const p = path.join(dir, base);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Retention proposal - NEVER deletes by itself. Keeps the newest N daily Excel backups and
 * the newest M monthly archive copies; PRE-RESTORE backups are always kept.
 */
export async function retentionPlan() {
  const s = await getSettings();
  const keepDaily = Number(s["backup.keepDaily"] ?? 30);
  const keepMonthly = Number(s["backup.keepMonthly"] ?? 12);
  const files = listBackupFiles();
  const daily = files.filter((f) => f.folder === "Excel" && f.fileName.startsWith("GRL_ERP_BACKUP_"));
  const monthly = files.filter((f) => f.folder === "Archive" && f.fileName.startsWith("GRL_ERP_MONTHLY_"));
  const candidates = [...daily.slice(keepDaily), ...monthly.slice(keepMonthly)];
  return { keepDaily, keepMonthly, dailyCount: daily.length, monthlyCount: monthly.length, candidates };
}

export async function deleteBackupFiles(names: string[], user: string) {
  const plan = await retentionPlan();
  const allowed = new Set(plan.candidates.map((c) => c.fileName));
  const deleted: string[] = [];
  for (const n of names) {
    if (!allowed.has(n)) continue; // only files the retention policy proposed
    const p = resolveBackupFile(n);
    if (p) { fs.unlinkSync(p); deleted.push(n); }
  }
  await prisma.auditLog.create({ data: { userName: user, action: "BACKUP DELETE", entityType: "BACKUP", newValue: { deleted } } });
  log(`retention: ${user} deleted ${deleted.length} file(s): ${deleted.join(", ")}`);
  return deleted;
}

export async function backupHealth() {
  ensureDirs();
  const last = await prisma.backupRecord.findFirst({ where: { status: { in: ["VERIFIED", "SUCCESS"] }, type: { not: "EXPORT" } }, orderBy: { createdAt: "desc" } });
  const lastAny = await prisma.backupRecord.findFirst({ orderBy: { createdAt: "desc" } });
  const lastTest = await prisma.restoreRecord.findFirst({ where: { dryRun: true, status: "SUCCESS" }, orderBy: { startedAt: "desc" } });
  const lastRestore = await prisma.restoreRecord.findFirst({ where: { dryRun: false }, orderBy: { startedAt: "desc" } });
  const files = listBackupFiles();
  const excelFiles = files.filter((f) => f.fileName.endsWith(".xlsx"));
  const dbFiles = files.filter((f) => f.folder === "Database");
  const hours = last ? (Date.now() - last.createdAt.getTime()) / 3_600_000 : null;
  const level = backupAgeLevel(hours);
  const days = hours === null ? null : Math.floor(hours / 24);
  const reminder =
    level === "OK" ? null
    : hours === null ? "No backup has been created yet. Click BACKUP NOW."
    : `Your ERP has not been backed up for ${days && days >= 1 ? `${days} day(s)` : `${Math.floor(hours)} hours`}.`;
  const failedLatest = lastAny && ["FAILED", "CORRUPTED"].includes(lastAny.status);
  const status = !last ? "RED" : failedLatest || level === "CRITICAL" || level === "URGENT" ? "RED" : level === "WARNING" ? "AMBER" : "GREEN";
  return {
    lastBackupAt: last?.createdAt ?? null,
    lastBackupFile: last?.fileName ?? null,
    lastBackupVerified: last?.verified ?? false,
    lastBackupStatus: lastAny?.status ?? null,
    status,
    statusText: status === "GREEN" ? "GREEN - VERIFIED" : status === "AMBER" ? "AMBER - BACKUP DUE" : failedLatest ? "RED - LAST BACKUP FAILED" : "RED - BACKUP NEEDED",
    reminderLevel: level,
    reminder,
    lastRestoreTestAt: lastTest?.startedAt ?? null,
    lastRestoreAt: lastRestore?.startedAt ?? null,
    backupFileCount: excelFiles.length,
    excelBackupAvailable: excelFiles.length > 0,
    databaseBackupAvailable: dbFiles.length > 0,
    dataSafety: status === "GREEN" ? "PROTECTED" : status === "AMBER" ? "BACKUP DUE" : "AT RISK",
    location: BACKUP_DIRS.root,
  };
}

let running = false;
/** Automatic Excel backup: once a day, the first time the ERP is open that day (checked hourly). */
export async function autoBackupIfDue() {
  if (running) return null;
  const s = await getSettings();
  if (s["backup.auto"] === "false") return null;
  const today = todayIst();
  const lastAuto = await prisma.backupRecord.findFirst({ where: { type: "AUTOMATIC", status: { in: ["VERIFIED", "SUCCESS"] } }, orderBy: { createdAt: "desc" } });
  if (lastAuto && todayIst(lastAuto.createdAt) === today) return null;
  running = true;
  try {
    return await createExcelBackup("AUTOMATIC", "SYSTEM", { withDatabase: s["backup.autoDatabase"] !== "false" });
  } finally {
    running = false;
  }
}
