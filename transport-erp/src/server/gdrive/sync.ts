/** Copies backups, exports and document files to Google Drive, and brings them back for a restore. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../db.js";
import { BACKUP_DIRS, UPLOAD_DIR } from "../config.js";
import { isConnected, uploadFile, listFolder, downloadFile, type SubFolder } from "./drive.js";

function log(line: string) {
  try {
    fs.mkdirSync(BACKUP_DIRS.logs, { recursive: true });
    fs.appendFileSync(path.join(BACKUP_DIRS.logs, "google-drive.log"), `${new Date().toISOString()}  ${line}\n`);
  } catch { /* never break a backup because of logging */ }
}

export async function autoUploadEnabled() {
  const s = await prisma.setting.findUnique({ where: { key: "gdrive.autoUpload" } });
  return s?.value !== "false" && (await isConnected());
}

/** Upload one backup (Excel or export ZIP, plus its database file). */
export async function uploadBackup(recordId: string) {
  const r = await prisma.backupRecord.findUnique({ where: { id: recordId } });
  if (!r) throw new Error("Backup not found.");
  if (!["VERIFIED", "SUCCESS"].includes(r.status)) throw new Error("Only verified backups are copied to Google Drive.");
  if (!fs.existsSync(r.filePath)) throw new Error(`The backup file is no longer on this computer: ${r.fileName}`);
  try {
    const folder: SubFolder = r.fileName.endsWith(".zip") ? "Exports" : "Excel";
    const props = { backupId: r.backupId, type: r.type, checksum: r.checksum ?? "", records: String(r.records) };
    const main = r.driveFileId ? { id: r.driveFileId } : await uploadFile(r.filePath, { folder, appProperties: props });
    let dbId = r.driveDbFileId;
    const dbPath = r.dbFileName ? path.join(BACKUP_DIRS.database, r.dbFileName) : null;
    if (!dbId && dbPath && fs.existsSync(dbPath)) dbId = (await uploadFile(dbPath, { folder: "Database", appProperties: { backupId: r.backupId } })).id;
    await prisma.backupRecord.update({ where: { id: r.id }, data: { driveStatus: "UPLOADED", driveFileId: main.id, driveDbFileId: dbId, driveUploadedAt: new Date(), driveError: null } });
    log(`uploaded ${r.fileName}${dbId ? ` + ${r.dbFileName}` : ""}`);
    return { ok: true as const, fileId: main.id };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await prisma.backupRecord.update({ where: { id: r.id }, data: { driveStatus: "FAILED", driveError: msg } });
    log(`FAILED ${r.fileName}: ${msg}`);
    return { ok: false as const, error: msg };
  }
}

/** Upload every uploaded document file (LR, POD, receipts...) that is not in Drive yet. */
export async function syncDocuments() {
  const existing = new Set((await listFolder("Documents", 50)).map((f) => f.name));
  const docs = await prisma.document.findMany({ select: { storedName: true, code: true } });
  let uploaded = 0, missingLocal = 0;
  for (const d of docs) {
    if (existing.has(d.storedName)) continue;
    const p = path.join(UPLOAD_DIR, d.storedName);
    if (!fs.existsSync(p)) { missingLocal++; continue; }
    await uploadFile(p, { folder: "Documents", appProperties: { code: d.code } });
    uploaded++;
  }
  if (uploaded) log(`documents uploaded: ${uploaded}`);
  return { uploaded, missingLocal, inDrive: existing.size + uploaded };
}

let chain: Promise<unknown> = Promise.resolve();
/** Serialised background upload so backups never wait for the internet. */
export function queueUpload(recordId: string) {
  chain = chain.then(() => uploadBackup(recordId)).catch(() => {});
  return chain;
}

/** Retry everything that is not in Drive yet (called hourly and from the Backup page). */
export async function syncAll() {
  if (!(await isConnected())) return { connected: false as const };
  const pending = await prisma.backupRecord.findMany({ where: { status: { in: ["VERIFIED", "SUCCESS"] }, driveStatus: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "asc" }, take: 50 });
  let ok = 0, failed = 0;
  for (const r of pending) {
    if (!fs.existsSync(r.filePath)) { await prisma.backupRecord.update({ where: { id: r.id }, data: { driveStatus: "FAILED", driveError: "File no longer on this computer" } }); failed++; continue; }
    (await uploadBackup(r.id)).ok ? ok++ : failed++;
  }
  const documents = await syncDocuments();
  return { connected: true as const, uploaded: ok, failed, documents };
}

export async function driveBackups() {
  const [excel, exports] = await Promise.all([listFolder("Excel"), listFolder("Exports")]);
  return { excel: excel.filter((f) => f.name.endsWith(".xlsx")), exports };
}

/** Download a backup from Drive for the restore wizard; also brings back document files missing on this computer. */
export async function downloadForRestore(fileId: string) {
  const tmp = path.join(os.tmpdir(), `grl-drive-${Date.now()}.xlsx`);
  const f = await downloadFile(fileId, tmp);
  if (!f.name.toLowerCase().endsWith(".xlsx")) { fs.rmSync(tmp, { force: true }); throw new Error("Choose an Excel (.xlsx) backup."); }
  let documents = 0;
  try {
    fs.mkdirSync(BACKUP_DIRS.documents, { recursive: true });
    for (const d of await listFolder("Documents", 50)) {
      const local = path.join(BACKUP_DIRS.documents, path.basename(d.name));
      if (!fs.existsSync(local) && !fs.existsSync(path.join(UPLOAD_DIR, path.basename(d.name)))) { await downloadFile(d.id, local); documents++; }
    }
  } catch (e) {
    log(`document download during restore failed: ${(e as Error).message}`);
  }
  log(`downloaded ${f.name} for restore (+${documents} document files)`);
  return { tmpPath: tmp, fileName: f.name, documents };
}
