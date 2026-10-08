import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { prisma } from "../db.js";
import { BACKUP_DIRS, UPLOAD_DIR, ensureDirs } from "../config.js";
import { readBackupWorkbook } from "./excel-read.js";
import { analyze, execute, rebuildIndexes, type RestoreMode, type RestoreIssue } from "./restore.js";
import { createExcelBackup } from "./service.js";
import type { SheetKey } from "./sheets.js";
import { stamp } from "../lib/util.js";
import { databaseBackup } from "./database-backup.js";

const UPLOADS = () => path.join(BACKUP_DIRS.logs, "restore-uploads");

/** Keep an uploaded restore file under a random token so the preview and the confirmation use the same file. */
export function stageUpload(tmpPath: string, originalName: string) {
  ensureDirs();
  fs.mkdirSync(UPLOADS(), { recursive: true });
  const token = randomBytes(12).toString("hex");
  const safe = path.basename(originalName).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const dest = path.join(UPLOADS(), `${token}__${safe}`);
  fs.renameSync(tmpPath, dest);
  return { token, fileName: safe };
}

export function stagedPath(token: string): { filePath: string; fileName: string } | null {
  if (!/^[a-f0-9]{24}$/.test(token)) return null;
  const dir = UPLOADS();
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((x) => x.startsWith(`${token}__`));
  return f ? { filePath: path.join(dir, f), fileName: f.slice(26) } : null;
}

export async function preview(filePath: string, mode: RestoreMode, sheets?: SheetKey[], skipInvalid?: boolean) {
  const parsed = await readBackupWorkbook(filePath);
  const a = await analyze(parsed, mode, { sheets, skipInvalid });
  return a.plan;
}

export async function writeErrorReport(issues: RestoreIssue[]) {
  ensureDirs();
  const filePath = path.join(BACKUP_DIRS.logs, `RESTORE_ERRORS_${stamp()}.xlsx`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Restore Errors", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Severity", key: "severity", width: 10 }, { header: "Sheet", key: "sheet", width: 24 }, { header: "Row", key: "row", width: 8 },
    { header: "Record ID", key: "recordId", width: 40 }, { header: "Field", key: "field", width: 22 }, { header: "Error", key: "error", width: 70 },
    { header: "Suggested Fix", key: "suggestedFix", width: 60 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: "A1", to: "G1" };
  for (const i of issues) ws.addRow(i);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

/** Bring back document files from Backup/Documents when the restored records point to files missing on this computer. */
function recoverDocumentFiles(storedNames: string[]) {
  let recovered = 0, missing = 0;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const n of storedNames) {
    const dst = path.join(UPLOAD_DIR, n);
    if (fs.existsSync(dst)) continue;
    const src = path.join(BACKUP_DIRS.documents, n);
    if (fs.existsSync(src)) { fs.copyFileSync(src, dst); recovered++; } else missing++;
  }
  return { recovered, missing };
}

/**
 * Full restore flow: validate -> safety backup of the current data (Excel + database) -> restore in one transaction
 * -> verify counts and financial totals -> rebuild indexes -> report. Dry run = "restore test": everything except commit.
 */
export async function runRestore(input: { filePath: string; fileName: string; mode: RestoreMode; sheets?: SheetKey[]; skipInvalid?: boolean; dryRun?: boolean; userName: string }) {
  const rec = await prisma.restoreRecord.create({ data: { fileName: input.fileName, mode: input.mode, status: "RUNNING", dryRun: !!input.dryRun, createdBy: input.userName } });
  let preBackup: string | null = null;
  try {
    const parsed = await readBackupWorkbook(input.filePath);
    const a = await analyze(parsed, input.mode, { sheets: input.sheets, skipInvalid: input.skipInvalid });
    if (!a.plan.canProceed) {
      const report = a.plan.issues.length ? await writeErrorReport(a.plan.issues) : null;
      await prisma.restoreRecord.update({ where: { id: rec.id }, data: { status: "BLOCKED", finishedAt: new Date(), message: a.plan.blockers.join(" "), summary: { blockers: a.plan.blockers, errorReport: report } as any } });
      return { ok: false as const, status: "IMPORT FAILED", restoreId: rec.id, plan: a.plan, errorReport: report, message: a.plan.blockers.join(" ") };
    }
    if (!input.dryRun) {
      // AUTOMATIC PRE-RESTORE BACKUP (Excel + database). No safety backup = no restore.
      const pre = await createExcelBackup("PRE-RESTORE", input.userName, { withDatabase: true });
      preBackup = pre.filePath;
      await prisma.restoreRecord.update({ where: { id: rec.id }, data: { preRestoreBackup: pre.filePath, snapshotFile: pre.dbSnapshot ?? null } });
    }
    const result = await execute(a, { dryRun: input.dryRun, userName: input.userName, fileName: input.fileName });
    let docs = { recovered: 0, missing: 0 };
    if (!input.dryRun) {
      await rebuildIndexes();
      const stored = (await prisma.document.findMany({ select: { storedName: true } })).map((d) => d.storedName);
      docs = recoverDocumentFiles(stored);
    }
    const report = a.plan.issues.length ? await writeErrorReport(a.plan.issues) : null;
    const summary = { ...result, sheets: a.plan.sheets, errorReport: report, documents: docs, warnings: a.plan.warningCount };
    await prisma.restoreRecord.update({ where: { id: rec.id }, data: { status: "SUCCESS", finishedAt: new Date(), summary: JSON.parse(JSON.stringify(summary)) } });
    return { ok: true as const, status: input.dryRun ? "RESTORE TEST PASSED" : input.mode === "IMPORT" ? "IMPORT COMPLETE" : "RESTORE SUCCESSFUL", restoreId: rec.id, plan: a.plan, result, errorReport: report, documents: docs, preRestoreBackup: preBackup };
  } catch (e) {
    const message = (e as Error).message;
    await prisma.restoreRecord.update({ where: { id: rec.id }, data: { status: "FAILED", finishedAt: new Date(), message: message.slice(0, 2000) } }).catch(() => {});
    return { ok: false as const, status: input.dryRun ? "RESTORE TEST FAILED" : "IMPORT FAILED", restoreId: rec.id, message: `${message} No changes were made to the database (the restore was rolled back).`, preRestoreBackup: preBackup, canRollback: !!preBackup };
  }
}

/** ROLLBACK: put the database back exactly as it was before a restore, from that restore's PRE-RESTORE backup. */
export async function rollback(restoreId: string, userName: string) {
  const rec = await prisma.restoreRecord.findUnique({ where: { id: restoreId } });
  if (!rec?.preRestoreBackup || !fs.existsSync(rec.preRestoreBackup)) throw new Error("No pre-restore backup is available for this restore.");
  await databaseBackup(stamp(), "PRE_ROLLBACK_DB");
  const r = await runRestore({ filePath: rec.preRestoreBackup, fileName: path.basename(rec.preRestoreBackup), mode: "FULL", userName });
  if (r.ok) await prisma.restoreRecord.update({ where: { id: restoreId }, data: { rolledBack: true } });
  return r;
}
