import "dotenv/config";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function documentsDir(): string {
  if (process.env.GRL_DOCUMENTS_DIR) return process.env.GRL_DOCUMENTS_DIR;
  const home = os.homedir();
  const docs = path.join(home, "Documents");
  return docs;
}

/** Root of everything the ERP keeps outside its installation folder, so it survives updates and uninstall. */
export const APP_HOME = process.env.GRL_HOME || path.join(documentsDir(), "G Road Lines ERP");
export const BACKUP_ROOT = process.env.BACKUP_ROOT || path.join(APP_HOME, "Backup");
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(APP_HOME, "Files");

export const BACKUP_DIRS = {
  root: BACKUP_ROOT,
  excel: path.join(BACKUP_ROOT, "Excel"),
  database: path.join(BACKUP_ROOT, "Database"),
  documents: path.join(BACKUP_ROOT, "Documents"),
  logs: path.join(BACKUP_ROOT, "Logs"),
  archive: path.join(BACKUP_ROOT, "Archive"),
};

export function ensureDirs() {
  for (const d of [...Object.values(BACKUP_DIRS), UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });
}

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "0.0.0.0",
  authSecret: process.env.AUTH_SECRET || "",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  databaseUrl: process.env.DATABASE_URL || "",
  pgDumpPath: process.env.PG_DUMP_PATH || "",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  isTest: process.env.NODE_ENV === "test" || !!process.env.VITEST,
};

if (!config.authSecret || config.authSecret.length < 32) {
  if (!config.isTest) console.warn("[config] AUTH_SECRET is missing or shorter than 32 characters. Set a long random value in .env");
}
